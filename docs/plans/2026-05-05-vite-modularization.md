# Vite Modularization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the single-file MIDI visualizer into a Vite-based vanilla JavaScript app with modular CSS and feature-oriented source files while preserving current behavior.

**Architecture:** Keep `index.html` as a thin shell, move runtime code into `src/`, and extract stable core modules before splitting heavier feature domains. Use Vite for development, bundling, and static deployment compatibility, but avoid a framework rewrite or deliberate UI redesign in this phase.

**Tech Stack:** Vite, vanilla JavaScript ES modules, HTML, CSS, Three.js, `@tonejs/midi`, Web Audio API, Node built-in test runner, npm

---

### Task 1: Add Vite scaffolding and scripts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vite.config.js`

**Step 1: Write the failing setup expectation**

Document the expected commands before making changes:

```text
npm run dev
npm run build
```

Expected right now:

- `npm run dev` fails because there is no Vite script
- `npm run build` fails because there is no Vite script

**Step 2: Run commands to verify they fail**

Run: `npm run dev`
Expected: FAIL with missing script

Run: `npm run build`
Expected: FAIL with missing script

**Step 3: Write minimal implementation**

Update `package.json` to include:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "node --test tests/*.test.js"
  },
  "devDependencies": {
    "vite": "^7.0.0"
  }
}
```

Create `vite.config.js` with:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
  },
});
```

**Step 4: Run commands to verify they pass**

Run: `npm install`
Expected: PASS and `vite` added to lockfile

Run: `npm run build`
Expected: PASS or fail later on HTML/runtime migration, but Vite should now be installed and recognized

**Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.js
git commit -m "build: add vite scaffolding"
```

### Task 2: Create the `src/` entrypoint and thin shell HTML

**Files:**
- Modify: `index.html`
- Create: `src/main.js`
- Create: `src/app/bootstrap.js`

**Step 1: Write the failing startup expectation**

Document the expected app boot shape:

```js
import './styles/base.css';
import { bootstrapApp } from './app/bootstrap.js';

bootstrapApp();
```

Expected right now:

- there is no `src/main.js`
- `index.html` still contains inline runtime logic instead of a Vite entry

**Step 2: Run build to verify startup is not wired yet**

Run: `npm run build`
Expected: FAIL because `src/main.js` does not exist or `index.html` still depends on inline runtime assumptions

**Step 3: Write minimal implementation**

Create `src/main.js`:

```js
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/panels.css';
import { bootstrapApp } from './app/bootstrap.js';

