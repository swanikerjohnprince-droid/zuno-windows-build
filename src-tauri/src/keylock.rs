//! Keylock: change a deck's tempo without changing its pitch.
//!
//! Without it a tempo fader is a turntable — rodio resamples, so the pitch rides along with the
//! speed. Mixxx solves this with SoundTouch (WSOLA time-stretching): the tempo is taken out of
//! the resampler and given to a stage that consumes the recording at `tempo` samples per output
//! sample while emitting a fixed-rate stream, so the pitch stays put.
//!
//! This is a hand-rolled pure-Rust WSOLA in that family (the `soundtouch` crate wraps C++, which
//! this crate deliberately does not depend on), as a rodio `Source` sitting between `Counted`
//! and rodio's own speed stage:
//!
//! ```text
//! decoder -> Counted -> Keylock -> [rodio Speed] -> output
//! ```
//!
//! The frame is ~93 ms, the synthesis hop half a frame, and the window a periodic Hann, which
//! sums to exactly 1 at that hop (COLA) — so overlap-add needs no normalization and the gain is
//! unity, with a natural fade at the edges. Each output frame advances the analysis position by
//! `hop * tempo` and picks, within +/- frame/8, the offset whose frame best continues the output
//! so far (normalized cross-correlation of the mono mixdown over the overlap region) — the WSOLA
//! search. At tempo 1.0 the stage is a bit-exact passthrough. `try_seek` multiplies by the tempo
//! to get back to track time, the inverse of the division the seek commands apply upstream.

use rodio::source::SeekError;
use rodio::{ChannelCount, SampleRate, Source};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Frame length as a fraction of a second of audio. Long enough to hold a few periods of bass,
/// short enough that tempo changes track within a fraction of a second.
const FRAME_SEC: f64 = 0.093;
/// Floor for the frame length, so very low output rates still get a usable window.
const MIN_FRAME: usize = 1024;
/// Bounds for the tempo handed to the stage; the engine only ever asks inside [0.1, 1.9].
const MIN_CONTROL_TEMPO: f32 = 0.05;
const MAX_CONTROL_TEMPO: f32 = 20.0;
/// Below this distance from 1.0 the stage is a passthrough, not a stretch.
const UNITY_EPS: f32 = 1e-4;

/// The engine's side of the stage: the tempo to stretch at, readable from the audio thread and
/// writable from the command thread without a lock.
pub(crate) struct KeylockControl {
    tempo: AtomicU32,
}

impl KeylockControl {
    fn new(tempo: f32) -> Self {
        KeylockControl {
            tempo: AtomicU32::new(tempo.clamp(MIN_CONTROL_TEMPO, MAX_CONTROL_TEMPO).to_bits()),
        }
    }

    pub(crate) fn set_tempo(&self, tempo: f32) {
        self.tempo
            .store(tempo.clamp(MIN_CONTROL_TEMPO, MAX_CONTROL_TEMPO).to_bits(), Ordering::Relaxed);
    }

    pub(crate) fn tempo(&self) -> f32 {
        f32::from_bits(self.tempo.load(Ordering::Relaxed))
    }
}

/// A WSOLA time-stretching `Source`. See the module docs for the chain and the algorithm.
pub(crate) struct Keylock<S> {
    inner: S,
    channels: usize,
    sample_rate: u32,
    control: Arc<KeylockControl>,
    frame_len: usize,
    hop: usize,
    delta: usize,
    /// Periodic Hann analysis window; sums to 1 with its hop-shifted self.
    window: Vec<f32>,
    /// Interleaved input pulled from `inner` but not yet consumed; `inbuf[i * channels + c]` is
    /// absolute frame `in_base + i`.
    inbuf: VecDeque<f32>,
    in_base: i64,
    input_done: bool,
    /// Absolute input frame the next analysis frame nominally starts at.
    next_a: f64,
    /// Output accumulator, interleaved, `frame_len` frames; the first `hop` are complete once the
    /// current frame has been added.
    acc: Vec<f32>,
    /// Synthesized samples ready to hand out.
    pending: VecDeque<f32>,
    finished: bool,
}

