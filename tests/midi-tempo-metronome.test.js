const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunctionSource(source, functionName) {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);

  if (start === -1) {
    throw new Error(`Function ${functionName} not found in index.html`);
  }

  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) {
    throw new Error(`Function ${functionName} has no body`);
  }

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  throw new Error(`Function ${functionName} body is not balanced`);
}

function loadFunctions(functionNames, contextExtras = {}) {
  const context = {
    module: { exports: null },
    exports: {},
    STATE: {
      tempoMap: [],
      timeSignatureMap: [],
      currentTime: 0,
      metronome: {},
    },
    ...contextExtras,
  };

  vm.createContext(context);
  const sources = functionNames.map((functionName) => extractFunctionSource(html, functionName));
  vm.runInContext(`${sources.join('\n')}; module.exports = { ${functionNames.join(', ')} };`, context);
  return context.module.exports;
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

test('buildTempoMap accumulates beat offsets across tempo changes', () => {
  const { buildTempoMap, getTempoSegmentAtTime, getBeatPositionAtTime } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
  ]);

  const tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 10, bpm: 60 },
  ], 100, 0);

  assert.equal(tempoMap.length, 2);
  assert.equal(tempoMap[0].secondsPerBeat, 0.5);
  assert.equal(tempoMap[1].beatStart, 20);
  assert.equal(getTempoSegmentAtTime(12, tempoMap).bpm, 60);
  assert.equal(getBeatPositionAtTime(12, tempoMap), 22);
});

test('buildTempoMap trims header event times with the same offset as notes', () => {
  const { buildTempoMap, getBeatPositionAtTime } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
  ]);

  const tempoMap = buildTempoMap([
    { time: 2, bpm: 120 },
    { time: 6, bpm: 60 },
  ], 90, 2);

  assert.equal(tempoMap[0].time, 0);
  assert.equal(tempoMap[1].time, 4);
  assert.equal(getBeatPositionAtTime(5, tempoMap), 9);
});

