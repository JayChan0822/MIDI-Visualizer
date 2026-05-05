# Vite Modularization Design

## Summary

Migrate the current single-file `index.html` application into a Vite-based vanilla JavaScript project with modular source files, while keeping the existing UI and behavior as stable as possible in the first phase. The migration should improve maintainability, testability, and deployment ergonomics without forcing a framework rewrite.

## Current Context

The app is currently implemented almost entirely inside [index.html](/Users/jaychan/Documents/GitHub/MIDI-Visualizer/index.html):

- the file is over 11,000 lines long
- CSS is in a large inline `<style>` block
- application logic lives in one large `<script type="module">`
- DOM structure, state, rendering, import/export, and UI event wiring are tightly coupled

Relevant current characteristics:

- `index.html:3220+` contains the main runtime for state, media import, Three.js rendering, timeline interactions, export, and modals.
- `index.html:3327+` defines a large mutable `STATE` object used across all features.
- `index.html:3385+` builds a `DOM` cache inline, but many other code paths still call `document.getElementById(...)` directly.
- `index.html:3467+` defines `HistoryMgr`, which is a strong candidate for extraction into a reusable core module.
- `index.html:4904+` and `index.html:5264+` define `Track` and `Clip`, which currently mix data, DOM, and 3D rendering responsibilities.

The repository already has lightweight tests in [tests/midi-tempo-metronome.test.js](/Users/jaychan/Documents/GitHub/MIDI-Visualizer/tests/midi-tempo-metronome.test.js) and [tests/export-background.test.js](/Users/jaychan/Documents/GitHub/MIDI-Visualizer/tests/export-background.test.js), but there is no build tool or modular source layout yet. [package.json](/Users/jaychan/Documents/GitHub/MIDI-Visualizer/package.json) currently only lists `@vercel/analytics`.

## Goals

- Move the app onto Vite with a standard local development and production build workflow.
- Split the single-file app into maintainable CSS and JavaScript modules.
- Preserve current UI and behavior as closely as possible in the first migration phase.
- Support both local development and static deployment targets.
- Create clear responsibility boundaries for state, timeline, media, visualizer, export, and UI modules.

## Non-Goals

- Rewriting the app in React, Vue, or another framework.
- Redesigning the UI during the first migration phase.
- Rebuilding existing working features just for architectural purity.
- Fully eliminating all historical coupling in one pass.
- Introducing a large component abstraction layer before module boundaries are stable.

## Approved Decisions

- Architecture target: `Vite + vanilla HTML/CSS/ES modules`
- Scope: engineering migration plus codebase layering, with no intentional UI redesign
- Deployment support: local development and static hosting must both work
- Delivery strategy: phased migration, not a single all-at-once rewrite

## Approach Options

### Option 1: Shell Preservation + Feature Modularization

Keep the app as one page, preserve most existing DOM structure in `index.html`, and move logic into feature-oriented modules under `src/`.

Pros:

- lowest regression risk
- aligns with phased migration
- preserves current UI while still improving maintainability

Cons:

- some old structural compromises will remain in the short term
- first-phase architecture will still contain a few bridge layers

### Option 2: UI Structure Modularization During Migration

In addition to splitting CSS and logic, convert major page sections and modals into reusable template functions or small component-like render units.

Pros:

- cleaner long-term structure
- easier future UI iteration

Cons:

- much higher regression risk in a feature-rich app
- more difficult to isolate behavior changes from architecture changes

### Option 3: Minimal Vite Wrapping First

Move inline CSS and JS into files and get Vite working, but keep most logic in a still-large script during the first pass.

Pros:

- fastest path to a build tool
- lowest immediate change volume

Cons:

- only partially solves the maintainability problem
- risks turning `index.html` problems into `main.js` problems

## Recommended Approach

Use **Option 1: Shell Preservation + Feature Modularization**.

This approach gives the project a proper source layout and development workflow while keeping the migration risk low. It addresses the real problem, which is responsibility coupling, not merely the lack of a bundler.

## Target Directory Structure

```text
MIDI-Visualizer/
├─ index.html
├─ public/
│  ├─ favicon.ico
│  └─ static/
├─ src/
│  ├─ main.js
│  ├─ styles/
│  │  ├─ base.css
│  │  ├─ layout.css
│  │  ├─ components.css
│  │  └─ panels.css
│  ├─ app/
│  │  ├─ bootstrap.js
│  │  ├─ dom.js
│  │  ├─ state.js
│  │  └─ events.js
│  ├─ core/
│  │  ├─ history.js
│  │  ├─ resources.js
│  │  ├─ timing.js
│  │  ├─ selection.js
│  │  └─ project.js
│  ├─ features/
│  │  ├─ timeline/
│  │  │  ├─ tracks.js
│  │  │  ├─ clips.js
│  │  │  ├─ ruler.js
│  │  │  ├─ scrub.js
│  │  │  └─ tempo-lane.js
│  │  ├─ visualizer/
│  │  │  ├─ scene.js
│  │  │  ├─ notes.js
│  │  │  ├─ background.js
│  │  │  ├─ effects.js
│  │  │  ├─ camera-view.js
│  │  │  └─ shaders/
│  │  │     ├─ note.vert
│  │  │     └─ note.frag
│  │  ├─ media/
│  │  │  ├─ midi.js
│  │  │  ├─ audio.js
│  │  │  └─ recording.js
│  │  ├─ export/
│  │  │  ├─ video-export.js
│  │  │  └─ export-modal.js
│  │  └─ ui/
│  │     ├─ color-picker.js
│  │     ├─ background-settings.js
│  │     ├─ version-modal.js
│  │     └─ toolbar.js
│  └─ utils/
│     ├─ format.js
│     ├─ ids.js
│     └─ math.js
├─ tests/
└─ vite.config.js
```

