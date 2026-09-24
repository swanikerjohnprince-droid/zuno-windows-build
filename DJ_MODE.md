# Zuno DJ Mode

This branch adds a first DJ workstation layer to Zuno.

## Included

- DJ Mode button in the title bar.
- Two-deck DJ layout with artwork, transport, cue controls and hot-cue buttons.
- Deck B queue selection from the active Zuno queue.
- Native Rust standby-deck cueing through the existing two-deck audio engine.
- Real native crossfade when `MIX A → B` is pressed.
- Adjustable transition length.
- Position seeking and hot-cue storage on Deck A.
- Mixer/crossfader UI foundation for the next audio-engine pass.

## Important

The real audio transition is powered by Zuno's existing Rust two-deck engine. For the full DJ feature set, the app should use the Rust/native audio engine. If Zuno is running its YouTube iframe engine, the mix action falls back to normal track playback.

The current waveform is a visual beat/waveform placeholder and BPM/key values are placeholders. The next pass should add offline waveform extraction, BPM/beat-grid analysis, true per-deck EQ/filter routing, pitch/time-stretching, loops, beat jump, sync and MIDI control.