test('getNextBeatAfter and getBarBeatAtTime stay correct across a tempo change', () => {
  const { buildTempoMap, buildTimeSignatureMap, getTimeAtBeat, getNextBeatAfter, getBarBeatAtTime } = loadFunctions([
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
  const signatureMap = buildTimeSignatureMap([
    { time: 0, timeSignature: [4, 4] },
  ], 4, 0);

  assert.equal(getNextBeatAfter(3.6, tempoMap), 4);
  assert.equal(getNextBeatAfter(4.2, tempoMap), 5);
  assert.equal(getTimeAtBeat(8, tempoMap), 4);
  assert.deepEqual(normalize(getBarBeatAtTime(4, tempoMap, signatureMap)), {
    bar: 3,
    beatInBar: 1,
    beatIndex: 8,
  });
});

test('collectMetronomeEvents marks accents by bar position inside a lookahead window', () => {
  const {
    buildTempoMap,
    buildTimeSignatureMap,
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

  assert.deepEqual(normalize(collectMetronomeEvents(1.1, 2.1, tempoMap, signatureMap)), [
    { time: 1.5, beatIndex: 3, beatInBar: 4, isAccent: false },
    { time: 2, beatIndex: 4, beatInBar: 1, isAccent: true },
  ]);
});

test('resetMetronomeSchedule clears pending scheduler state after seek', () => {
  const context = {
    STATE: {
      currentTime: 9,
      metronome: {
        cursorTime: 12,
        scheduledUntilAudioTime: 99,
        lastScheduledBeatKey: 'old',
      },
    },
  };
  const { resetMetronomeSchedule } = loadFunctions(['resetMetronomeSchedule'], context);

  resetMetronomeSchedule(3);

  assert.equal(context.STATE.metronome.cursorTime, 3);
  assert.equal(context.STATE.metronome.scheduledUntilAudioTime, 0);
  assert.equal(context.STATE.metronome.lastScheduledBeatKey, null);
});

test('scheduleMetronomeWindow schedules future beats inside the audio lookahead window', () => {
  const calls = [];
  const context = {
    STATE: {
      currentTime: 0.1,
      isPlaying: true,
      tempoMap: [],
      timeSignatureMap: [],
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        enabled: true,
        sound: 'woodblock',
        volume: 0.7,
        lookaheadSec: 0.6,
        cursorTime: 0.1,
        scheduledUntilAudioTime: 0,
        lastScheduledBeatKey: null,
      },
    },
    sharedAudioCtx: {
      currentTime: 10,
      state: 'running',
    },
    scheduleClickSound(audioWhen, isAccent, soundName, volume) {
      calls.push({ audioWhen, isAccent, soundName, volume });
    },
  };

  const {
    buildTempoMap,
    buildTimeSignatureMap,
    scheduleMetronomeWindow,
  } = loadFunctions([
    'buildTempoMap',
    'getEffectiveTempoMap',
    'buildTimeSignatureMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getTimeAtBeat',
    'getNextBeatAfter',
    'getBarBeatAtTime',
    'collectMetronomeEvents',
    'scheduleMetronomeWindow',
  ], context);

  context.STATE.tempoMap = buildTempoMap([{ time: 0, bpm: 120 }], 120, 0);
  context.STATE.timeSignatureMap = buildTimeSignatureMap([{ time: 0, timeSignature: [4, 4] }], 4, 0);

  scheduleMetronomeWindow();

  assert.deepEqual(normalize(calls), [
    { audioWhen: 10.4, isAccent: false, soundName: 'woodblock', volume: 0.7 },
  ]);
  assert.equal(context.STATE.metronome.lastScheduledBeatKey, '1@0.500000');
});

test('collectBeatGridMarks produces tempo-aware bar starts across a tempo change', () => {
  const {
    buildTempoMap,
    buildTimeSignatureMap,
    collectBeatGridMarks,
  } = loadFunctions([
    'buildTempoMap',
    'buildTimeSignatureMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getTimeAtBeat',
    'getNextBeatAfter',
    'getBarBeatAtTime',
    'collectBeatGridMarks',
  ]);

  const tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 4, bpm: 60 },
  ], 120, 0);
  const signatureMap = buildTimeSignatureMap([{ time: 0, timeSignature: [4, 4] }], 4, 0);

  const marks = normalize(collectBeatGridMarks(6, tempoMap, signatureMap));
  const barStarts = marks.filter((mark) => mark.isBarStart).map((mark) => mark.time);
  const beatMarks = marks.filter((mark) => !mark.isBarStart).map((mark) => mark.time);

  assert.deepEqual(barStarts, [0, 2, 4]);
  assert.deepEqual(beatMarks.slice(0, 5), [0.5, 1, 1.5, 2.5, 3]);
  assert.equal(beatMarks.at(-1), 6);
});

test('getTimelineXAtTime keeps equal bar spacing across tempo changes', () => {
  const context = {
    STATE: {
      pxPerBeat: 48,
      tempoMap: [],
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        fallbackBpm: 120,
      },
    },
  };
  const {
    buildTempoMap,
    getTimelineXAtTime,
  } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getEffectiveTempoMap',
    'getTimelinePixelsPerBeat',
    'getTimelineBeatAtTime',
    'getTimelineXAtTime',
  ], context);

  context.STATE.tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 4, bpm: 60 },
  ], 120, 0);

  const barOne = getTimelineXAtTime(0);
  const barTwo = getTimelineXAtTime(2);
  const barThree = getTimelineXAtTime(4);

  assert.equal(barTwo - barOne, 192);
  assert.equal(barThree - barTwo, 192);
});

test('getTimelineTimeAtOffsetX converts beat-domain offsets back to real time', () => {
  const context = {
    STATE: {
      pxPerBeat: 48,
      tempoMap: [],
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        fallbackBpm: 120,
      },
    },
  };
  const {
    buildTempoMap,
    getTimelineTimeAtOffsetX,
  } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getTimeAtBeat',
    'getEffectiveTempoMap',
    'getTimelinePixelsPerBeat',
    'getTimelineTimeAtBeat',
    'getTimelineTimeAtOffsetX',
  ], context);

  context.STATE.tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 4, bpm: 60 },
  ], 120, 0);

  assert.equal(getTimelineTimeAtOffsetX(432), 5);
});