impl<S: Source> Keylock<S> {
    pub(crate) fn new(inner: S) -> (Self, Arc<KeylockControl>) {
        let channels = inner.channels().get() as usize;
        let sample_rate = inner.sample_rate().get();
        let frame_len = ((sample_rate as f64 * FRAME_SEC).round() as usize).max(MIN_FRAME) & !1;
        let hop = frame_len / 2;
        let delta = (frame_len / 8).max(1);
        let window = (0..frame_len)
            .map(|i| 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / frame_len as f32).cos()))
            .collect();
        let control = Arc::new(KeylockControl::new(1.0));
        let keylock = Keylock {
            inner,
            channels,
            sample_rate,
            control: Arc::clone(&control),
            frame_len,
            hop,
            delta,
            window,
            inbuf: VecDeque::new(),
            in_base: 0,
            input_done: false,
            next_a: 0.0,
            acc: vec![0.0; frame_len * channels],
            pending: VecDeque::new(),
            finished: false,
        };
        (keylock, control)
    }

    fn frames_buffered(&self) -> i64 {
        (self.inbuf.len() / self.channels) as i64
    }

    /// Pulls from the decoder until `end_frame` is buffered (or the input ends). Runs on the
    /// audio thread, so a slow decoder blocks here exactly as it would in plain playback.
    fn ensure_input(&mut self, end_frame: i64) {
        while !self.input_done && self.in_base + self.frames_buffered() < end_frame {
            match self.inner.next() {
                Some(sample) => self.inbuf.push_back(sample),
                None => self.input_done = true,
            }
        }
    }

    /// Drops buffered input the next search can no longer reach.
    fn trim_input(&mut self) {
        let end = self.in_base + self.frames_buffered();
        let keep_from = (self.next_a.round() as i64 - self.delta as i64).clamp(self.in_base, end);
        if keep_from > self.in_base {
            let samples = ((keep_from - self.in_base) as usize) * self.channels;
            self.inbuf.drain(..samples);
            self.in_base = keep_from;
        }
    }

    /// One interleaved input sample by absolute frame; zero past the end of the input, which
    /// fades the tail out instead of clicking.
    fn input_sample(&self, frame: i64, channel: usize) -> f32 {
        let index = frame - self.in_base;
        if index < 0 || index >= self.frames_buffered() {
            return 0.0;
        }
        self.inbuf[index as usize * self.channels + channel]
    }

    /// Synthesizes one output frame: WSOLA search, overlap-add, then the completed first hop is
    /// queued for output.
    fn produce_frame(&mut self) {
        let tempo = self.control.tempo();
        let nominal = self.next_a.round() as i64;
        let lo = (nominal - self.delta as i64).max(0);
        let hi = nominal + self.delta as i64 + self.frame_len as i64;
        self.ensure_input(hi);

        // Mono mixdown of the whole search range, so each candidate is a slice of one buffer
        // rather than a fresh allocation per candidate.
        let width = (hi - lo) as usize;
        let mut search = vec![0.0f32; width];
        for j in 0..width {
            let frame = lo + j as i64;
            if frame >= self.in_base && frame < self.in_base + self.frames_buffered() {
                let base = (frame - self.in_base) as usize * self.channels;
                let mut sum = 0.0;
                for c in 0..self.channels {
                    sum += self.inbuf[base + c];
                }
                search[j] = sum / self.channels as f32;
            }
        }

        // Reference: the output window the new frame will overlap, as mono. The new frame lands
        // one hop into the current window, so candidate sample i is compared with reference
        // sample hop + i — the overlap region.
        let mut reference = vec![0.0f32; self.frame_len];
        for i in 0..self.frame_len {
            let mut sum = 0.0;
            for c in 0..self.channels {
                sum += self.acc[i * self.channels + c];
            }
            reference[i] = sum / self.channels as f32;
        }
        let overlap = &reference[self.hop..];
        let ref_norm = overlap.iter().map(|v| v * v).sum::<f32>().sqrt();

        let mut best = self.delta;
        let mut best_score = f32::NEG_INFINITY;
        if ref_norm > 1e-9 {
            for offset in 0..=(2 * self.delta) {
                let candidate = &search[offset..offset + self.hop];
                let dot = candidate.iter().zip(overlap).map(|(a, b)| a * b).sum::<f32>();
                let norm = candidate.iter().map(|v| v * v).sum::<f32>().sqrt();
                let score = dot / (norm * ref_norm + 1e-12);
                if score > best_score {
                    best_score = score;
                    best = offset;
                }
            }
        }
        let start = lo + best as i64;
        // The nominal position advances by exactly hop * tempo per output frame — anchored to
        // the nominal position, not the chosen offset, so the output length is the input length
        // divided by the tempo and the search cannot random-walk the rate.
        self.next_a = nominal as f64 + self.hop as f64 * tempo as f64;

        // Slide the output window by one hop, then overlap-add the chosen frame across it.
        self.acc.copy_within(self.hop * self.channels.., 0);
        for v in &mut self.acc[self.hop * self.channels..] {
            *v = 0.0;
        }
        for i in 0..self.frame_len {
            let w = self.window[i];
            for c in 0..self.channels {
                self.acc[i * self.channels + c] += w * self.input_sample(start + i as i64, c);
            }
        }
        // The first hop is now fully synthesized — no future frame touches it.
        for i in 0..self.hop {
            for c in 0..self.channels {
                self.pending.push_back(self.acc[i * self.channels + c]);
            }
        }
        self.trim_input();
    }
}

