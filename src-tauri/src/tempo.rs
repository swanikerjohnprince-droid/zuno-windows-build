//! Tempo (BPM) and beat-grid measurement from decoded audio.
//!
//! Pure `std` on purpose: no decoder, no Tauri, so it can be tested against synthetic music with
//! a known tempo (see the tests at the bottom) instead of only being trusted on real files.
//!
//! The method is the usual one, kept small enough to read:
//!
//! 1. While the track is decoded, turn it into an *onset envelope* — how suddenly the sound gets
//!    louder, ~200 times a second, in two bands. A kick drum shows up in the low band, hats and
//!    snares in the high one. (`OnsetBuilder`)
//! 2. Find the repeat period that best lines the envelope up with itself — a coarse search over
//!    60-200 BPM, then a fine one around the best candidates, so the answer is good to ~0.01 BPM
//!    rather than the whole-BPM steps a frame-quantised autocorrelation gives. (`estimate`)
//! 3. Slide a comb of that period along the low-band envelope to find where the beats fall,
//!    which gives the first beat and so a whole beat grid. (`estimate`)

/// How many onset-envelope frames per second. 200 is 5 ms, fine enough that a half-frame error
/// at 120 BPM is ~0.6%, which the fine search then removes.
const ENVELOPE_HZ: f64 = 200.0;

const MIN_BPM: f64 = 60.0;
const MAX_BPM: f64 = 200.0;

/// Tracks shorter than this have too few beats to measure honestly.
const MIN_SECONDS: f64 = 8.0;

/// How much the high band (hats, snares, cymbals) counts next to the low band (kick, bass) when
/// deciding the beat. Hats are numerous and often sit on every half-beat, so at equal weight a
/// wrong grid that lands on them looks as good as the right one; the kick and snare are what
/// actually mark the beat.
const HIGH_BAND_WEIGHT: f32 = 0.4;

/// The high band's share when placing the beat grid. Small: the kick should decide where beats
/// are, but a kick pattern that is syncopated (a kick on beat 1 and another half a beat off the
/// grid) ties on the kick band alone, and the snares and hats on the beat break that tie.
const PHASE_HIGH_BAND_WEIGHT: f32 = 0.15;

pub(crate) struct OnsetBuilder {
    hop: usize,
    frames_in_hop: usize,
    low_coeff: f32,
    mid_coeff: f32,
    low: f32,
    mid: f32,
    low_energy: f32,
    high_energy: f32,
    prev_low: f32,
    prev_high: f32,
    low_onsets: Vec<f32>,
    high_onsets: Vec<f32>,
    sample_rate: u32,
}

impl OnsetBuilder {
    pub(crate) fn new(sample_rate: u32) -> Self {
        let sr = sample_rate.max(8_000) as f32;
        let pole = |cutoff_hz: f32| 1.0 - (-2.0 * std::f32::consts::PI * cutoff_hz / sr).exp();
        OnsetBuilder {
            hop: ((sample_rate as f64 / ENVELOPE_HZ).round() as usize).max(1),
            frames_in_hop: 0,
            low_coeff: pole(150.0),
            mid_coeff: pole(2_500.0),
            low: 0.0,
            mid: 0.0,
            low_energy: 0.0,
            high_energy: 0.0,
            prev_low: 0.0,
            prev_high: 0.0,
            low_onsets: Vec::new(),
            high_onsets: Vec::new(),
            sample_rate,
        }
    }

    /// One mono frame. Channels are averaged: a kick or snare is centred, and what cancels in the
    /// average (wide, out-of-phase pads) is not what carries the tempo.
    pub(crate) fn push(&mut self, sample: f32) {
        self.low += self.low_coeff * (sample - self.low);
        self.mid += self.mid_coeff * (sample - self.mid);
        let high = sample - self.mid;
        self.low_energy += self.low * self.low;
        self.high_energy += high * high;
        self.frames_in_hop += 1;

        if self.frames_in_hop == self.hop {
            let n = self.hop as f32;
            let low_amp = (self.low_energy / n).sqrt();
            let high_amp = (self.high_energy / n).sqrt();
            // Half-wave rectified: only getting louder counts as an onset.
            self.low_onsets.push((low_amp - self.prev_low).max(0.0));
            self.high_onsets.push((high_amp - self.prev_high).max(0.0));
            self.prev_low = low_amp;
            self.prev_high = high_amp;
            self.low_energy = 0.0;
            self.high_energy = 0.0;
            self.frames_in_hop = 0;
        }
    }