test('getSceneXAtTime follows the same beat-domain spacing as the timeline', () => {
  const context = {
    STATE: {
      pxPerBeat: 48,
      playbackSpeed: 20,
      tempoMap: [],
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        fallbackBpm: 120,
      },
    },
  };
  const {
    buildTempoMap,
    getSceneXAtTime,
  } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getEffectiveTempoMap',
    'getTimelineBeatAtTime',
    'getSceneXAtTime',
  ], context);

  context.STATE.tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 4, bpm: 60 },
  ], 120, 0);

  assert.equal(getSceneXAtTime(2), 80);
  assert.equal(getSceneXAtTime(4), 160);
});

test('getSceneWidthBetweenTimes stretches scene width across tempo changes', () => {
  const context = {
    STATE: {
      pxPerBeat: 48,
      playbackSpeed: 20,
      tempoMap: [],
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        fallbackBpm: 120,
      },
    },
  };
  const {
    buildTempoMap,
    getSceneWidthBetweenTimes,
  } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getTimeAtBeat',
    'getEffectiveTempoMap',
    'getTimelineBeatAtTime',
    'getSceneXAtTime',
    'getSceneWidthBetweenTimes',
  ], context);

  context.STATE.tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 4, bpm: 60 },
  ], 120, 0);

  assert.equal(getSceneWidthBetweenTimes(0, 2), 80);
  assert.equal(getSceneWidthBetweenTimes(4, 6), 40);
});

test('getClipRelativeTimeAtPixel warps audio thumbnail sampling in beat-domain view', () => {
  const context = {
    STATE: {
      pxPerBeat: 48,
      tempoMap: [],
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        fallbackBpm: 120,
      },
    },
  };
  const {
    buildTempoMap,
    getClipRelativeTimeAtPixel,
  } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getTimeAtBeat',
    'getEffectiveTempoMap',
    'getTimelinePixelsPerBeat',
    'getTimelineBeatAtTime',
    'getTimelineXAtTime',
    'getTimelineTimeAtBeat',
    'getTimelineTimeAtOffsetX',
    'getClipRelativeTimeAtPixel',
  ], context);

  context.STATE.tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 4, bpm: 60 },
  ], 120, 0);

  assert.equal(getClipRelativeTimeAtPixel(240, 0, 6, 480), 2.5);
  assert.equal(getClipRelativeTimeAtPixel(400, 0, 6, 480), 4.333333);
});

test('collectTimeRulerMarks keeps real-time labels while mapping positions through beat spacing', () => {
  const context = {
    STATE: {
      pxPerBeat: 48,
      tempoMap: [],
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        fallbackBpm: 120,
      },
    },
  };
  const {
    buildTempoMap,
    collectTimeRulerMarks,
  } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getTimeAtBeat',
    'getEffectiveTempoMap',
    'getTimelinePixelsPerBeat',
    'getTimelineBeatAtTime',
    'getTimelineXAtTime',
    'formatRulerTime',
    'collectTimeRulerMarks',
  ], context);

  context.STATE.tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 4, bpm: 60 },
  ], 120, 0);

  const marks = normalize(collectTimeRulerMarks(6, 48, context.STATE.tempoMap, 0));

  assert.deepEqual(marks.slice(0, 4).map((mark) => mark.label), ['0:00', '0:01', '0:02', '0:03']);
  assert.equal(marks[5].time, 5);
  assert.equal(marks[5].x, 432);
});

