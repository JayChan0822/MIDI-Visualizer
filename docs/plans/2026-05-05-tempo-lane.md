# Tempo Lane and Tempo Undo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix imported tempo undo/redo and add a Cubase-like inline tempo lane with discrete editable tempo points.

**Architecture:** Treat tempo-related state as first-class project state, snapshot it in history for import and tempo-edit commands, then add a dedicated tempo lane that shares the beat-domain timeline mapping already used by clips and the playhead. Keep playback second-based while the timeline and lane remain beat-domain.

**Tech Stack:** Vanilla JavaScript, single-file HTML app, Web Audio API, `@tonejs/midi`, Node built-in test runner (`node:test`)

---

### Task 1: Document and snapshot tempo state for history

**Files:**
- Modify: `index.html:3180-3258`
- Modify: `index.html:3308-3715`
- Test: `tests/midi-tempo-metronome.test.js`

**Step 1: Write the failing test**

```js
test('restoreTempoState clones tempo-related state for undo snapshots', () => {
  const context = {
    STATE: {
      tempoMap: [{ time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 }],
      timeSignatureMap: [{ time: 0, numerator: 4, denominator: 4 }],
      midiTiming: { source: 'imported.mid', trimOffset: 0, hasTempoEvents: true },
      bpm: 120,
    },
  };

  const { cloneTempoState } = loadFunctions(['cloneTempoState'], context);
  const snapshot = cloneTempoState();
  context.STATE.tempoMap[0].bpm = 90;

  assert.equal(snapshot.tempoMap[0].bpm, 120);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL because `cloneTempoState` does not exist yet

**Step 3: Write minimal implementation**

```js
function cloneTempoState() {
  return {
    tempoMap: JSON.parse(JSON.stringify(STATE.tempoMap || [])),
    timeSignatureMap: JSON.parse(JSON.stringify(STATE.timeSignatureMap || [])),
    midiTiming: JSON.parse(JSON.stringify(STATE.midiTiming || {})),
    bpm: STATE.bpm,
  };
}

