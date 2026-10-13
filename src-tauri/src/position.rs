//! Exact track position, independent of playback speed.
//!
//! rodio's `Player::get_pos` is not the position in the track once the speed is anything but 1:
//! it reports *output* time, and for a decoder that reports no span length (Opus, here) it is
//! recomputed from the *current* speed over everything played so far, so changing speed mid-track
//! makes it lurch — measured against the real chain, a 1.0 -> 1.5 change reads 6.7 s while the
//! track is at 10.0 s. A tempo fader is exactly a speed change mid-track.
//!
//! `Counted` sits in the chain *before* rodio's speed stage, so what it counts is decoder output:
//! seconds of the recording, whatever the speed. It is told about seeks too, because rodio hands
//! `try_seek` the position already converted back into track time at that point.

use rodio::source::SeekError;
use rodio::{ChannelCount, SampleRate, Source};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// The reading side, held by the engine; the audio thread owns the `Counted` that writes it.
pub(crate) struct PositionCounter {
    frames: AtomicU64,
    sample_rate: u32,
}

impl PositionCounter {
    /// Seconds into the recording that have been handed to the output.
    pub(crate) fn seconds(&self) -> f64 {
        self.frames.load(Ordering::Relaxed) as f64 / self.sample_rate.max(1) as f64
    }
}

pub(crate) struct Counted<S> {
    inner: S,
    channels: u64,
    sample_rate: u32,
    samples: u64,
    counter: Arc<PositionCounter>,
}

impl<S: Source> Counted<S> {
    pub(crate) fn new(inner: S) -> (Self, Arc<PositionCounter>) {
        let channels = inner.channels().get() as u64;
        let sample_rate = inner.sample_rate().get();
        let counter = Arc::new(PositionCounter { frames: AtomicU64::new(0), sample_rate });
        let counted = Counted { inner, channels, sample_rate, samples: 0, counter: Arc::clone(&counter) };
        (counted, counter)
    }

    fn publish(&self) {
        self.counter.frames.store(self.samples / self.channels, Ordering::Relaxed);
    }
}

impl<S: Source> Iterator for Counted<S> {
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next();
        if sample.is_some() {
            self.samples += 1;
            // A store every 256 samples (a few ms of audio) keeps this off the hot path while
            // staying far finer than anything that reads it.
            if self.samples & 0xFF == 0 {
                self.publish();
            }
        } else {
            self.publish();
        }
        sample
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<S: Source> Source for Counted<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }

    fn channels(&self) -> ChannelCount {
        self.inner.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)?;
        self.samples = (pos.as_secs_f64() * self.sample_rate as f64).round() as u64 * self.channels;
        self.publish();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::Player;
    use std::num::NonZero;

    const RATE: u32 = 44_100;
    const CHANNELS: u16 = 2;

    /// A decoder stand-in that also keeps its own exact frame count, to compare against.
    struct Tone {
        frame: Arc<AtomicU64>,
        sub: u16,
        span: Option<usize>,
    }

    impl Iterator for Tone {
        type Item = f32;
        fn next(&mut self) -> Option<f32> {
            let frame = self.frame.load(Ordering::Relaxed);
            self.sub += 1;
            if self.sub == CHANNELS {
                self.sub = 0;
                self.frame.store(frame + 1, Ordering::Relaxed);
            }
            Some(((frame as f32) * 0.05).sin() * 0.3)
        }
    }

    impl Source for Tone {
        fn current_span_len(&self) -> Option<usize> {
            self.span
        }
        fn channels(&self) -> ChannelCount {
            NonZero::new(CHANNELS).unwrap()
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

    /// The chain the engine builds, with the audio device replaced by pulling samples by hand.
    /// `span` is what the decoder reports: `None` behaves like `OpusSource`, `Some` like the
    /// symphonia decoders — rodio's own position behaves differently for each, and both matter.
    fn check(span: Option<usize>) {
        let (mixer, mut device) = rodio::mixer::mixer(NonZero::new(CHANNELS).unwrap(), NonZero::new(RATE).unwrap());
        let player = Player::connect_new(&mixer);
        let frame = Arc::new(AtomicU64::new(0));
        let (counted, counter) = Counted::new(Tone { frame: Arc::clone(&frame), sub: 0, span });
        player.append(counted);
        player.play();

        let mut pull = |seconds: f64| {
            for _ in 0..(seconds * RATE as f64 * CHANNELS as f64) as usize {
                let _ = device.next();
            }
        };
        let truth = |frame: &Arc<AtomicU64>| frame.load(Ordering::Relaxed) as f64 / RATE as f64;
        let agrees = |what: &str, frame: &Arc<AtomicU64>| {
            let error = (counter.seconds() - truth(frame)).abs();
            assert!(error < 0.02, "{what}: counter {} vs real {} ({error} s apart)", counter.seconds(), truth(frame));
        };

        pull(3.0);
        agrees("at normal speed", &frame);
        // Speed changes mid-track in both directions: where rodio's own position jumped by seconds.
        player.set_speed(1.5);
        pull(0.05);
        agrees("just after speeding up", &frame);
        pull(3.0);
        agrees("after playing at 1.5x", &frame);
        player.set_speed(0.8);
        pull(0.05);
        agrees("just after slowing down", &frame);
        pull(3.0);
        agrees("after playing at 0.8x", &frame);

        // try_seek takes output time and blocks until the audio side services it, so something has
        // to keep pulling. Dividing by the speed is what lands on the requested track position.
        let speed = 0.8;
        std::thread::scope(|scope| {
            let handle = scope.spawn(|| player.try_seek(Duration::from_secs_f64(20.0 / speed)));
            while !handle.is_finished() {
                pull(0.01);
            }
            handle.join().unwrap().unwrap();
        });
        pull(0.05);
        assert!((truth(&frame) - 20.0).abs() < 0.2, "seek to 20 s landed at {}", truth(&frame));
        agrees("after seeking", &frame);
    }

    #[test]
    fn follows_the_track_through_speed_changes_and_seeks_without_a_span_length() {
        check(None);
    }

    #[test]
    fn follows_the_track_through_speed_changes_and_seeks_with_per_packet_spans() {
        check(Some(2048));
    }
}