## Architecture

### 1. Keep `index.html` as a Thin Shell

The first phase should retain the current page structure as much as possible. `index.html` becomes a thin document shell that:

- keeps the existing root DOM markup
- loads the Vite entry file
- removes the large inline CSS and JavaScript blocks

This is the lowest-risk way to keep selectors and layout behavior stable during the first migration wave.

### 2. Separate Startup Concerns

The app should boot through:

1. `src/main.js`
2. `src/app/bootstrap.js`
3. feature initializers

The bootstrap layer should control startup order and prevent feature modules from doing uncontrolled top-level work.

### 3. Treat Core Services as Stable Foundations

The following pieces are mature enough to extract early:

- `state`
- `dom`
- `history`
- `resources`
- `project`

These modules provide stable surfaces that the rest of the migration can build on.

### 4. Organize by Responsibility Domain

Split by domain rather than by arbitrary function groups:

- `timeline/` for track, clip, ruler, and lane behavior
- `visualizer/` for Three.js scene and note rendering
- `media/` for MIDI, audio, and recording workflows
- `export/` for recording and export flows
- `ui/` for modal and toolbar behaviors

This matches the way the application is actually used and debugged.

### 5. Move Shaders out of HTML

Shader code should live under `src/features/visualizer/shaders/` and be imported by Vite. Keeping shader source inside HTML increases noise and makes visualizer changes harder to review.

## Startup Sequence

The desired initialization order is:

1. create state
2. cache DOM references
3. initialize core services
4. initialize visualizer systems
5. initialize timeline systems
6. initialize media systems
7. initialize UI systems
8. bind global events
9. trigger the initial render/update pass

This ordering ensures that shared dependencies exist before interactive features begin wiring listeners or rendering.

## Dependency Rules

- `app/` orchestrates modules but should not contain feature logic
- `core/` should not depend on specific UI modules
- `features/ui/` may call public feature APIs, but should avoid mutating deep internals directly
- `Track` and `Clip` should receive dependencies through imports or injected services instead of depending on scattered globals
- `visualizer/` should expose stable public functions instead of allowing unrelated modules to manipulate scene internals directly

## Migration Phases

### Phase 1: Establish the Vite Shell

- add Vite configuration and scripts
- keep the current DOM structure largely intact
- move the main runtime into `src/main.js`
- confirm local dev and production build both work

### Phase 2: Split CSS

- move the inline `<style>` block into `src/styles/`
- keep selectors stable during the split
- group rules by layout, shared components, and specialized panels

### Phase 3: Extract Stable Core Modules

- extract `state.js`
- extract `dom.js`
- extract `history.js`
- extract `resources.js`
- extract `project.js`

These modules should change structure before higher-risk feature code moves.

### Phase 4: Extract High-Value Feature Modules

Recommended order:

1. `Track` and `Clip`
2. tempo lane and ruler logic
3. visualizer scene/background/view modules
4. MIDI/audio/export modules

This order attacks the heaviest maintenance pain first while keeping regressions understandable.

### Phase 5: Remove Legacy Glue

- remove duplicate DOM queries
- reduce direct global cross-calls
- move shader strings out of HTML
- trim compatibility shims created only for transition safety

## Risks

### Risk: Shared State Breakage Across DOM, Timeline, and 3D

The current app relies on shared mutable state such as `currentTime`, `tempoMap`, clip selection, and note appearance settings. If modules are separated without preserving update flow, it is easy to get mismatches between UI state and rendered state.

### Risk: `Track` and `Clip` Are Currently Fat Objects

They currently span data, DOM, and 3D responsibilities. Attempting to fully purify them during the first migration would likely create regressions. The safer path is to move them into dedicated modules first, then progressively narrow responsibilities later.

### Risk: Global Events Are Easy to Duplicate

The current file binds many window-, wheel-, drag-, keyboard-, and modal-related handlers. Migration must avoid rebinding listeners multiple times or changing setup order accidentally.

### Risk: Resource Lifecycles Are Easy to Leak

Background textures, video textures, blob URLs, export resources, and Web Audio state need to keep their cleanup behavior. Resource lifecycle regressions may not show up immediately but can make the app unstable over repeated use.

## Testing Strategy

### Build and Startup Verification

- `npm run dev` starts the app under Vite
- `npm run build` produces deployable static assets
- the built output works under a static file server

### Manual Smoke Coverage

- import MIDI
- import audio
- play, stop, and scrub
- add, move, and select clips
- toggle and edit the tempo lane
- import and switch backgrounds
- open export controls
- save and reload a project

### Automated Test Priorities

Prefer pure-logic coverage first:

- timing helpers
- tempo-map logic
- project serialization and restoration
- undo/redo state transitions
- resource registration and cleanup

This gives the migration a safety net without requiring a large UI automation effort up front.

## Acceptance Criteria

The first migration phase is successful when:

- the app runs under Vite in local development
- a production build succeeds
- the built output can be served as static assets
- the main user workflows still behave correctly
- the project no longer depends on a giant all-in-one HTML file for its runtime logic
- at least one meaningful layer of core and feature modules has been extracted

## Next Step

After this design is accepted, the next artifact should be an implementation plan that turns the migration into small, testable, low-risk steps.