    pub(crate) fn finish(self) -> Option<Tempo> {
        let hz = self.sample_rate as f64 / self.hop as f64;
        estimate(&self.low_onsets, &self.high_onsets, hz)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Tempo {
    pub(crate) bpm: f64,
    /// 0..1. How much better the winning tempo fits than the typical candidate — low for a track
    /// with no steady pulse, where the number should not be trusted.
    pub(crate) confidence: f32,
    /// Seconds from the start of the audio to the first beat of the grid.
    pub(crate) first_beat_sec: f64,
}

fn normalised(values: &[f32]) -> Vec<f32> {
    let mean = values.iter().sum::<f32>() / values.len().max(1) as f32;
    if mean <= f32::EPSILON {
        return vec![0.0; values.len()];
    }
    // Compressed so one huge transient cannot outvote a hundred ordinary ones.
    values.iter().map(|v| (1.0 + 4.0 * v / mean).ln()).collect()
}

/// `values` read at a fractional index, linearly interpolated; zero outside.
#[inline]
fn at(values: &[f32], index: f64) -> f32 {
    if index < 0.0 {
        return 0.0;
    }
    let i = index as usize;
    if i + 1 >= values.len() {
        return 0.0;
    }
    let f = (index - i as f64) as f32;
    values[i] * (1.0 - f) + values[i + 1] * f
}

/// How much of the onset energy falls on a regular grid of `period` frames, at the best offset.
///
/// This is the question a tempo hypothesis actually has to answer: if the beat were here, would
/// the hits land on it? Returns the mean envelope value on the grid and the offset (in frames)
/// that gave it. Compared with the mean over the whole track, a beat-locked tempo scores well
/// above 1 and a wrong one does not — including the 3:2 and 4:3 relatives of the right tempo,
/// whose grids miss most of the hits. (Autocorrelation at long lags could not tell those apart:
/// at bar-length lags every multiple of the bar lines up regardless.)
///
/// Tight loops over a coarse offset step: this is the hot path, and `tauri dev` builds it
/// without optimisation.
fn grid_fit(onsets: &[f32], period: f64, offset_step: f64) -> (f32, f64) {
    let limit = onsets.len() as f64 - 1.0;
    let mut best = (f32::MIN, 0.0);
    let mut offset = 0.0;
    while offset < period {
        let mut sum = 0.0f32;
        let mut count = 0u32;
        let mut position = offset;
        while position < limit {
            sum += at(onsets, position);
            count += 1;
            position += period;
        }
        if count > 0 {
            let mean = sum / count as f32;
            if mean > best.0 {
                best = (mean, offset);
            }
        }
        offset += offset_step;
    }
    best
}

/// A preference for tempos people actually make music at, so that when 70 and 140 fit equally the
/// answer is the likelier one. Centred on 115 BPM and ~0.7 octaves wide: broad enough that a
/// clearly periodic 85 BPM hip-hop track is not pulled up to 170 (a 125-centred, narrower prior
/// did exactly that in testing), and still enough to break a true tie.
fn prior(bpm: f64) -> f32 {
    let octaves = (bpm / 115.0).log2();
    (-0.5 * (octaves / 0.7) * (octaves / 0.7)).exp() as f32
}

/// Grid fit relative to the track's average onset level, weighted by how likely the tempo is.
fn tempo_score(onsets: &[f32], hz: f64, average: f32, bpm: f64, offset_step: f64) -> f32 {
    let (mean, _) = grid_fit(onsets, 60.0 / bpm * hz, offset_step);
    mean / average * prior(bpm)
}

/// The same measure for the coarse search, taken over a few short stretches instead of the whole
/// track. Over two minutes the fit peak is only ~±0.02 BPM wide, so a coarse grid stepping 0.2
/// BPM can walk straight over the true tempo (it did in testing: 98.7 came back as 100). Over a
/// few seconds the peak is broad enough for the grid to land on it. Averaging several stretches
/// keeps one quiet or odd passage from deciding it.
const COARSE_STRETCH_SECONDS: f64 = 8.0;
const COARSE_STRETCHES: usize = 4;

fn coarse_score(onsets: &[f32], hz: f64, average: f32, bpm: f64) -> f32 {
    let length = ((COARSE_STRETCH_SECONDS * hz) as usize).min(onsets.len());
    let period = 60.0 / bpm * hz;
    let spare = onsets.len() - length;
    let mut total = 0.0f32;
    for i in 0..COARSE_STRETCHES {
        let from = spare * i / (COARSE_STRETCHES - 1);
        total += grid_fit(&onsets[from..from + length], period, 1.0).0;
    }
    total / COARSE_STRETCHES as f32 / average * prior(bpm)
}

/// Analysing more than a couple of minutes buys no accuracy and costs time: the middle of the
/// track is taken, which also skips an intro with no beat and an outro that has faded away.
const MAX_ANALYSIS_SECONDS: f64 = 120.0;

pub(crate) fn estimate(low: &[f32], high: &[f32], hz: f64) -> Option<Tempo> {
    let total = low.len().min(high.len());
    if (total as f64) / hz < MIN_SECONDS {
        return None;
    }
    let cap = (MAX_ANALYSIS_SECONDS * hz) as usize;
    let start = total.saturating_sub(cap) / 2;
    let end = (start + cap).min(total);
    let low = normalised(&low[start..end]);
    let high = normalised(&high[start..end]);
    let combined: Vec<f32> = low.iter().zip(&high).map(|(l, h)| l + HIGH_BAND_WEIGHT * h).collect();

    // Remove the slow trend (verses louder than intros) so the autocorrelation compares pulse,
    // not loudness. ~1 s moving average.
    let window = hz.round() as usize;
    let mut flat = vec![0.0f32; combined.len()];
    let mut running = 0.0f32;
    for i in 0..combined.len() {
        running += combined[i];
        if i >= window {
            running -= combined[i - window];
        }
        let span = (i + 1).min(window) as f32;
        flat[i] = (combined[i] - running / span).max(0.0);
    }

    let average = (flat.iter().sum::<f32>() / flat.len().max(1) as f32).max(f32::EPSILON);

    // Coarse: every 0.2 BPM across the whole range, over short stretches.
    let mut coarse: Vec<(f64, f32)> = Vec::new();
    let mut bpm = MIN_BPM;
    while bpm <= MAX_BPM {
        coarse.push((bpm, coarse_score(&flat, hz, average, bpm)));
        bpm += 0.2;
    }
    let mean_score = coarse.iter().map(|(_, s)| *s).sum::<f32>() / coarse.len() as f32;

    // The best few well-separated peaks go on to refinement, because the coarse winner is
    // sometimes an octave off the best one and the finer, half-frame offsets are a better judge.
    let mut order: Vec<usize> = (0..coarse.len()).collect();
    order.sort_by(|a, b| coarse[*b].1.total_cmp(&coarse[*a].1));
    let mut picked: Vec<f64> = Vec::new();
    for index in order {
        let candidate = coarse[index].0;
        if picked.iter().all(|p| (p - candidate).abs() > 3.0) {
            picked.push(candidate);
        }
        if picked.len() == 4 {
            break;
        }
    }

    // Fine: ±0.6 BPM around each, every 0.01 BPM, over the whole window, offsets half a frame apart. Over a couple of
    // minutes 0.01 BPM moves the last beat by several milliseconds, which is why this resolves
    // what a one-beat comparison cannot.
    let mut best = (0.0f64, f32::MIN);
    for centre in picked {
        let mut b = centre - 0.6;
        while b <= centre + 0.6 {
            if (MIN_BPM..=MAX_BPM).contains(&b) {
                let s = tempo_score(&flat, hz, average, b, 0.5);
                if s > best.1 {
                    best = (b, s);
                }
            }
            b += 0.01;
        }
    }
    if best.1 <= 0.0 {
        return None;
    }

    // How much better the winner fits than a typical candidate. A track with a real pulse sits
    // far above the field; noise and drones do not.
    let confidence = ((best.1 - mean_score) / best.1.max(f32::EPSILON)).clamp(0.0, 1.0);

    // Where the beats fall, taken from the kick band rather than from everything: a pattern with
    // a kick once a bar and hats on every half beat has four hats per kick, so the combined
    // envelope puts the "beat" on the hats, half a beat late (it did, in testing). The beat is
    // where the kick is. If the low band has no pulse at this tempo (an acoustic or bassless
    // track) the combined envelope is the better guess, so it is used instead.
    let period = 60.0 / best.0 * hz;
    let phase_envelope: Vec<f32> = low.iter().zip(&high).map(|(l, h)| l + PHASE_HIGH_BAND_WEIGHT * h).collect();
    let phase_mean = (phase_envelope.iter().sum::<f32>() / phase_envelope.len().max(1) as f32).max(f32::EPSILON);
    let (phase_fit, phase_offset) = grid_fit(&phase_envelope, period, 0.5);
    let offset = if phase_fit / phase_mean >= 1.5 { phase_offset } else { grid_fit(&flat, period, 0.5).1 };
    // Back from the analysed window to the start of the audio: the earliest beat at or after 0.
    let period_sec = 60.0 / best.0;
    let first_beat = ((offset + start as f64) / hz).rem_euclid(period_sec);

    Some(Tempo {
        bpm: (best.0 * 100.0).round() / 100.0,
        confidence,
        first_beat_sec: first_beat,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic noise, so the tests are repeatable.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> f32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            ((self.0 >> 11) as f64 / (1u64 << 53) as f64) as f32 * 2.0 - 1.0
        }
    }

    #[derive(Clone, Copy)]
    enum Drum {
        Kick,
        Snare,
        Hat,
    }
    use Drum::*;

    const FOUR_ON_FLOOR: &[(f64, Drum)] = &[
        (0.0, Kick), (1.0, Kick), (2.0, Kick), (3.0, Kick),
        (0.5, Hat), (1.5, Hat), (2.5, Hat), (3.5, Hat),
        (1.0, Snare), (3.0, Snare),
    ];
    const BOOM_BAP: &[(f64, Drum)] = &[
        (0.0, Kick), (2.5, Kick), (1.0, Snare), (3.0, Snare),
        (0.0, Hat), (0.5, Hat), (1.0, Hat), (1.5, Hat), (2.0, Hat), (2.5, Hat), (3.0, Hat), (3.5, Hat),
    ];
    /// One kick a bar and four hats a bar: the beat is the kick, not the (more numerous) hats.
    const SPARSE: &[(f64, Drum)] = &[(0.0, Kick), (0.5, Hat), (1.5, Hat), (2.5, Hat), (3.5, Hat)];

    const SAMPLE_RATE: u32 = 44_100;

    /// `seconds` of synthetic drums at `bpm`, the first kick at `intro` seconds.
    fn render(pattern: &[(f64, Drum)], bpm: f64, seconds: f64, intro: f64, bass: bool) -> Vec<f32> {
        let n = (seconds * SAMPLE_RATE as f64) as usize;
        let mut out = vec![0.0f32; n];
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15 ^ (bpm * 7919.0) as u64);
        let beat = 60.0 / bpm;
        let bars = ((seconds - intro) / (beat * 4.0)).ceil() as usize + 1;
        for bar in 0..bars {
            for &(position, drum) in pattern {
                let start = ((intro + (bar as f64 * 4.0 + position) * beat) * SAMPLE_RATE as f64) as usize;
                let (len, amplitude) = match drum {
                    Kick => (SAMPLE_RATE as usize * 35 / 100, 0.9),
                    Snare => (SAMPLE_RATE as usize / 5, 0.5),
                    Hat => (SAMPLE_RATE as usize * 6 / 100, 0.22),
                };
                for i in 0..len {
                    if start + i >= n {
                        break;
                    }
                    let t = i as f32 / SAMPLE_RATE as f32;
                    let sample = match drum {
                        Kick => {
                            let frequency = 45.0 + 100.0 * (-t / 0.03).exp();
                            (std::f32::consts::TAU * frequency * t).sin() * (-t / 0.12).exp()
                        }
                        Snare => (rng.next() * 0.8 + (std::f32::consts::TAU * 190.0 * t).sin() * 0.4) * (-t / 0.07).exp(),
                        Hat => rng.next() * (-t / 0.012).exp(),
                    };
                    out[start + i] += sample * amplitude;
                }
            }
        }
        if bass {
            for (i, sample) in out.iter_mut().enumerate() {
                let t = i as f32 / SAMPLE_RATE as f32;
                *sample += 0.18 * (std::f32::consts::TAU * 55.0 * t).sin();
            }
        }
        for sample in out.iter_mut() {
            *sample += rng.next() * 0.004;
        }
        out
    }

    fn measure(audio: &[f32]) -> Option<Tempo> {
        let mut builder = OnsetBuilder::new(SAMPLE_RATE);
        for sample in audio {
            builder.push(*sample);
        }
        builder.finish()
    }

    /// Distance from `estimated` to the true first beat, folded into one beat either side.
    fn phase_error(estimated: &Tempo, intro: f64) -> f64 {
        let beat = 60.0 / estimated.bpm;
        let mut d = (estimated.first_beat_sec - intro).rem_euclid(beat);
        if d > beat / 2.0 {
            d -= beat;
        }
        d.abs()
    }

    #[test]
    fn measures_a_four_on_the_floor_tempo_to_a_hundredth() {
        for bpm in [128.0, 124.5, 127.43, 140.0] {
            let tempo = measure(&render(FOUR_ON_FLOOR, bpm, 90.0, 0.0, true)).expect("a tempo");
            assert!((tempo.bpm - bpm).abs() <= 0.1, "{bpm} measured as {}", tempo.bpm);
            assert!(tempo.confidence > 0.6, "{bpm}: confidence {}", tempo.confidence);
            assert!(phase_error(&tempo, 0.0) < 0.015, "{bpm}: beat grid off by {} s", phase_error(&tempo, 0.0));
        }
    }

    /// A non-integer tempo is where a frame-quantised autocorrelation gives only whole BPM; the
    /// long-lag refinement exists for this.
    #[test]
    fn resolves_a_fractional_tempo_in_a_busier_pattern() {
        let tempo = measure(&render(BOOM_BAP, 98.7, 90.0, 0.0, true)).expect("a tempo");
        assert!((tempo.bpm - 98.7).abs() <= 0.1, "measured {}", tempo.bpm);
    }

    #[test]
    fn a_silent_intro_does_not_shift_the_grid() {
        let tempo = measure(&render(FOUR_ON_FLOOR, 128.0, 100.0, 8.0, true)).expect("a tempo");
        assert!((tempo.bpm - 128.0).abs() <= 0.1, "measured {}", tempo.bpm);
        assert!(phase_error(&tempo, 8.0) < 0.015, "grid off by {} s", phase_error(&tempo, 8.0));
    }

    /// Four hats a bar against one kick: an envelope that treats every onset alike puts the beat
    /// on the hats, half a beat late. The beat is where the kick is.
    #[test]
    fn places_the_beat_on_the_kick_not_the_hats() {
        let tempo = measure(&render(SPARSE, 124.0, 90.0, 0.0, true)).expect("a tempo");
        assert!((tempo.bpm - 124.0).abs() <= 0.1, "measured {}", tempo.bpm);
        assert!(phase_error(&tempo, 0.0) < 0.02, "grid off by {} s", phase_error(&tempo, 0.0));
    }

    #[test]
    fn a_slow_hip_hop_tempo_is_not_pulled_up_an_octave() {
        let tempo = measure(&render(BOOM_BAP, 85.0, 90.0, 0.0, true)).expect("a tempo");
        assert!((tempo.bpm - 85.0).abs() <= 0.1, "85 measured as {}", tempo.bpm);
    }

    /// Where there is no beat the number must not look trustworthy: rhythm scored 0.6-0.8 in
    /// testing, white noise 0.06.
    #[test]
    fn noise_is_reported_as_unreliable() {
        let mut rng = Rng(42);
        let noise: Vec<f32> = (0..SAMPLE_RATE as usize * 60).map(|_| rng.next() * 0.3).collect();
        let confidence = measure(&noise).map_or(0.0, |tempo| tempo.confidence);
        assert!(confidence < 0.3, "noise got confidence {confidence}");
    }

    #[test]
    fn silence_and_clips_too_short_to_judge_give_nothing() {
        assert_eq!(measure(&vec![0.0; SAMPLE_RATE as usize * 60]), None);
        assert_eq!(measure(&render(FOUR_ON_FLOOR, 128.0, 4.0, 0.0, true)), None);
    }
}