test('cloneTempoState creates deep tempo snapshots for history', () => {
  const context = {
    STATE: {
      tempoMap: [
        { time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 },
      ],
      timeSignatureMap: [
        { time: 0, numerator: 4, denominator: 4 },
      ],
      midiTiming: {
        source: 'imported.mid',
        trimOffset: 0,
        hasTempoEvents: true,
      },
      bpm: 120,
    },
  };
  const { cloneTempoState } = loadFunctions(['cloneTempoState'], context);

  const snapshot = cloneTempoState();
  context.STATE.tempoMap[0].bpm = 90;
  context.STATE.timeSignatureMap[0].numerator = 3;
  context.STATE.midiTiming.source = 'edited.mid';

  assert.equal(snapshot.tempoMap[0].bpm, 120);
  assert.equal(snapshot.timeSignatureMap[0].numerator, 4);
  assert.equal(snapshot.midiTiming.source, 'imported.mid');
  assert.equal(snapshot.bpm, 120);
});

test('applyImportedTempoState restores import undo and redo snapshots', () => {
  const context = {
    STATE: {
      tempoMap: [
        { time: 0, bpm: 90, beatStart: 0, secondsPerBeat: 0.6666666667 },
      ],
      timeSignatureMap: [
        { time: 0, numerator: 4, denominator: 4 },
      ],
      midiTiming: {
        source: 'old.mid',
        trimOffset: 0,
        hasTempoEvents: true,
      },
      bpm: 90,
    },
  };
  const { applyImportedTempoState } = loadFunctions([
    'restoreTempoState',
    'applyImportedTempoState',
  ], context);

  const oldTempoState = {
    tempoMap: [{ time: 0, bpm: 90, beatStart: 0, secondsPerBeat: 0.6666666667 }],
    timeSignatureMap: [{ time: 0, numerator: 4, denominator: 4 }],
    midiTiming: { source: 'old.mid', trimOffset: 0, hasTempoEvents: true },
    bpm: 90,
  };
  const newTempoState = {
    tempoMap: [{ time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 }],
    timeSignatureMap: [{ time: 0, numerator: 4, denominator: 4 }],
    midiTiming: { source: 'new.mid', trimOffset: 0.25, hasTempoEvents: true },
    bpm: 120,
  };

  applyImportedTempoState({ oldTempoState, newTempoState }, false);
  assert.equal(context.STATE.tempoMap[0].bpm, 120);
  assert.equal(context.STATE.midiTiming.source, 'new.mid');

  applyImportedTempoState({ oldTempoState, newTempoState }, true);
  assert.equal(context.STATE.tempoMap[0].bpm, 90);
  assert.equal(context.STATE.midiTiming.source, 'old.mid');
});

test('insertTempoPointAtTime keeps discrete tempo points sorted', () => {
  const { insertTempoPointAtTime } = loadFunctions([
    'normalizeEditableTempoMap',
    'insertTempoPointAtTime',
  ]);

  const points = normalize(insertTempoPointAtTime(3, 140, [
    { time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 },
    { time: 4, bpm: 90, beatStart: 8, secondsPerBeat: 0.6666666667 },
  ]));

  assert.deepEqual(points.map((point) => [point.time, point.bpm]), [
    [0, 120],
    [3, 140],
    [4, 90],
  ]);
});

test('moveTempoPoint updates point time and bpm while preserving the first point at zero', () => {
  const { moveTempoPoint } = loadFunctions([
    'normalizeEditableTempoMap',
    'moveTempoPoint',
  ]);

  const points = normalize(moveTempoPoint(1, 5, 150, [
    { time: 0, bpm: 120 },
    { time: 4, bpm: 90 },
  ]));

  assert.deepEqual(points.map((point) => [point.time, point.bpm]), [
    [0, 120],
    [5, 150],
  ]);
});

test('removeTempoPoint keeps the first tempo point intact', () => {
  const { removeTempoPoint } = loadFunctions([
    'normalizeEditableTempoMap',
    'removeTempoPoint',
  ]);

  const points = normalize(removeTempoPoint(0, [
    { time: 0, bpm: 120 },
    { time: 4, bpm: 90 },
  ]));

  assert.deepEqual(points.map((point) => [point.time, point.bpm]), [
    [0, 120],
    [4, 90],
  ]);
});

