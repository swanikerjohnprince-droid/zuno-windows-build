/*!
 * Opus playback: symphonia demuxes, libopus decodes.
 *
 * symphonia has no Opus decoder — not a missing feature flag, the codec is simply absent from
 * 0.5 — and YouTube serves Opus-in-WebM for the large majority of tracks at `high` quality, and
 * as the *only* audio offered for many of them. So the container is read with symphonia, which
 * already handles Matroska and Ogg, and the packets inside go to libopus.
 *
 * Everything else — AAC, FLAC, MP3, ALAC, Vorbis, WAV — stays on `rodio::Decoder`, which does
 * have decoders for those. This module exists for exactly one codec.
 */

use std::collections::VecDeque;
use std::time::Duration;

use rodio::{ChannelCount, SampleRate, Source};
use symphonia::core::codecs::audio::well_known::CODEC_ID_OPUS;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::{Time, TimeBase, Timestamp};

/// Opus always decodes at 48 kHz, whatever the source was encoded from. Fixed by RFC 6716.
const OPUS_SAMPLE_RATE: u32 = 48_000;

/// Longest Opus frame is 120 ms, which at 48 kHz is 5760 samples per channel.
const MAX_FRAME_SAMPLES: usize = 5_760;

/// Whether a mime type names something only libopus can decode.
pub(crate) fn is_opus(mime_type: &str) -> bool {
    let lowered = mime_type.to_ascii_lowercase();
    /*
     * `audio/webm` on its own counts. YouTube labels the Opus tier
     * `audio/webm; codecs="opus"`, but a truncated or generic label still means Opus in
     * practice — WebM carries no other audio codec that symphonia would want instead, and
     * guessing wrong here costs one failed load rather than silence.
     */
    lowered.contains("opus") || lowered.contains("webm")
}

/**
 * The container a stored body actually is, read from its own first bytes.
 *
 * For anything already on disk the declared mime type is not evidence. `Track.mimeType`
 * describes what was resolved for *streaming*, and a row that came from a playlist listing
 * carries none at all — so a downloaded track falls back to `audio/mp4` while the bytes on disk
 * are very often Opus in WebM. That misroute sent the file to rodio, which parsed the Matroska
 * fine and then had no Opus decoder to hand the packets to: "the format of the data has not been
 * recognized", for a track that had downloaded perfectly.
 *
 * Rewinds before returning, so the caller hands the decoder a reader at the start.
 * `None` means the bytes look like nothing recognised and the declared type is as good a guess
 * as any.
 */
pub(crate) fn sniff_container_mime(
    reader: &mut (impl std::io::Read + std::io::Seek),
) -> std::io::Result<Option<&'static str>> {
    let mut header = [0u8; 64];
    let mut filled = 0;
    while filled < header.len() {
        match reader.read(&mut header[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    reader.seek(std::io::SeekFrom::Start(0))?;
    Ok(container_mime_of(&header[..filled]))
}

/// The magic-number half of `sniff_container_mime`, split out so it can be tested on bytes.
fn container_mime_of(header: &[u8]) -> Option<&'static str> {
    if header.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        // Matroska. YouTube's WebM audio is always Opus, and a WebM carrying Vorbis instead is
        // rare enough that failing loudly on it beats guessing the other way on every download.
        return Some("audio/webm; codecs=\"opus\"");
    }
    if header.starts_with(b"OggS") {
        // Ogg carries either, and only the codec header inside the first page says which.
        return Some(if header.windows(8).any(|window| window == b"OpusHead") {
            "audio/opus"
        } else {
            "audio/ogg"
        });
    }
    if header.len() >= 12 && &header[4..8] == b"ftyp" {
        return Some("audio/mp4");
    }
    if header.starts_with(b"fLaC") {
        return Some("audio/flac");
    }
    None
}

/**
 * How long the track is, according to the container.
 *
 * `n_frames` is a count in whatever unit the container keeps time in — Matroska's default is
 * milliseconds, Ogg's is samples — so it only means anything through the track's own time base.
 * Dividing it by the sample rate instead came out 48× short against WebM, which read as a
 * three-second song: with crossfade on, `remaining` was inside the fade window from the first
 * tick and the queue raced through fifteen tracks in twenty seconds.
 *
 * `None` means the container did not say, and the caller falls back to the duration the provider
 * already reported for the track.
 */