function restoreTempoState(snapshot) {
  STATE.tempoMap = JSON.parse(JSON.stringify(snapshot.tempoMap || []));
  STATE.timeSignatureMap = JSON.parse(JSON.stringify(snapshot.timeSignatureMap || []));
  STATE.midiTiming = JSON.parse(JSON.stringify(snapshot.midiTiming || {}));
  STATE.bpm = snapshot.bpm || STATE.bpm;
}
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for snapshot cloning coverage

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "test: cover tempo state history snapshots"
```

### Task 2: Fix imported tempo undo/redo

**Files:**
- Modify: `index.html:3696-3715`
- Modify: `index.html:9129-9228`
- Test: `tests/midi-tempo-metronome.test.js`

**Step 1: Write the failing test**

```js
test('applyImportedTempoState restores old and new tempo snapshots for import undo/redo', () => {
  const context = {
    STATE: {
      tempoMap: [{ time: 0, bpm: 90, beatStart: 0, secondsPerBeat: 0.6666666667 }],
      timeSignatureMap: [{ time: 0, numerator: 4, denominator: 4 }],
      midiTiming: { source: 'old.mid', trimOffset: 0, hasTempoEvents: true },
      bpm: 90,
    },
  };

  const { applyImportedTempoState } = loadFunctions([
    'restoreTempoState',
    'applyImportedTempoState',
  ], context);

  applyImportedTempoState({
    oldTempoState: { tempoMap: [{ time: 0, bpm: 90, beatStart: 0, secondsPerBeat: 0.6666666667 }], timeSignatureMap: [], midiTiming: { source: 'old.mid' }, bpm: 90 },
    newTempoState: { tempoMap: [{ time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 }], timeSignatureMap: [], midiTiming: { source: 'new.mid' }, bpm: 120 },
  }, false);

  assert.equal(context.STATE.tempoMap[0].bpm, 120);
  applyImportedTempoState({
    oldTempoState: { tempoMap: [{ time: 0, bpm: 90, beatStart: 0, secondsPerBeat: 0.6666666667 }], timeSignatureMap: [], midiTiming: { source: 'old.mid' }, bpm: 90 },
    newTempoState: { tempoMap: [{ time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 }], timeSignatureMap: [], midiTiming: { source: 'new.mid' }, bpm: 120 },
  }, true);
  assert.equal(context.STATE.tempoMap[0].bpm, 90);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL because import undo only handles track data today

**Step 3: Write minimal implementation**

- Capture `oldTempoState = cloneTempoState()` at the start of `processMidiFile()`.
- Capture `newTempoState = cloneTempoState()` after assigning imported tempo state.
- Store both in the `import_tracks` history command.
- In `HistoryMgr.execute()` for `import_tracks`, restore `oldTempoState` on undo and `newTempoState` on redo before rerendering timeline-dependent UI.

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for import tempo undo/redo state restoration

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "fix: undo imported tempo state with midi tracks"
```

### Task 3: Add failing tests for editable tempo-map helpers

**Files:**
- Modify: `tests/midi-tempo-metronome.test.js`
- Modify: `index.html:8838-8901`

**Step 1: Write the failing test**

```js
test('insertTempoPointAtTime keeps tempo points sorted and normalized', () => {
  const { insertTempoPointAtTime } = loadFunctions(['insertTempoPointAtTime']);
  const result = insertTempoPointAtTime(3, 140, [
    { time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 },
    { time: 4, bpm: 90, beatStart: 8, secondsPerBeat: 0.6666666667 },
  ]);

  assert.deepEqual(result.map((point) => [point.time, point.bpm]), [
    [0, 120],
    [3, 140],
    [4, 90],
  ]);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL because editable tempo-map helpers do not exist yet

**Step 3: Write minimal implementation**

- Add:
  - `normalizeEditableTempoMap(tempoMap)`
  - `insertTempoPointAtTime(time, bpm, tempoMap)`
  - `moveTempoPoint(pointIndex, nextTime, nextBpm, tempoMap)`
  - `removeTempoPoint(pointIndex, tempoMap)`
- Return fresh arrays and clamp BPM to `20..300`.
- Keep first point pinned to time `0`.

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for helper coverage

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "feat: add editable tempo map helpers"
```

### Task 4: Add tempo lane UI shell and rendering

**Files:**
- Modify: `index.html:2200-2430`
- Modify: `index.html:534-620`
- Modify: `index.html:9579-9835`
- Test: `tests/midi-tempo-metronome.test.js`

**Step 1: Write the failing test**

```js
test('collectTempoLaneRenderPoints maps tempo points into beat-domain x positions', () => {
  const context = {
    STATE: {
      pxPerBeat: 48,
      tempoMap: [
        { time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 },
        { time: 4, bpm: 90, beatStart: 8, secondsPerBeat: 0.6666666667 },
      ],
      midiTiming: { hasTempoEvents: true },
      metronome: { fallbackBpm: 120 },
    },
  };

  const { collectTempoLaneRenderPoints } = loadFunctions([
    'getBeatPositionAtTime',
    'getEffectiveTempoMap',
    'getTimelineXAtTime',
    'collectTempoLaneRenderPoints',
  ], context);

  const points = collectTempoLaneRenderPoints(120, 40);
  assert.equal(points[1].x, 384);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL because tempo lane rendering helpers do not exist yet

**Step 3: Write minimal implementation**

- Add a `Tempo` toggle button in the toolbar or ruler controls.
- Add DOM for a dedicated `tempo-lane` row with left label and right drawing area.
- Add rendering helpers:
  - `getTempoPointScreenY(bpm, laneHeight, bpmRange)`
  - `getBpmFromTempoLaneY(offsetY, laneHeight, bpmRange)`
  - `collectTempoLaneRenderPoints(laneHeight, bpmRange)`
- Render stepped lines and point handles into the lane using the current `STATE.tempoMap`.

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for tempo lane render helper coverage

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "feat: add tempo lane rendering shell"
```

### Task 5: Add tempo point editing interactions and history

**Files:**
- Modify: `index.html:6999-7864`
- Modify: `index.html:9579-9835`
- Modify: `index.html:3308-3715`
- Test: `tests/midi-tempo-metronome.test.js`

**Step 1: Write the failing test**

```js
test('applyTempoPointEdit restores old and new tempo maps through history', () => {
  const context = {
    STATE: {
      tempoMap: [{ time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 }],
      timeSignatureMap: [],
      midiTiming: { hasTempoEvents: true },
      bpm: 120,
    },
  };

  const { applyTempoMapEdit } = loadFunctions([
    'restoreTempoState',
    'applyTempoMapEdit',
  ], context);

  const oldState = { tempoMap: [{ time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 }], timeSignatureMap: [], midiTiming: { hasTempoEvents: true }, bpm: 120 };
  const newState = { tempoMap: [{ time: 0, bpm: 140, beatStart: 0, secondsPerBeat: 0.4285714286 }], timeSignatureMap: [], midiTiming: { hasTempoEvents: true }, bpm: 140 };

  applyTempoMapEdit({ oldTempoState: oldState, newTempoState: newState }, false);
  assert.equal(context.STATE.tempoMap[0].bpm, 140);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL because editable tempo history commands do not exist yet

**Step 3: Write minimal implementation**

- Add `STATE.tempoLaneVisible` and `STATE.selectedTempoPointId`.
- Wire lane interactions:
  - click lane background inserts a point
  - drag point changes time/BPM
  - `Delete` removes selected point except index `0`
- Wrap each completed edit in `HistoryMgr.add({ type: 'edit_tempo_map', oldTempoState, newTempoState })`.
- Handle `edit_tempo_map` in `HistoryMgr.execute()`.

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for tempo edit history coverage

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "feat: add editable tempo lane interactions"
```

### Task 6: Persist tempo lane state and re-render timeline correctly

**Files:**
- Modify: `index.html:10412-10549`
- Modify: `index.html:10780-10855`
- Verify: `tests/midi-tempo-metronome.test.js`

**Step 1: Write the failing test**

```js
test('getCurrentState persists tempo map and tempo lane visibility', () => {
  const context = {
    STATE: {
      totalDuration: 12,
      tempoMap: [{ time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 }],
      tempoLaneVisible: true,
      trackRowHeight: 64,
      playbackSpeed: 20,
      noteThickness: 1,
      noteHeightScale: 1.5,
      zSeparation: 0.3,
      noteShape: 'capsule',
      tracks: [],
      groups: {},
    },
    ViewMgr: {
      getCurrentSpherical() {
        return { radius: 1, theta: 1, phi: 1, target: { x: 0, y: 0, z: 0 } };
      },
    },
    document: {
      getElementById() {
        return { checked: true };
      },
    },
    DOM: {
      sceneZoom: null,
    },
  };
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL because tempo lane state is not persisted yet

**Step 3: Write minimal implementation**

- Add `tempoMap`, `timeSignatureMap`, `midiTiming`, and `tempoLaneVisible` to project save output.
- Restore these values in `restoreState()`.
- Reset them in `clearAll()` to defaults.
- Rerender rulers, lane, clips, and playhead after restore.

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for persistence coverage

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "feat: persist tempo lane project state"
```

### Task 7: Final verification and manual checks

**Files:**
- Verify: `index.html`
- Verify: `tests/midi-tempo-metronome.test.js`
- Verify: `tests/export-background.test.js`

**Step 1: Run automated tests**

Run: `node --test tests/*.test.js`
Expected: PASS with all timeline, metronome, tempo, and export tests green

**Step 2: Run module parse verification**

Run:

```bash
node -e "const fs=require('fs');const html=fs.readFileSync('index.html','utf8');const match=html.match(/<script type=\"module\">([\s\S]*?)<\/script>/);if(!match) throw new Error('module script not found');const body=match[1].replace(/^\s*import .*;$/mg,'');new Function(body);console.log('module-script-parse-ok');"
```

Expected: `module-script-parse-ok`

**Step 3: Manual verification checklist**

1. Import a MIDI with tempo changes and confirm tempo points appear in the lane.
2. Undo import and confirm both tracks and tempo map are cleared.
3. Redo import and confirm both tracks and tempo map return.
4. Toggle the tempo lane visibility.
5. Add a tempo point by clicking the lane.
6. Drag a tempo point left/right and up/down.
7. Delete a non-initial tempo point.
8. Confirm clip spacing, bar ruler, time ruler, playhead, and metronome all follow the edited tempo map.
9. Save and reload the project and confirm tempo edits persist.

**Step 4: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "feat: finish tempo lane editing workflow"
```