test('collectTempoLaneRenderPoints maps tempo points into beat-domain x and bpm y coordinates', () => {
  const context = {
    STATE: {
      pxPerBeat: 48,
      tempoMap: [],
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        fallbackBpm: 120,
      },
    },
  };
  const {
    buildTempoMap,
    collectTempoLaneRenderPoints,
  } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getEffectiveTempoMap',
    'getTimelinePixelsPerBeat',
    'getTimelineBeatAtTime',
    'getTimelineXAtTime',
    'normalizeEditableTempoMap',
    'getTempoPointScreenY',
    'collectTempoLaneRenderPoints',
  ], context);

  context.STATE.tempoMap = buildTempoMap([
    { time: 0, bpm: 120 },
    { time: 4, bpm: 90 },
  ], 120, 0);

  const points = normalize(collectTempoLaneRenderPoints(56, { min: 60, max: 180 }));

  assert.equal(points.length, 2);
  assert.equal(points[1].x, 384);
  assert.equal(points[0].label, '120 BPM');
  assert.equal(points[1].label, '90 BPM');
});

test('annotateMidiTrackBeatAnchors stores beat-based positions for imported MIDI notes', () => {
  const context = {
    STATE: {
      tempoMap: [],
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        fallbackBpm: 120,
      },
    },
  };
  const {
    buildTempoMap,
    annotateMidiTrackBeatAnchors,
  } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'annotateMidiTrackBeatAnchors',
  ], context);

  const sourceTempoMap = buildTempoMap([{ time: 0, bpm: 120 }], 120, 0);
  const track = {
    notes: [
      { time: 2, duration: 0.5, midi: 60 },
    ],
  };

  annotateMidiTrackBeatAnchors(track, sourceTempoMap);

  assert.deepEqual(normalize(track.notes[0]), {
    time: 2,
    duration: 0.5,
    midi: 60,
    sourceBeat: 4,
    sourceBeatDuration: 1,
  });
});

test('retimeMidiTrackFromBeatAnchors stretches imported MIDI notes when a new tempo map arrives', () => {
  const context = {
    STATE: {
      tempoMap: [],
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        fallbackBpm: 120,
      },
    },
  };
  const {
    buildTempoMap,
    retimeMidiTrackFromBeatAnchors,
  } = loadFunctions([
    'buildTempoMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getTimeAtBeat',
    'annotateMidiTrackBeatAnchors',
    'retimeMidiTrackFromBeatAnchors',
  ], context);

  const sourceTempoMap = buildTempoMap([{ time: 0, bpm: 120 }], 120, 0);
  const targetTempoMap = buildTempoMap([{ time: 0, bpm: 60 }], 60, 0);
  const track = {
    notes: [
      { time: 2, duration: 0.5, midi: 60, sourceBeat: 4, sourceBeatDuration: 1 },
      { time: 3, duration: 0.25, midi: 64, sourceBeat: 6, sourceBeatDuration: 0.5 },
    ],
  };

  retimeMidiTrackFromBeatAnchors(track, targetTempoMap);

  assert.deepEqual(normalize(track.notes), [
    { time: 4, duration: 1, midi: 60, sourceBeat: 4, sourceBeatDuration: 1 },
    { time: 6, duration: 0.5, midi: 64, sourceBeat: 6, sourceBeatDuration: 0.5 },
  ]);
});