fn container_duration(time_base: Option<TimeBase>, n_frames: Option<u64>) -> Option<Duration> {
    let (time_base, frames) = (time_base?, n_frames?);
    /*
     * symphonia 0.6 counts time in `Timestamp`s rather than raw `u64`s, so a frame count that
     * does not fit a signed 64-bit timestamp has no representation and the duration is
     * unknown. `calc_time` returns `None` for the same reason when the multiplication
     * overflows; both are "the container did not say", not a failure.
     */
    let frames = i64::try_from(frames).ok()?;
    let time = time_base.calc_time(Timestamp::new(frames))?;
    Some(Duration::from_secs_f64(time.as_secs_f64()))
}

pub(crate) struct OpusSource {
    format: Box<dyn FormatReader>,
    decoder: opus::Decoder,
    track_id: u32,
    channels: ChannelCount,
    /// Decoded samples not yet handed to rodio, interleaved.
    pending: VecDeque<f32>,
    /// Reused across packets so decoding does not allocate per frame.
    scratch: Vec<f32>,
    total_duration: Option<Duration>,
    /// Samples the encoder asks to be thrown away — the codec's own warm-up, not audio.
    skip_samples: usize,
    exhausted: bool,
}

impl OpusSource {
    /**
     * Opens a reader as an Opus stream.
     *
     * Fails when the container holds no Opus track, which is the caller's cue that this was the
     * wrong path and rodio should have it instead.
     */
    pub(crate) fn new(
        source: Box<dyn MediaSource>,
        mime_type: &str,
    ) -> Result<Self, String> {
        let stream = MediaSourceStream::new(source, Default::default());

        let mut hint = Hint::new();
        // Helps the probe pick a reader without sniffing the whole header. Harmless when wrong:
        // the probe falls back to content detection.
        if mime_type.contains("webm") || mime_type.contains("matroska") {
            hint.with_extension("webm");
        } else if mime_type.contains("ogg") || mime_type.contains("opus") {
            hint.with_extension("ogg");
        }

        /*
         * symphonia 0.6 probes and returns the reader in one step — there is no `Probed` wrapper
         * to unwrap — and the options are taken by value. Gapless playback is no longer an
         * opt-in: the demuxers always trim encoder delay and padding themselves.
         */
        let format = symphonia::default::get_probe()
            .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
            .map_err(|error| format!("opus container probe failed: {error}"))?;

        /*
         * A track's codec parameters are now an optional, tagged enum, and the codec id is a
         * typed `AudioCodecId` rather than a bare `u32` — so "this track is Opus" is asked of
         * the audio parameters instead of compared against a constant type.
         */
        let track = format
            .tracks()
            .iter()
            .find(|track| {
                track
                    .codec_params
                    .as_ref()
                    .and_then(|params| params.audio())
                    .is_some_and(|audio| audio.codec == CODEC_ID_OPUS)
            })
            .ok_or_else(|| "container holds no Opus track".to_string())?;

        let track_id = track.id;
        let channel_count = track
            .codec_params
            .as_ref()
            .and_then(|params| params.audio())
            .and_then(|audio| audio.channels.as_ref())
            .map(|channels| channels.count())
            .unwrap_or(2)
            .max(1);
        let channels = ChannelCount::new(channel_count as u16)
            .ok_or_else(|| "opus track declared zero channels".to_string())?;

        let opus_channels = match channel_count {
            1 => opus::Channels::Mono,
            2 => opus::Channels::Stereo,
            /*
             * libopus decodes only mono and stereo through this API; surround needs the
             * multistream decoder. YouTube Music does not serve surround, so this reports
             * rather than pretending.
             */
            other => return Err(format!("unsupported opus channel count: {other}")),
        };
        let decoder = opus::Decoder::new(OPUS_SAMPLE_RATE, opus_channels)
            .map_err(|error| format!("opus decoder init failed: {error}"))?;

        /*
         * The time base and the frame count moved from the codec parameters onto the track
         * itself in symphonia 0.6, and so did the encoder delay: they describe the track's
         * timeline, not the codec's.
         */
        let total_duration = container_duration(track.time_base, track.num_frames);

        /*
         * Pre-skip. Every Opus stream begins with encoder warm-up that is not part of the
         * recording; OpusHead states how much, and playing it back is an audible tick at the
         * start of every single track.
         */
        let skip_samples = track.delay.unwrap_or(0) as usize * channel_count;

        Ok(Self {
            format,
            decoder,
            track_id,
            channels,
            pending: VecDeque::with_capacity(MAX_FRAME_SAMPLES * channel_count),
            scratch: vec![0.0; MAX_FRAME_SAMPLES * channel_count],
            total_duration,
            skip_samples,
            exhausted: false,
        })
    }