impl<S: Source> Iterator for Keylock<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if let Some(sample) = self.pending.pop_front() {
            return Some(sample);
        }
        let tempo = self.control.tempo();
        if (tempo - 1.0).abs() < UNITY_EPS {
            // Passthrough — but the stretch path buffers input ahead of the decoder, so drain
            // that first or those samples would be skipped.
            if !self.inbuf.is_empty() {
                let sample = self.inbuf.pop_front()?;
                if self.inbuf.len() % self.channels == 0 {
                    self.in_base += 1;
                }
                return Some(sample);
            }
            return self.inner.next();
        }
        if self.finished {
            return None;
        }
        let nominal = self.next_a.round() as i64;
        if self.input_done && nominal + self.frame_len as i64 > self.in_base + self.frames_buffered() {
            // No complete frame left to analyze: flush the accumulator's tail and end.
            for i in 0..self.frame_len {
                for c in 0..self.channels {
                    self.pending.push_back(self.acc[i * self.channels + c]);
                }
            }
            for v in &mut self.acc {
                *v = 0.0;
            }
            self.finished = true;
            return self.pending.pop_front();
        }
        self.produce_frame();
        self.pending.pop_front()
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (0, None)
    }
}

impl<S: Source> Source for Keylock<S> {
    fn current_span_len(&self) -> Option<usize> {
        // The transform scrambles packet boundaries; position comes from `Counted` anyway.
        None
    }

    fn channels(&self) -> ChannelCount {
        self.inner.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        // Depends on the tempo, which can change mid-track.
        None
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        let tempo = self.control.tempo().max(1e-3);
        // `pos` is in this stage's output time; the inner source is in track time, which runs at
        // `tempo` per output second while stretching.
        self.inner.try_seek(pos.mul_f32(tempo))?;
        let frame = (pos.as_secs_f64() * tempo as f64 * self.sample_rate as f64).round() as i64;
        self.inbuf.clear();
        self.in_base = frame;
        self.input_done = false;
        self.next_a = frame as f64;
        for v in &mut self.acc {
            *v = 0.0;
        }
        self.pending.clear();
        self.finished = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::num::NonZero;
    use std::sync::atomic::AtomicU64;

    const RATE: u32 = 8_000;
    const FREQ: f32 = 440.0;

    /// A mono sine that counts its own frames and supports seek, like the decoders do.
    struct Sine {
        frame: Arc<AtomicU64>,
        limit: Option<u64>,
    }

    impl Sine {
        fn sample_at(frame: u64) -> f32 {
            (frame as f32 * FREQ * 2.0 * std::f32::consts::PI / RATE as f32).sin() * 0.5
        }
    }

    impl Iterator for Sine {
        type Item = f32;
        fn next(&mut self) -> Option<f32> {
            let frame = self.frame.fetch_add(1, Ordering::Relaxed);
            if let Some(limit) = self.limit {
                if frame >= limit {
                    return None;
                }
            }
            Some(Self::sample_at(frame))
        }
    }

    impl Source for Sine {
        fn current_span_len(&self) -> Option<usize> {
            None
        }
        fn channels(&self) -> ChannelCount {
            NonZero::new(1).unwrap()
        }
        fn sample_rate(&self) -> SampleRate {
            NonZero::new(RATE).unwrap()
        }
        fn total_duration(&self) -> Option<Duration> {
            None
        }
        fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
            self.frame.store((pos.as_secs_f64() * RATE as f64) as u64, Ordering::Relaxed);
            Ok(())
        }
    }

