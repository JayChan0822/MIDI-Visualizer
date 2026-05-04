# Tempo Lane and Tempo Undo Design

## Summary

Add a visible, editable tempo lane to the beat-domain timeline and fix undo/redo so imported tempo data is restored and removed together with imported MIDI tracks. The first iteration should behave like a simplified Cubase tempo editor: discrete tempo points only, always rendered against the timeline, with drag editing for position and BPM.

## Current Context

The app is still implemented as a single-file `index.html` with lightweight `node:test` coverage for extracted pure helpers.

Relevant current integration points:

- `index.html:3308-3715` defines `HistoryMgr` and currently treats `import_tracks` as track-only history.
- `index.html:9129-9228` imports MIDI and writes `STATE.tempoMap`, `STATE.timeSignatureMap`, `STATE.midiTiming`, and `STATE.bpm` directly as side effects.
- `index.html:8838-8901` contains beat/time mapping helpers used by the beat-domain timeline.
- `index.html:9579-9835` computes timeline width and rulers from the current tempo map.
- `index.html:10412-10549` persists timeline zoom but does not persist editable tempo-track metadata as a first-class project object.

## Goals

- Undo imported tempo data together with imported tracks.
- Redo imported tempo data together with imported tracks.
- Show a dedicated tempo lane in the timeline.
- Visualize imported tempo points as editable nodes.
- Support discrete tempo point add, move, and delete interactions.
- Keep playback, metronome, rulers, and beat-domain layout synchronized with edited tempo data.
- Save and restore edited tempo maps through project JSON.

## Non-Goals

- Tempo ramps or curved transitions in this iteration.
- A separate modal tempo editor window.
- Multi-select, copy/paste, or lasso editing for tempo points.
- A dedicated time-signature lane in this iteration.
- Editing exported audio/video tempo automation separately from playback tempo.

## Root Cause: Imported Tempo Undo Bug

The undo issue is not in tempo math. It is a history snapshot problem.

Current MIDI import does two independent things:

1. It creates or fills MIDI tracks.
2. It mutates global tempo-related state.

Only step 1 is tracked in `HistoryMgr` under `import_tracks`. Undo deletes the imported tracks, but the global tempo state remains because there is no matching snapshot to restore. Any fix that only clears tempo map conditionally during undo would still be fragile, because tempo edits, project restore, and redo would continue to diverge.

The fix should make tempo-related state part of history whenever import or tempo editing changes it.

## Approved Product Decisions

- Tempo editing UI: dedicated inline tempo lane, not a modal window.
- First iteration tempo points: discrete jumps only.
- Timeline layout stays beat-domain.
- Lower ruler stays time-based.
- Tempo lane should be togglable but live in the same scroll/zoom system as the main timeline.

## Architecture

### 1. Promote Tempo State to First-Class Project State

Tempo state must be treated as part of the editable project, not just imported metadata.

Add or formalize:

```js
STATE.tempoMap
STATE.timeSignatureMap
STATE.midiTiming
STATE.tempoLaneVisible
STATE.selectedTempoPointId
```

Tempo points remain represented through `STATE.tempoMap`, but the lane UI may derive render-specific objects from it.

### 2. Snapshot Tempo State in History

Two history paths must change:

- `import_tracks`
- new `edit_tempo_map`

For `import_tracks`, store:

```js
{
  trackIds,
  tracksData,
  oldTempoState: {
    tempoMap,
    timeSignatureMap,
    midiTiming,
    bpm
  },
  newTempoState: {
    tempoMap,
    timeSignatureMap,
    midiTiming,
    bpm
  }
}
```

Undo restores `oldTempoState`, redo restores `newTempoState`.

For direct tempo edits, use a dedicated command that only snapshots tempo-related state. This keeps the editing model consistent and avoids overloading unrelated command types.

### 3. Add a Dedicated Tempo Lane

Insert a `tempo-lane` row directly below the rulers and above normal track lanes. It should:

- share horizontal scroll with the timeline
- share beat-domain x positions
- have fixed height
- render a polyline or stepped line through discrete tempo points
- render draggable point handles