    /// Decodes the next packet belonging to our track. False means the stream ended.
    fn fill(&mut self) -> bool {
        while !self.exhausted {
            let packet = match self.format.next_packet() {
                /*
                 * symphonia 0.6 reports the end of the stream as `Ok(None)` rather than as an
                 * error, so a clean finish no longer has to travel through the error arm.
                 */
                Ok(Some(packet)) => packet,
                Ok(None) => {
                    self.exhausted = true;
                    return false;
                }
                Err(SymphoniaError::IoError(error))
                    if error.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    self.exhausted = true;
                    return false;
                }
                /*
                 * A stalled fetch, not a finished track. `BufferReader` times out a read that
                 * has waited too long for bytes that are still on their way — the fill behind it
                 * only gives up for real by marking the buffer failed, and *that* is what turns
                 * into the `UnexpectedEof` above. Latching `exhausted` on a bare timeout is what
                 * let a slow range end a track that was still downloading fine.
                 */
                Err(SymphoniaError::IoError(error))
                    if error.kind() == std::io::ErrorKind::TimedOut =>
                {
                    continue;
                }
                Err(error) => {
                    eprintln!("[internal][tauri][warn] opus demux ended: {error}");
                    self.exhausted = true;
                    return false;
                }
            };
            // A WebM file interleaves streams; packets for the video track are not ours.
            if packet.track_id != self.track_id {
                continue;
            }

            let frames = match self.decoder.decode_float(&packet.data, &mut self.scratch, false) {
                Ok(frames) => frames,
                Err(error) => {
                    /*
                     * One bad packet is not a dead track — a range that arrived torn will
                     * produce one, and dropping it costs a few milliseconds of audio where
                     * giving up costs the song.
                     */
                    eprintln!("[internal][tauri][warn] opus packet dropped: {error}");
                    continue;
                }
            };

            let sample_count = frames * self.channels.get() as usize;
            let mut decoded = &self.scratch[..sample_count.min(self.scratch.len())];
            if self.skip_samples > 0 {
                let skipped = self.skip_samples.min(decoded.len());
                self.skip_samples -= skipped;
                decoded = &decoded[skipped..];
            }
            if decoded.is_empty() {
                continue;
            }
            self.pending.extend(decoded.iter().copied());
            return true;
        }
        false
    }
}

impl Iterator for OpusSource {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        if let Some(sample) = self.pending.pop_front() {
            return Some(sample);
        }
        if !self.fill() {
            return None;
        }
        self.pending.pop_front()
    }
}

impl Source for OpusSource {
    #[inline]
    fn current_span_len(&self) -> Option<usize> {
        // Channel count and sample rate never change mid-stream for Opus, so there is only ever
        // one span and its end is the end of the track.
        None
    }

    #[inline]
    fn channels(&self) -> ChannelCount {
        self.channels
    }