    fn drain<S: Source>(source: &mut S, max: usize) -> Vec<f32> {
        let mut out = Vec::new();
        for _ in 0..max {
            match source.next() {
                Some(sample) => out.push(sample),
                None => break,
            }
        }
        out
    }

    fn zero_crossing_freq(samples: &[f32]) -> f32 {
        let crossings = samples.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count();
        crossings as f32 / 2.0 / (samples.len() as f32 / RATE as f32)
    }

    #[test]
    fn passthrough_at_unity_is_bit_exact() {
        let frame = Arc::new(AtomicU64::new(0));
        let (mut source, control) = Keylock::new(Sine { frame: Arc::clone(&frame), limit: Some(2 * RATE as u64) });
        control.set_tempo(1.0);
        let out = drain(&mut source, 2 * RATE as usize + 16);
        assert_eq!(out.len(), 2 * RATE as usize);
        for (i, sample) in out.iter().enumerate() {
            assert!(
                (sample - Sine::sample_at(i as u64)).abs() < 1e-6,
                "sample {i}: {sample} vs {}",
                Sine::sample_at(i as u64)
            );
        }
    }

    #[test]
    fn stretching_faster_halves_duration_and_keeps_pitch() {
        let frame = Arc::new(AtomicU64::new(0));
        let (mut source, control) = Keylock::new(Sine { frame: Arc::clone(&frame), limit: Some(2 * RATE as u64) });
        control.set_tempo(2.0);
        let out = drain(&mut source, 3 * RATE as usize);
        let seconds = out.len() as f32 / RATE as f32;
        assert!(seconds > 0.85 && seconds < 1.35, "2 s at 2x should be about 1 s, got {seconds} s");
        let freq = zero_crossing_freq(&out);
        assert!((freq - FREQ).abs() < FREQ * 0.08, "pitch moved: {freq} Hz vs {FREQ} Hz");
    }

    #[test]
    fn stretching_slower_doubles_duration_and_keeps_pitch() {
        let frame = Arc::new(AtomicU64::new(0));
        let (mut source, control) = Keylock::new(Sine { frame: Arc::clone(&frame), limit: Some(2 * RATE as u64) });
        control.set_tempo(0.5);
        let out = drain(&mut source, 5 * RATE as usize);
        let seconds = out.len() as f32 / RATE as f32;
        assert!(seconds > 3.4 && seconds < 4.6, "2 s at 0.5x should be about 4 s, got {seconds} s");
        let freq = zero_crossing_freq(&out);
        assert!((freq - FREQ).abs() < FREQ * 0.08, "pitch moved: {freq} Hz vs {FREQ} Hz");
    }

    #[test]
    fn seek_converts_output_time_to_track_time() {
        let frame = Arc::new(AtomicU64::new(0));
        let (mut source, control) = Keylock::new(Sine { frame: Arc::clone(&frame), limit: None });
        control.set_tempo(1.5);
        // Play a little so the stretch path has buffered input ahead of the decoder.
        let _ = drain(&mut source, RATE as usize / 10);
        source.try_seek(Duration::from_secs(2)).unwrap();
        let landed = frame.load(Ordering::Relaxed) as f64;
        let expected = 2.0 * 1.5 * RATE as f64;
        assert!((landed - expected).abs() < 8.0, "seek landed at {landed}, expected {expected}");
    }

    #[test]
    fn tempo_can_change_mid_stream_without_breaking() {
        let frame = Arc::new(AtomicU64::new(0));
        let (mut source, control) = Keylock::new(Sine { frame: Arc::clone(&frame), limit: Some(4 * RATE as u64) });
        control.set_tempo(1.7);
        let a = drain(&mut source, RATE as usize / 2);
        control.set_tempo(1.0);
        let b = drain(&mut source, RATE as usize / 2);
        control.set_tempo(0.6);
        let c = drain(&mut source, RATE as usize / 2);
        assert!(!a.is_empty() && !b.is_empty() && !c.is_empty());
        assert!(a.iter().chain(&b).chain(&c).all(|s| s.is_finite()));
    }

    #[test]
    fn control_tempo_is_clamped() {
        let control = KeylockControl::new(1.0);
        control.set_tempo(100.0);
        assert_eq!(control.tempo(), MAX_CONTROL_TEMPO);
        control.set_tempo(0.0);
        assert_eq!(control.tempo(), MIN_CONTROL_TEMPO);
    }
}