bootstrapApp();
```

Create `src/app/bootstrap.js`:

```js
export function bootstrapApp() {
  console.log('bootstrap placeholder');
}
```

Update `index.html` so it:

- keeps the existing DOM markup
- removes the main inline `<script type="module">`
- loads `/src/main.js`

**Step 4: Run build to verify it passes**

Run: `npm run build`
Expected: PASS at a minimal shell level

**Step 5: Commit**

```bash
git add index.html src/main.js src/app/bootstrap.js
git commit -m "refactor: move app entry to vite bootstrap"
```

### Task 3: Split the inline CSS into source stylesheets

**Files:**
- Modify: `index.html`
- Create: `src/styles/base.css`
- Create: `src/styles/layout.css`
- Create: `src/styles/components.css`
- Create: `src/styles/panels.css`

**Step 1: Write the failing visual expectation**

Document the CSS split target:

- theme variables live in `base.css`
- app layout rules live in `layout.css`
- reusable buttons, menus, and modal rules live in `components.css`
- tempo lane, overlays, and settings panel rules live in `panels.css`

Expected right now:

- all styles still live inside one inline `<style>` block

**Step 2: Run build and inspect the app before the split**

Run: `npm run build`
Expected: PASS, but CSS is still embedded in HTML

**Step 3: Write minimal implementation**

Move CSS in this order:

1. `:root`, `body`, scrollbar rules to `src/styles/base.css`
2. major section layout rules to `src/styles/layout.css`
3. buttons, menus, modal shells to `src/styles/components.css`
4. tempo lane, overlays, and settings panels to `src/styles/panels.css`

Keep selectors unchanged during the split. Do not rename classes or IDs in this task.

**Step 4: Run build and visual smoke checks**

Run: `npm run build`
Expected: PASS

Run: `npm run dev`
Expected: PASS and the page should look materially identical to before

**Step 5: Commit**

```bash
git add index.html src/styles/base.css src/styles/layout.css src/styles/components.css src/styles/panels.css
git commit -m "refactor: split inline styles into source css files"
```

### Task 4: Extract app state and DOM caching modules

**Files:**
- Create: `src/app/state.js`
- Create: `src/app/dom.js`
- Modify: `src/app/bootstrap.js`
- Modify: `index.html`
- Test: `tests/midi-tempo-metronome.test.js`

**Step 1: Write the failing test**

Add a small pure test for a factory-based state initializer:

```js
test('createInitialState returns independent state objects', async () => {
  const { createInitialState } = await import('../src/app/state.js');
  const a = createInitialState();
  const b = createInitialState();

  a.bpm = 90;
  assert.equal(b.bpm, 120);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL because `src/app/state.js` does not exist yet

**Step 3: Write minimal implementation**

Create `src/app/state.js`:

```js
export function createInitialState() {
  return {
    isPlaying: false,
    currentTime: 0,
    totalDuration: 60,
    pxPerBeat: 50,
    tracks: [],
    clips: [],
    bpm: 120,
    tempoMap: [{ time: 0, bpm: 120, beatStart: 0, secondsPerBeat: 0.5 }],
  };
}
```

Create `src/app/dom.js`:

```js
export function createDomRefs() {
  return {
    headers: document.getElementById('track-headers'),
    lanes: document.getElementById('lanes-container'),
    playBtn: document.getElementById('playBtn'),
    stopBtn: document.getElementById('stopBtn'),
  };
}
```

Update `bootstrapApp()` to create:

```js
const state = createInitialState();
const dom = createDomRefs();
```

**Step 4: Run tests and build**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for the new state factory test

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/state.js src/app/dom.js src/app/bootstrap.js tests/midi-tempo-metronome.test.js
git commit -m "refactor: extract app state and dom modules"
```

### Task 5: Extract stable core services

**Files:**
- Create: `src/core/history.js`
- Create: `src/core/resources.js`
- Create: `src/core/project.js`
- Modify: `src/app/bootstrap.js`
- Test: `tests/export-background.test.js`

**Step 1: Write the failing test**

Add a pure test for resource URL cleanup behavior:

```js
test('createResourceManager revokes only blob urls', async () => {
  let revoked = [];
  const { createResourceManager } = await import('../src/core/resources.js');
  const mgr = createResourceManager({
    revokeObjectURL(url) {
      revoked.push(url);
    },
  });

  mgr.revoke('blob:123');
  mgr.revoke('https://example.com/file.png');

  assert.deepEqual(revoked, ['blob:123']);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/export-background.test.js`
Expected: FAIL because the extracted module does not exist yet

**Step 3: Write minimal implementation**

Create `src/core/resources.js`:

```js
export function createResourceManager(urlApi = URL) {
  return {
    revoke(url) {
      if (url && url.startsWith('blob:')) {
        urlApi.revokeObjectURL(url);
      }
    },
  };
}
```

Create `src/core/history.js` with a factory such as:

```js
export function createHistoryManager() {
  return {
    undoStack: [],
    redoStack: [],
  };
}
```

Create `src/core/project.js` with placeholder exported functions for save/load orchestration. Wire them through `bootstrapApp()` without changing behavior yet.

**Step 4: Run tests and build**

Run: `node --test tests/export-background.test.js`
Expected: PASS for the extracted resource manager test

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/history.js src/core/resources.js src/core/project.js src/app/bootstrap.js tests/export-background.test.js
git commit -m "refactor: extract core service modules"
```

### Task 6: Extract visualizer shader assets and scene bootstrap

**Files:**
- Create: `src/features/visualizer/scene.js`
- Create: `src/features/visualizer/shaders/note.vert`
- Create: `src/features/visualizer/shaders/note.frag`
- Modify: `index.html`
- Modify: `src/app/bootstrap.js`

**Step 1: Write the failing startup expectation**

Document the desired scene entry API:

```js
export function initVisualizer({ state, dom }) {
  return {
    render() {},
  };
}
```

Expected right now:

- shader sources still live in HTML
- visualizer setup is not importable as a module

**Step 2: Run build before extraction**

Run: `npm run build`
Expected: PASS, but scene code still depends on HTML-embedded shader strings

**Step 3: Write minimal implementation**

Create `src/features/visualizer/scene.js` with:

```js
import vertexShader from './shaders/note.vert?raw';
import fragmentShader from './shaders/note.frag?raw';

export function initVisualizer() {
  return {
    vertexShader,
    fragmentShader,
    render() {},
  };
}
```

Move the main note shader source from `index.html` into `note.vert` and `note.frag`. Update bootstrap to initialize the visualizer module before timeline and media modules.

**Step 4: Run build and smoke-check the page**

Run: `npm run build`
Expected: PASS

Run: `npm run dev`
Expected: PASS with the visualizer still rendering correctly

**Step 5: Commit**

```bash
git add src/features/visualizer/scene.js src/features/visualizer/shaders/note.vert src/features/visualizer/shaders/note.frag src/app/bootstrap.js index.html
git commit -m "refactor: extract visualizer scene bootstrap"
```

### Task 7: Extract timeline domain modules

**Files:**
- Create: `src/features/timeline/tracks.js`
- Create: `src/features/timeline/clips.js`
- Create: `src/features/timeline/ruler.js`
- Create: `src/features/timeline/tempo-lane.js`
- Modify: `src/app/bootstrap.js`
- Test: `tests/midi-tempo-metronome.test.js`

**Step 1: Write the failing test**

Add a pure helper test for a timeline module function:

```js
test('createTempoLaneModel returns sorted editable points', async () => {
  const { createTempoLaneModel } = await import('../src/features/timeline/tempo-lane.js');
  const points = createTempoLaneModel([
    { time: 4, bpm: 90 },
    { time: 0, bpm: 120 },
  ]);

  assert.deepEqual(points.map((point) => point.time), [0, 4]);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: FAIL because the new timeline modules do not exist yet

**Step 3: Write minimal implementation**

Create `src/features/timeline/tempo-lane.js`:

```js
export function createTempoLaneModel(points) {
  return [...points].sort((a, b) => a.time - b.time);
}
```

Create module placeholders for tracks, clips, and ruler that expose `initTracks`, `initClips`, and `initRuler`. Move the first safe helper and rendering logic into these modules without changing selectors or event behavior.

**Step 4: Run tests and build**

Run: `node --test tests/midi-tempo-metronome.test.js`
Expected: PASS for the new timeline helper test

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/timeline/tracks.js src/features/timeline/clips.js src/features/timeline/ruler.js src/features/timeline/tempo-lane.js src/app/bootstrap.js tests/midi-tempo-metronome.test.js
git commit -m "refactor: extract timeline feature modules"
```

### Task 8: Extract media and export modules

**Files:**
- Create: `src/features/media/midi.js`
- Create: `src/features/media/audio.js`
- Create: `src/features/media/recording.js`
- Create: `src/features/export/video-export.js`
- Create: `src/features/export/export-modal.js`
- Modify: `src/app/bootstrap.js`
- Test: `tests/export-background.test.js`

**Step 1: Write the failing test**

Add a small pure serialization test for export settings:

```js
test('normalizeExportSettings applies default fps and format', async () => {
  const { normalizeExportSettings } = await import('../src/features/export/export-modal.js');
  const result = normalizeExportSettings({ resolution: '1080p' });

  assert.equal(result.fps, 60);
  assert.equal(result.format, 'webm');
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/export-background.test.js`
Expected: FAIL because the new export module does not exist yet

**Step 3: Write minimal implementation**

Create `src/features/export/export-modal.js`:

```js
export function normalizeExportSettings(settings) {
  return {
    fps: settings.fps ?? 60,
    format: settings.format ?? 'webm',
    resolution: settings.resolution ?? '1080p',
  };
}
```

Create placeholder initializers for MIDI, audio, recording, and video export, then move the first safe helper and event wiring into them through `bootstrapApp()`.

**Step 4: Run tests and build**

Run: `node --test tests/export-background.test.js`
Expected: PASS for the new export helper test

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/media/midi.js src/features/media/audio.js src/features/media/recording.js src/features/export/video-export.js src/features/export/export-modal.js src/app/bootstrap.js tests/export-background.test.js
git commit -m "refactor: extract media and export modules"
```

### Task 9: Add final regression checks and remove migration glue

**Files:**
- Modify: `src/app/bootstrap.js`
- Modify: `src/app/dom.js`
- Modify: `src/core/project.js`
- Modify: `src/features/...` as needed
- Test: `tests/midi-tempo-metronome.test.js`
- Test: `tests/export-background.test.js`

**Step 1: Write the failing cleanup checklist**

Document the end-state expectations:

- no main runtime logic remains embedded in `index.html`
- shader code is no longer embedded in HTML
- duplicate top-level DOM queries are reduced
- the app still supports import, playback, editing, background handling, export opening, and project save/load

Expected right now:

- some bridge code or temporary compatibility paths may still exist

**Step 2: Run full verification before cleanup**

Run: `node --test tests/*.test.js`
Expected: PASS or identify remaining migration gaps

Run: `npm run build`
Expected: PASS

**Step 3: Write minimal implementation**

- remove temporary bootstrap placeholders that are no longer needed
- consolidate duplicated DOM query paths into `src/app/dom.js`
- ensure `project.js` and feature modules use stable public APIs rather than reaching into unrelated internals
- delete any migration-only inline remnants left in `index.html`

**Step 4: Run final verification**

Run: `node --test tests/*.test.js`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `npm run dev`
Expected: PASS with manual smoke coverage for:

- MIDI import
- audio import
- playback and stop
- clip interaction
- tempo lane visibility and editing
- background import and theme switching
- export modal open
- project save and load

**Step 5: Commit**

```bash
git add index.html src package.json package-lock.json vite.config.js tests
git commit -m "refactor: finish vite modularization phase one"
```

## Notes for Execution

- Keep DOM IDs and classes stable until the migration is complete.
- Prefer extracting stable helpers before moving event-heavy interaction code.
- Do not mix UI redesign into this branch.
- If a task exposes hidden coupling, add a tiny compatibility wrapper instead of rewriting the feature on the spot.