    #[inline]
    fn sample_rate(&self) -> SampleRate {
        SampleRate::new(OPUS_SAMPLE_RATE).expect("48 kHz is not zero")
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        self.total_duration
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
        /*
         * `Time` is a newtype with private fields in symphonia 0.6, so it is built through a
         * fallible conversion. A position that cannot be represented — non-finite, or past the
         * end of the timestamp range — is not a seek this source can honour.
         */
        let time = Time::try_from_secs_f64(position.as_secs_f64()).ok_or_else(|| {
            eprintln!("[internal][tauri][warn] opus seek position out of range");
            rodio::source::SeekError::NotSupported { underlying_source: "OpusSource" }
        })?;

        self.format
            .seek(
                SeekMode::Coarse,
                SeekTo::Time {
                    time,
                    track_id: Some(self.track_id),
                },
            )
            .map_err(|error| {
                eprintln!("[internal][tauri][warn] opus seek failed: {error}");
                rodio::source::SeekError::NotSupported { underlying_source: "OpusSource" }
            })?;

        /*
         * Everything decoded before the seek belongs to where the track *was*. The decoder also
         * has to forget its inter-frame state, or the first frames after a jump are reconstructed
         * against samples from somewhere else entirely and arrive as a burst of noise.
         */
        self.pending.clear();
        self.exhausted = false;
        let _ = self.decoder.reset_state();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{container_duration, container_mime_of, is_opus, sniff_container_mime};
    use symphonia::core::units::TimeBase;

    /// Byte literals spelled as numbers: the headers here are magic numbers, and writing them
    /// as escaped strings makes them harder to check against a hex dump, not easier.
    fn ogg_page(codec_header: &[u8]) -> Vec<u8> {
        let mut page = b"OggS".to_vec();
        page.extend_from_slice(&[0x00, 0x02, 0, 0, 0, 0, 0, 0]);
        page.extend_from_slice(codec_header);
        page
    }

    /**
     * A stored body is routed by its own bytes, not by what something said it was.
     *
     * The case that found this: a downloaded track whose file began 1A 45 DF A3 — Matroska
     * holding Opus — was declared `audio/mp4`, because `Track.mimeType` describes what was
     * resolved for *streaming* and a row from a playlist listing carries none at all. rodio
     * parsed the container happily and then had no Opus decoder for what was inside, so a
     * download that was perfectly intact reported "the format of the data has not been
     * recognized".
     */
    #[test]
    fn a_stored_container_is_identified_by_its_own_bytes() {
        let matroska = [0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81];
        let sniffed = container_mime_of(&matroska).expect("matroska");
        assert!(is_opus(sniffed), "WebM has to reach libopus whatever it was declared as");

        // Ogg carries either codec; only the header inside the first page distinguishes them.
        assert!(is_opus(
            container_mime_of(&ogg_page(b"OpusHead")).expect("ogg opus")
        ));
        assert!(
            !is_opus(container_mime_of(&ogg_page(&[0x01, b'v', b'o', b'r', b'b', b'i', b's']))
                .expect("ogg vorbis")),
            "rodio has a Vorbis decoder; libopus does not",
        );

        // The same mistake in reverse would send AAC to libopus, which cannot read it either.
        let mut mp4 = vec![0, 0, 0, 0x20];
        mp4.extend_from_slice(b"ftypM4A ");
        assert!(!is_opus(container_mime_of(&mp4).expect("mp4")));

        assert_eq!(container_mime_of(b"fLaC____"), Some("audio/flac"));
        // Nothing recognised leaves the declared type standing rather than inventing one.
        assert_eq!(container_mime_of(b"not a container at all"), None);
        assert_eq!(container_mime_of(&[]), None);
    }

    /// Sniffing must leave the reader at the start, or the decoder gets a headless stream.
    #[test]
    fn sniffing_rewinds_the_reader() {
        let mut body = vec![0x1A, 0x45, 0xDF, 0xA3];
        body.extend(std::iter::repeat(0xAB).take(200));
        let mut cursor = std::io::Cursor::new(body);

        let sniffed = sniff_container_mime(&mut cursor).expect("sniff");
        assert!(is_opus(sniffed.expect("matroska")));
        assert_eq!(cursor.position(), 0, "the decoder must see the container header");

        // Shorter than the sniff window: a short read is not a failure.
        let mut tiny = std::io::Cursor::new(vec![0x1A, 0x45, 0xDF, 0xA3]);
        assert!(sniff_container_mime(&mut tiny).expect("sniff").is_some());
    }

    /**
     * A duration read through the container's time base, not by dividing by the sample rate.
     *
     * The numbers are the real ones from the failure: a track that reported 4.251 s was
     * 204,061 ms of Matroska. With crossfade at 9 s that put `remaining` inside the fade window
     * from the first tick, so every track handed straight over to the next and the queue burned
     * through fifteen songs in twenty seconds.
     */
    #[test]
    fn duration_is_read_through_the_containers_time_base() {
        // Matroska's default timecode scale: milliseconds.
        let mkv = container_duration(TimeBase::try_new(1, 1_000), Some(204_061))
            .expect("mkv duration");
        assert!(
            (mkv.as_secs_f64() - 204.061).abs() < 0.01,
            "3:24 of Matroska, not the 4.25 s that dividing by 48000 produced: {mkv:?}",
        );

        // Ogg keeps time in samples, where dividing by the rate happens to be right — the point
        // is that one formula covers both because it asks the container.
        let ogg = container_duration(TimeBase::try_new(1, 48_000), Some(9_794_928))
            .expect("ogg duration");
        assert!(
            (ogg.as_secs_f64() - 204.06).abs() < 0.01,
            "the same track in Ogg is the same length: {ogg:?}",
        );

        // Unknown stays unknown rather than becoming zero, so the caller can fall back to the
        // duration the provider reported instead of trusting a made-up one.
        assert!(container_duration(None, Some(204_061)).is_none());
        assert!(container_duration(TimeBase::try_new(1, 1_000), None).is_none());

        /*
         * A time base with a zero numerator or denominator no longer exists as a value:
         * symphonia 0.6 holds both in `NonZero<u32>`, so a degenerate base is rejected at
         * construction rather than asserted on later. The equivalent guard now lives in the
         * type, and what is left for this function to reject is a frame count that has no
         * timestamp representation.
         */
        assert!(TimeBase::try_new(0, 1_000).is_none(), "a zero time base is not constructible");
        assert!(TimeBase::try_new(1, 0).is_none(), "a zero time base is not constructible");
        assert!(
            container_duration(TimeBase::try_new(1, 1_000), Some(u64::MAX)).is_none(),
            "a frame count that cannot be a timestamp is unknown, not a wrapped-around time",
        );
    }
}
