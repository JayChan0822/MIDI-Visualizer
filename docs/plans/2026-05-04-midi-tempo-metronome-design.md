# MIDI Tempo-Synced Metronome Design

## Summary

Add a global metronome that follows imported MIDI tempo changes during playback and recording, with a user-facing enable switch and a selectable click sound (`woodblock` / `click`). Keep the current project architecture centered on absolute seconds so existing 3D note placement, scrubbing, and audio sync continue to work.

## Current Context

The project is currently implemented as a single-page app in `index.html`.

Relevant existing integration points:

- `index.html:2209-2234` contains the transport toolbar and import buttons.
- `index.html:3010-3040` stores timeline and transport state in `STATE`.
- `index.html:8353-8466` imports MIDI and currently reads only the first tempo and time-signature event.
- `index.html:8868-8952` handles play, stop, seek, and audio synchronization.
- `index.html:8973-9066` renders the time and bar rulers with a fixed `STATE.bpm`.
- `index.html:9111-9158` advances playback using `STATE.currentTime += delta`.

The current code already tracks transport time in seconds and synchronizes optional audio clips to that transport. That means the safest path is to leave the transport clock in seconds and add a secondary timing layer that can answer beat and bar questions against a MIDI tempo map.

## Goals

- Import the full MIDI tempo track instead of only the first BPM event.
- Build reusable timing helpers that convert between seconds and beats.
- Schedule a metronome against the imported tempo map, not a fixed BPM.
- Support accurate behavior across play, pause, stop, and seek.
- Add a global metronome enable switch and sound selector in the toolbar.
- Keep the implementation ready for future features such as tempo-aware bar rulers or count-in without forcing those features now.

## Non-Goals

- Rebuild the 3D layout around beat-based coordinates.
- Rewrite the ruler UI to show tempo-aware bar spacing in this iteration.
- Add count-in, quantization, or grid snapping.
- Record the metronome into exported video output.
- Add per-track metronome behavior.
- Fully support multiple time-signature changes in the UI during this iteration.

## Approved Product Decisions

- Approach: add a middle timing layer instead of a full transport rewrite.
- Metronome behavior: global on/off switch.
- Sound choices: two user-selectable sounds, `woodblock` and `click`.
- Scope: metronome must follow imported MIDI tempo changes during playback and recording.

## Architecture

### 1. Tempo Map and Timing State

Extend `STATE` with four timing-focused structures:

```js
tempoMap: [
  { time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 }
],
timeSignatureMap: [
  { time: 0, numerator: 4, denominator: 4, barStart: 1, beatStart: 0 }
],
midiTiming: {
  source: 'default',
  trimOffset: 0
},
metronome: {
  enabled: false,
  sound: 'woodblock',
  volume: 0.7,
  lookaheadSec: 0.12,
  cursorTime: 0,
  scheduledUntilAudioTime: 0,
  lastScheduledBeatKey: null
}
```

`tempoMap` is the core addition. Each segment stores:

- `time`: segment start in transport seconds
- `bpm`: tempo for the segment
- `beatStart`: cumulative beat position at that segment start
- `secondsPerBeat`: cached `60 / bpm`

This allows fast queries in both directions:

- second -> beat
- beat -> second
- second -> bar/beat-in-bar
- second -> next beat boundary

### 2. MIDI Import Integration

During MIDI import:

1. Read `midiData.header.tempos` and `midiData.header.timeSignatures`.
2. Preserve the current "trim initial silence" logic.
3. Apply the same trim offset to imported tempo and time-signature events so timing data stays aligned with the shifted note times.
4. Build a normalized `tempoMap` and `timeSignatureMap`.
5. Continue updating `STATE.bpm` and `STATE.timeSignature` from the first effective entries for backward compatibility with unchanged code paths.

Fallback behavior:

- If the MIDI file has no tempo events, create a single segment from the current `STATE.bpm`.
- If the MIDI file has no time-signature events, create a single `4/4` entry or use the current `STATE.timeSignature`.

### 3. Pure Timing Helper Layer

Add pure helper functions near the MIDI/timeline utilities in `index.html`:

- `buildTempoMap(tempos, fallbackBpm, trimOffset = 0)`
- `buildTimeSignatureMap(timeSignatures, fallbackNumerator, trimOffset = 0)`
- `getTempoSegmentAtTime(time, tempoMap = STATE.tempoMap)`
- `getBeatPositionAtTime(time, tempoMap = STATE.tempoMap)`
- `getTimeAtBeat(beat, tempoMap = STATE.tempoMap)`
- `getNextBeatAfter(time, tempoMap = STATE.tempoMap)`
- `getBarBeatAtTime(time, tempoMap = STATE.tempoMap, timeSignatureMap = STATE.timeSignatureMap)`

These helpers should stay framework-free so they can be tested with `node:test` by extracting function bodies from `index.html`, matching the existing test style.

### 4. Metronome Engine

Use a lightweight Web Audio scheduler instead of firing clicks directly inside animation frames.

Core flow:

1. On play start, initialize metronome scheduling from `STATE.currentTime`.
2. On each animation frame while playing, schedule clicks for the next short audio window.
3. On pause or stop, reset scheduling state.
4. On seek, reset scheduling state and resume from the new transport time.

Key helper functions:

- `ensureSharedAudioContext()`
- `resetMetronomeSchedule(time = STATE.currentTime)`
- `scheduleMetronomeWindow()`
- `collectMetronomeEvents(startTime, endTime)`
- `scheduleClickSound(audioWhen, isAccent, soundName, volume)`

The scheduler should work like this:

- Compute beat events in transport seconds.
- Convert each event into `AudioContext.currentTime`.
- Use a short lookahead window (`~120ms`) to stay stable under rendering jitter.
- Use one sound for accented beats and another envelope/frequency for non-accented beats.

### 5. Click Sound Design

Do not add external sample files in this iteration.

Implement the two sound modes with synthesized clicks:

- `woodblock`: short filtered burst with a stronger transient
- `click`: tighter oscillator burst with less resonance

Accent behavior:

- First beat of each bar is louder and slightly brighter.
- Other beats are quieter and slightly lower in frequency.

This keeps the feature self-contained and avoids adding asset-loading or cache management now.

### 6. Transport Integration

Wire the new timing layer into existing transport functions:

- `togglePlay()` should start or stop metronome scheduling alongside audio/video sync.
- `stopPlay()` should reset the scheduler before seeking to zero.
- `seekTo(time)` should clear scheduled state and restart scheduling from the new time if transport remains playing.
- `animate()` should continue to own `STATE.currentTime` but call `scheduleMetronomeWindow()` when metronome is enabled.

The current transport remains second-based. The metronome uses timing helpers to interpret those seconds musically.

### 7. Toolbar UI

Add two controls near the existing transport buttons:

- A metronome toggle button
- A compact `<select>` for sound choice

Expected behavior:

- Toggle off: no metronome scheduling, fully silent
- Toggle on: metronome follows playback and recording
- Sound switch while idle: update state immediately
- Sound switch during playback: new events use the new sound without needing a full restart

## Testing Strategy

### Automated

Add a new test file:

- `tests/midi-tempo-metronome.test.js`

Test the pure timing helpers and event planning logic:

- tempo map normalization with multiple tempo changes
- trim-offset alignment for imported tempo events
- beat lookup before and after tempo changes
- next-beat lookup when seeking from arbitrary positions
- bar/accent detection in `4/4`
- metronome event collection across tempo boundaries

### Manual

Verify in the browser:

- fixed-tempo MIDI playback with metronome enabled
- multi-tempo MIDI playback with metronome enabled
- seek during playback and confirm no duplicate or stale clicks
- pause/resume and stop/restart behavior
- recording with metronome enabled
- switching between `woodblock` and `click`
- metronome disabled remains completely silent

## Risks and Mitigations

### Risk: frame jitter causes timing drift

Mitigation:

- schedule against `AudioContext.currentTime`, not directly from frame callbacks
- keep a short rolling lookahead window

### Risk: duplicated scheduling after seek or pause

Mitigation:

- centralize reset logic in `resetMetronomeSchedule()`
- call it from every transport transition path

### Risk: tempo events become misaligned after trimming initial silence

Mitigation:

- apply the same trim offset to header timing events before building the maps
- cover this in automated tests

## Future Follow-Ups

- reuse the timing helpers to render a tempo-aware bar ruler
- add count-in or pre-roll before recording
- support multiple time-signature changes in bar labeling
- optionally route metronome into export audio