The lane should not behave like a normal MIDI/audio track. It is a global automation lane and should live outside `STATE.tracks`.

### 4. Pure Tempo-Lane Helper Layer

Add pure helpers so rendering and editing are testable:

- `cloneTempoState()`
- `restoreTempoState(snapshot)`
- `normalizeEditableTempoMap(tempoMap)`
- `getTempoPointScreenY(bpm, laneHeight, bpmRange)`
- `getBpmFromTempoLaneY(offsetY, laneHeight, bpmRange)`
- `insertTempoPointAtTime(time, bpm, tempoMap)`
- `moveTempoPoint(pointIndex, nextTime, nextBpm, tempoMap)`
- `removeTempoPoint(pointIndex, tempoMap)`

These helpers should return new arrays or normalized state so `HistoryMgr` snapshots remain stable and predictable.

### 5. Editing Model

Initial interaction set:

- click empty lane: insert point at clicked musical position with BPM inferred from the surrounding segment
- drag point horizontally: move tempo change location
- drag point vertically: change BPM
- delete selected point: remove point, except the first point

Constraints:

- first point always remains at time `0`
- tempo points remain sorted by time
- BPM clamped to a safe editable range, for example `20..300`
- no two points occupy the same exact time after normalization; later edits overwrite or merge

### 6. Synchronization Rules

After every tempo edit:

- `STATE.tempoMap` is replaced with the normalized result
- `STATE.bpm` mirrors the first tempo point for legacy compatibility
- `updateTotalDuration()` reruns
- `renderRulers()` reruns
- clip positions rerender in beat-domain
- playhead rerenders
- metronome schedule resets from `STATE.currentTime`

The existing second-based playback engine remains unchanged. Only the mapping layer is updated.

### 7. Persistence

Project save/load must preserve:

- edited `tempoMap`
- `timeSignatureMap`
- `midiTiming`
- `tempoLaneVisible`

Older projects without these fields should still load using current fallback behavior.

## UI Sketch

Tempo lane toolbar control:

- add a `Tempo` toggle button near other timeline controls

Tempo lane row contents:

- left label area: `Tempo`
- right drawing area: stepped line plus point nodes
- hover or selected node label: `120 BPM`

No modal editor in iteration one.

## Testing Strategy

Add or extend pure-function tests in `tests/midi-tempo-metronome.test.js` for:

- imported tempo undo snapshots restoring the previous tempo state
- tempo state restore helper cloning correctly
- equal-beat spacing remaining stable after tempo edits
- inserting a tempo point preserves sorting and normalization
- moving a tempo point updates both time and BPM
- deleting a non-initial tempo point removes it
- lower time ruler continues to map real time through beat-domain x positions after tempo edits

Manual verification should cover:

1. Import a MIDI with tempo changes.
2. Show the tempo lane and confirm points are visible.
3. Undo import and confirm both tracks and tempo changes disappear.
4. Redo import and confirm both tracks and tempo changes return.
5. Add, drag, and delete tempo points.
6. Confirm rulers, clip layout, and metronome follow the edited tempo map.
7. Save and reload the project and confirm tempo edits persist.

## Risks

### Risk: tempo edits destabilize beat-domain clip layout

The new timeline already maps time to beat-based x positions. Tempo edits will move clip visuals globally because beat positions depend on the tempo map. This is correct behavior, but the implementation must rerender all clip DOM positions after every tempo edit.

### Risk: undo history stores live references instead of snapshots

Tempo state must be deeply cloned when saved into history commands. Reusing array references would cause undo entries to mutate as the user keeps editing.

### Risk: imported default tempo and manually edited tempo become ambiguous

`midiTiming` should keep enough source metadata to distinguish imported tempo from fallback tempo, but the editing surface should always operate on the current effective tempo map.

## Follow-On Ideas

- ramp and curve tempo transitions
- time-signature lane
- numeric BPM editor popover on double-click
- snapping tempo points to beat or bar boundaries
- list/table inspector for exact tempo event editing
