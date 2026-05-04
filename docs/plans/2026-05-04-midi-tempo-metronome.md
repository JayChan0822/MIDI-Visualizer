# MIDI Tempo-Synced Metronome Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a toolbar-controlled metronome that follows imported MIDI tempo changes during playback and recording without rewriting the existing second-based transport.

**Architecture:** Keep `STATE.currentTime` as the source of truth for playback, add pure tempo/time-signature helper functions that map seconds to beats, then layer a lightweight Web Audio metronome scheduler on top. Reuse the existing single-file `index.html` structure and the repository's current `node:test` pattern for pure-function coverage.

**Tech Stack:** Vanilla JavaScript, single-file HTML app, Web Audio API, `@tonejs/midi`, Node built-in test runner (`node:test`)

---

### Task 1: Add failing tests for tempo-map helpers

**Files:**
- Create: `tests/midi-tempo-metronome.test.js`
- Modify: `index.html:8353-8466`
- Reference: `tests/export-background.test.js`

**Step 1: Write the failing test**

```js
test('buildTempoMap accumulates beat offsets across tempo changes', () => {
  const { buildTempoMap, getBeatPositionAtTime } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
  ]);

  const tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 10, bpm: 60 },
  ], 100, 0);

  assert.equal(tempoMap.length, 2);
  assert.equal(tempoMap[1].beatStart, 20);
  assert.equal(getBeatPositionAtTime(12, tempoMap), 22);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL with missing helper functions extracted from `index.html`

**Step 3: Write minimal implementation**

```js
function buildTempoMap(tempos, fallbackBpm, trimOffset = 0) {
  const normalized = [];
  // normalize tempos, ensure time 0 entry, cache beatStart/secondsPerBeat
  return normalized;
}