test('refreshTimelineForTempoState rebuilds audio and MIDI visuals after tempo changes', () => {
  const calls = [];
  const midiClip = {
    track: { type: 'midi' },
    data: {
      notes: [
        { time: 1, duration: 0.5 },
      ],
    },
    duration: 1.5,
    updateDOMPosition() { calls.push('midi-dom'); },
    build3D() { calls.push('midi-build'); },
    update3DPosition() { calls.push('midi-3d'); },
  };
  const audioClip = {
    track: { type: 'audio' },
    data: {},
    duration: 2,
    updateDOMPosition() { calls.push('audio-dom'); },
    build3D() { calls.push('audio-build'); },
    update3DPosition() { calls.push('audio-3d'); },
  };

  const context = {
    STATE: {
      clips: [midiClip, audioClip],
      tempoLaneVisible: true,
    },
    getEffectiveTempoMap() {
      return [{ time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 }];
    },
    retimeMidiTrackFromBeatAnchors(data) {
      calls.push(`retime:${data.notes.length}`);
    },
    updateTotalDuration() {
      calls.push('update-duration');
    },
    updatePlayhead() {
      calls.push('update-playhead');
    },
    setTempoLaneVisible(flag) {
      calls.push(`tempo-visible:${flag}`);
    },
  };

  const { refreshTimelineForTempoState } = loadFunctions([
    'refreshTimelineForTempoState',
  ], context);

  refreshTimelineForTempoState();

  assert.deepEqual(calls, [
    'retime:1',
    'update-duration',
    'midi-dom',
    'midi-build',
    'midi-3d',
    'audio-dom',
    'audio-build',
    'audio-3d',
    'update-playhead',
    'tempo-visible:true',
  ]);
});

test('getEffectiveTempoMap falls back to metronome BPM when no MIDI tempo map exists', () => {
  const context = {
    STATE: {
      tempoMap: [],
      bpm: 120,
      midiTiming: {
        hasTempoEvents: false,
      },
      metronome: {
        fallbackBpm: 96,
      },
    },
  };
  const { getEffectiveTempoMap } = loadFunctions([
    'buildTempoMap',
    'getEffectiveTempoMap',
  ], context);

  const tempoMap = normalize(getEffectiveTempoMap());

  assert.deepEqual(tempoMap, [
    { time: 0, bpm: 96, beatStart: 0, secondsPerBeat: 0.625 },
  ]);
});

test('getEffectiveTempoMap keeps imported tempo map when MIDI tempo events exist', () => {
  const context = {
    STATE: {
      tempoMap: [
        { time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 },
        { time: 4, bpm: 90, beatStart: 8, secondsPerBeat: 0.6666666666666666 },
      ],
      bpm: 120,
      midiTiming: {
        hasTempoEvents: true,
      },
      metronome: {
        fallbackBpm: 72,
      },
    },
  };
  const { getEffectiveTempoMap } = loadFunctions([
    'buildTempoMap',
    'getEffectiveTempoMap',
  ], context);

  assert.deepEqual(normalize(getEffectiveTempoMap()), normalize(context.STATE.tempoMap));
});

test('scheduleMetronomeWindow uses click as the default sound', () => {
  const calls = [];
  const context = {
    STATE: {
      currentTime: 0.1,
      isPlaying: true,
      tempoMap: [],
      timeSignatureMap: [],
      midiTiming: {
        hasTempoEvents: false,
      },
      metronome: {
        enabled: true,
        sound: 'click',
        volume: 0.7,
        fallbackBpm: 120,
        lookaheadSec: 0.6,
        cursorTime: 0.1,
        scheduledUntilAudioTime: 0,
        lastScheduledBeatKey: null,
      },
    },
    sharedAudioCtx: {
      currentTime: 10,
      state: 'running',
    },
    scheduleClickSound(audioWhen, isAccent, soundName, volume) {
      calls.push({ audioWhen, isAccent, soundName, volume });
    },
  };

  const {
    buildTimeSignatureMap,
    scheduleMetronomeWindow,
  } = loadFunctions([
    'buildTempoMap',
    'getEffectiveTempoMap',
    'buildTimeSignatureMap',
    'getTempoSegmentAtTime',
    'getBeatPositionAtTime',
    'getTimeAtBeat',
    'getNextBeatAfter',
    'getBarBeatAtTime',
    'collectMetronomeEvents',
    'scheduleMetronomeWindow',
  ], context);

  context.STATE.timeSignatureMap = buildTimeSignatureMap([{ time: 0, timeSignature: [4, 4] }], 4, 0);

  scheduleMetronomeWindow();

  assert.deepEqual(normalize(calls), [
    { audioWhen: 10.4, isAccent: false, soundName: 'click', volume: 0.7 },
  ]);
});