function getTempoSegmentAtTime(time, tempoMap = STATE.tempoMap) {}
function getBeatPositionAtTime(time, tempoMap = STATE.tempoMap) {}
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for the new helper coverage

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "test: cover midi tempo map helpers"
```

### Task 2: Implement tempo and bar lookup helpers

**Files:**
- Modify: `index.html:3010-3040`
- Modify: `index.html:8353-8466`
- Modify: `index.html:8973-9066`
- Test: `tests/midi-tempo-metronome.test.js`

**Step 1: Write the failing test**

```js
test('getNextBeatAfter and getBarBeatAtTime stay correct across a tempo change', () => {
  const { buildTempoMap, buildTimeSignatureMap, getNextBeatAfter, getBarBeatAtTime } = loadFunctions([
    'buildTempoMap',
    'buildTimeSignatureMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getTimeAtBeat',
    'getNextBeatAfter',
    'getBarBeatAtTime',
  ]);

  const tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 4, bpm: 60 },
  ], 120, 0);
  const signatureMap = buildTimeSignatureMap([{ time: 0, timeSignature: [4, 4] }], 4, 0);

  assert.equal(getNextBeatAfter(3.6, tempoMap), 4);
  assert.deepEqual(normalize(getBarBeatAtTime(4, tempoMap, signatureMap)), {
    bar: 3,
    beatInBar: 1,
    beatIndex: 8,
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL on missing `buildTimeSignatureMap`, `getTimeAtBeat`, or incorrect beat math

**Step 3: Write minimal implementation**

```js
STATE.tempoMap = buildTempoMap([], STATE.bpm, 0);
STATE.timeSignatureMap = buildTimeSignatureMap([], STATE.timeSignature, 0);

function getTimeAtBeat(beat, tempoMap = STATE.tempoMap) {}
function getNextBeatAfter(time, tempoMap = STATE.tempoMap) {}
function getBarBeatAtTime(time, tempoMap = STATE.tempoMap, timeSignatureMap = STATE.timeSignatureMap) {}
```

Also update MIDI import to:

- trim header events with the same silence offset used for notes
- assign `STATE.tempoMap`
- assign `STATE.timeSignatureMap`
- keep `STATE.bpm` and `STATE.timeSignature` in sync with the first active entries

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for beat lookup and bar-accent detection

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "feat: add midi tempo timing helpers"
```

### Task 3: Add metronome scheduling tests and pure event planning

**Files:**
- Modify: `index.html:8868-8952`
- Modify: `index.html:9111-9158`
- Test: `tests/midi-tempo-metronome.test.js`

**Step 1: Write the failing test**

```js
test('collectMetronomeEvents returns accent-aware beats across the lookahead window', () => {
  const {
    buildTempoMap,
    buildTimeSignatureMap,
    getTempoSegmentAtTime,
    getBeatPositionAtTime,
    getTimeAtBeat,
    getNextBeatAfter,
    getBarBeatAtTime,
    collectMetronomeEvents,
  } = loadFunctions([
    'buildTempoMap',
    'buildTimeSignatureMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getTimeAtBeat',
    'getNextBeatAfter',
    'getBarBeatAtTime',
    'collectMetronomeEvents',
  ]);

  const tempoMap = buildTempoMap([{ time: 0, bpm: 120 }], 120, 0);
  const signatureMap = buildTimeSignatureMap([{ time: 0, timeSignature: [4, 4] }], 4, 0);

  assert.deepEqual(normalize(collectMetronomeEvents(0.1, 1.1, tempoMap, signatureMap)), [
    { time: 0.5, beatIndex: 1, beatInBar: 2, isAccent: false },
    { time: 1.0, beatIndex: 2, beatInBar: 3, isAccent: false },
  ]);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL because the metronome event planner does not exist yet

**Step 3: Write minimal implementation**

```js
function collectMetronomeEvents(startTime, endTime, tempoMap = STATE.tempoMap, timeSignatureMap = STATE.timeSignatureMap) {
  const events = [];
  // walk beat boundaries using getNextBeatAfter + getBarBeatAtTime
  return events;
}
```

Then add transport helpers:

```js
function resetMetronomeSchedule(time = STATE.currentTime) {}
function scheduleMetronomeWindow() {}
function scheduleClickSound(audioWhen, isAccent) {}
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for pure event planning; browser testing still needed for actual audio

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "feat: add tempo-synced metronome scheduler"
```

### Task 4: Wire the metronome into transport and toolbar controls

**Files:**
- Modify: `index.html:2209-2234`
- Modify: `index.html:3010-3055`
- Modify: `index.html:7268-7305`
- Modify: `index.html:8868-8952`
- Modify: `index.html:9111-9158`

**Step 1: Write the failing test**

Write a regression-style helper test for transport reset behavior:

```js
test('resetMetronomeSchedule resets cursor state after seek', () => {
  const { resetMetronomeSchedule } = loadFunctions(['resetMetronomeSchedule'], {
    STATE: {
      currentTime: 9,
      metronome: {
        cursorTime: 12,
        scheduledUntilAudioTime: 99,
        lastScheduledBeatKey: 'old',
      }
    }
  });

  resetMetronomeSchedule(3);
  assert.equal(STATE.metronome.cursorTime, 3);
  assert.equal(STATE.metronome.scheduledUntilAudioTime, 0);
  assert.equal(STATE.metronome.lastScheduledBeatKey, null);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL until state-reset logic is implemented compatibly with the extracted test context

**Step 3: Write minimal implementation**

```js
<button class="btn" id="metronomeToggleBtn">MET</button>
<select id="metronomeSoundSelect">
  <option value="woodblock">Woodblock</option>
  <option value="click">Click</option>
</select>
```

```js
DOM.metronomeToggleBtn = document.getElementById('metronomeToggleBtn');
DOM.metronomeSoundSelect = document.getElementById('metronomeSoundSelect');

DOM.metronomeToggleBtn.addEventListener('click', toggleMetronomeEnabled);
DOM.metronomeSoundSelect.addEventListener('change', onMetronomeSoundChange);
```

Wire these into:

- `togglePlay()`
- `stopPlay()`
- `seekTo()`
- `animate()`

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for reset behavior, plus browser UI should show the new controls

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "feat: add metronome transport controls"
```

### Task 5: Verify end-to-end behavior and clean up fixed-BPM assumptions

**Files:**
- Modify: `index.html:8840-8866`
- Modify: `index.html:8973-9066`
- Verify: `tests/midi-tempo-metronome.test.js`

**Step 1: Write the failing test**

If `updateTotalDuration()` or ruler behavior gains pure helper seams, add a test for the fallback buffer or first-segment compatibility. If not, document manual verification only and keep this task focused on integration cleanup.

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: Either one targeted FAIL for a new pure helper or no new automated coverage if this remains integration-only

**Step 3: Write minimal implementation**

Adjust any remaining fixed-BPM logic that directly affects the metronome feature, especially:

- fallback buffer math in `updateTotalDuration()`
- fixed-bar calculations that could mislabel accent lookup assumptions

Keep the current bar ruler visually unchanged unless a small compatibility fix is required.

**Step 4: Run test to verify it passes**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS

Manual browser verification checklist:

1. Import a fixed-tempo MIDI and confirm clicks stay steady.
2. Import a multi-tempo MIDI and confirm clicks follow the tempo change.
3. Seek while playing and confirm there are no duplicate clicks from stale scheduling.
4. Pause and resume mid-song and confirm beat placement stays aligned.
5. Toggle metronome off and confirm silence.
6. Switch `woodblock` / `click` and confirm the new sound takes effect.

**Step 5: Commit**

```bash
git add tests/midi-tempo-metronome.test.js index.html
git commit -m "feat: finish midi tempo metronome integration"
```
