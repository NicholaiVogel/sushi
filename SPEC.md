# Sushi

Canonical product and architecture specification.

Status: Draft 0.1

## Product

Sushi is an agent-native browser DAW for composing music with Strudel.

A human and an agent share one musical workspace. Both can create, hear, edit, and arrange the music. The human uses the visual interface and audio feedback; the agent uses WebMCP to operate the same source and state.

## Core stack

- Astro: application shell and static deployment
- React: interactive studio island
- `shadcn/ui`: selective React component foundation
- Strudel: musical runtime, pattern language, scheduling, synthesis, and audio
- `@strudel/web`: Strudel integration for a custom interface
- WebMCP: agent-facing tool surface
- Cloudflare Pages: deployment target

## Product loop

1. User or agent opens a studio session.
2. User describes a sound, song, or theme, or asks for a musical change.
3. The agent calls a Sushi tool.
4. The tool submits a source edit through the shared source pipeline.
5. Sushi validates and commits the source, then evaluates it through Strudel.
6. The interface updates and the user auditions the result.
7. The user edits, accepts, or asks for another change.

## Interface direction

- Dark, monochrome undertones
- Distinctive and professional visual language
- Friendly, legible controls for beginners
- Core controls remain visible and usable
- Resizable panels and sections through mouse dragging
- Flexible layout with clear visual hierarchy

### UI component foundation

Sushi uses `shadcn/ui` selectively for accessible, interaction-focused React components:

- Buttons
- Sliders
- Toggles
- Selects
- Tooltips
- Tabs
- Scroll areas
- Resizable panels
- Dialogs and popovers
- Separators

The component styling follows Sushi's legible visual system and semantic design tokens. DAW-specific surfaces are custom components:

- Timeline
- Track lanes
- Piano roll
- Waveform views
- Meter displays
- Transport controls
- Source-to-control mapping

## Architecture

```text
Astro page
└── React Studio island
    ├── Studio state and command dispatcher
    ├── WebMCP tool registration
    └── Strudel adapter
        └── @strudel/web / Web Audio
```

### Astro shell

Astro owns routes, document structure, metadata, and deployment configuration.

The studio is mounted as a React island with `client:load` so the browser runtime and WebMCP tools initialize as soon as the page loads.

Browser-only systems stay inside the client boundary:

- `document.modelContext`
- Strudel
- Web Audio
- local persistence
- interactive studio state

### React studio

React owns the interactive DAW surface:

- Transport controls
- Track list
- Pattern lanes
- Arrangement view
- Inspector controls
- Source and pattern views
- Playback state

The studio uses one command dispatcher for human actions and agent actions. Both mutate the same client-side project state.

### Strudel adapter

The adapter is the only application layer that talks directly to Strudel.

Responsibilities:

- Initialize Strudel and Web Audio
- Evaluate the committed Strudel source into a playable Pattern
- Start and stop playback
- Update patterns through the source mapper
- Expose runtime status to the studio
- Handle audio initialization and browser lifecycle

The first integration should use `@strudel/web` with a custom interface.

### Strudel authoring and validation

Strudel's transpilation, evaluation, and runtime are the source of truth for whether a composition is valid.

Every source edit follows the same pipeline:

```text
draft source
→ parse and transpile
→ evaluate with a revision token
→ verify the resulting Pattern and assets
→ commit at the declared playback boundary
→ update the source index and audio runtime
```

The user editor and WebMCP source tools use this pipeline. A failed edit keeps the draft source and diagnostics in shared client state while playback continues from `lastValid`. The human sees the diagnostic in the editor and the agent receives the same structured diagnostic in the tool result and through subsequent state reads, so either actor can correct it.

Evaluation is cancellable and transactional. Each evaluation carries its source revision, and only the current revision can become active. Temporary runtime registrations are cleaned up when evaluation fails. Rapid control changes are coalesced before evaluation. Sushi uses a trusted browser-code execution model for authored Strudel source.

```ts
interface SourceDiagnostic {
  revision: number;
  phase: "parse" | "transpile" | "evaluate" | "asset" | "audio" | "commit";
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  range?: SourceRange;
  cause?: string;
}
```

The app includes a versioned, client-side Strudel reference containing common functions, sounds, templates, patterns, and working examples. WebMCP can expose focused reference lookups to the agent when it needs syntax or pattern guidance.

Browser validation uses Strudel's own transpilation and evaluation pipeline. An external Strudel LSP is optional developer tooling.

### WebMCP adapter

WebMCP registration lives in a client-side module.

Responsibilities:

- Register Sushi tools with `document.modelContext`
- Expose structured input schemas
- Dispatch tool calls through the shared command layer
- Read and mutate the shared Strudel source document
- Return compact, useful results
- Register tools only when the browser exposes WebMCP
- Unregister tools through an `AbortController` when the studio unmounts
- Expose source validation and focused Strudel reference lookups to the agent

Tools operate through musical state, commands, and source revisions.

## State ownership

Sushi separates persisted project data, derived source projections, runtime state, and UI state.

### Project document

The project document is the persisted, portable source of authorship:

```ts
type Rational = { numerator: number; denominator: number };

interface ProjectDocumentV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  source: {
    draft: string;
    lastValid: string;
    revision: number;
    strudelVersion: string;
  };
  timeline: {
    quarterNotesPerCycle: Rational;
    cyclesPerBar?: Rational;
    meter?: { numerator: number; denominator: number };
    songEndCycle?: Rational;
  };
  assets: AssetManifestEntry[];
}
```

Strudel source owns tempo, key, track gain, pan, transpose, mapped effects, and source mute. Project metadata owns meter, song boundaries, assets, and compatibility information.

### Derived source index

The source index is rebuilt from the current source revision and powers the UI:

```ts
interface DerivedSourceIndex {
  sourceRevision: number;
  tracks: TrackProjection[];
  globals: GlobalProjection;
  diagnostics: SourceDiagnostic[];
}

interface TrackProjection {
  id: string;
  label: string;
  name: string;
  type: "drum" | "synth" | "sample" | "unknown";
  range: SourceRange;
  mappingStatus: "mapped" | "partial" | "opaque";
  parameters: Record<string, ParameterProjection>;
}
```

### Runtime and UI state

```ts
interface RuntimeState {
  audioState: "locked" | "initializing" | "ready" | "error";
  transport: "stopped" | "playing" | "paused";
  currentCycle: Rational;
  activeRevision: number | null;
  masterVolumeDb: number;
  soloTrackIds: string[];
}

interface UiState {
  selectedTrackId?: string;
  arrangementZoom: number;
  arrangementScrollCycle: Rational;
}
```

Runtime state covers playback, audio readiness, master output, and solo. UI state covers selection and presentation.

### Source-defined tracks

A Strudel track is a labeled source block with an embedded Sushi marker. For example:

```js
// @sushi-track {"id":"trk_01JABC...","name":"Lead","type":"synth","schema":1}
$: n("<<0 0 -2 -2> 4 7>*16")
  .scale(key)
  .s("bytebeat")
  .gain(.5)
```

The UI derives its track list, block identity, source range, and visual lane from the source document. Track IDs use UUID or ULID values. Moving or renaming a block preserves its ID; copying a block creates a new ID; duplicate IDs produce a diagnostic. Marker fields and schema versions are preserved during source edits. Unannotated blocks remain playable and appear as unmanaged source blocks.

The source contains enough metadata to render the first DAW surface:

- Global declarations provide tempo, key, and reusable helpers.
- Labeled blocks provide track boundaries and source ranges.
- Comments can provide display names when present.
- Method chains provide recognized musical, mixer, and effect controls.
- `slider(value, min, max)` provides editable control metadata.
- `color()` provides track visual identity.
- Visualizer methods such as `_pianoroll()` and `_scope()` provide lane visualization hints.
- Underscore-prefixed labels such as `_$:` remain source-defined blocks but are muted by Strudel.

The parser produces a source index for the UI. The executable Strudel label remains separate from the display name and marker identity.

### Temporal arrangement

Live label changes control immediate performance state. Song and track in/out points use Strudel's pattern timing primitives:

- `arrange(...)` sequences sections with explicit cycle durations.
- `seqPLoop(...)` places patterns at explicit start and stop cycle positions, including overlaps.
- `mask(...)` and `when(...)` express recurring conditional activation.

Sushi stores canonical timeline positions as cycles and derives seconds for display. The cycle conversion uses quarter notes per cycle:

```text
cycles = seconds × BPM / (60 × quarterNotesPerCycle)
```

At 84 BPM with four quarter notes per cycle, 30 seconds is 10.5 cycles. The source mapper writes the timing expression into the track's source block. `songEndCycle` defines the finite project boundary, and transport stops when it is reached.

Transport semantics:

- Play starts from the current cycle.
- Pause freezes the current cycle.
- Resume continues from the paused cycle.
- Stop halts playback and returns to cycle zero.
- Seek changes the current cycle and schedules from the new location.
- Source changes made during playback commit at the next cycle boundary.

### Timeline editing

Dragging a track clip moves its timing range; dragging its in or out point resizes the range. Both are source edits and snap to quarter-cycle boundaries. The mapper converts the dragged seconds to cycles and updates the track's timing wrapper:

- Use `arrange(...)` for section-based timelines with explicit durations.
- Use `seqPLoop(...)` for independent track ranges with explicit start and stop positions, including overlaps.

The mapper preserves the track's pattern body while changing its timing range. Source edits are parsed back into seconds and rendered as the track's in/out points.

## Bidirectional source synchronization

The first vertical slice must prove both directions:

```text
UI action → source mapper → Strudel source → Strudel runtime
Strudel source edit → source parser → UI timeline and controls
```

The `StrudelMapper` is the single translation boundary between the UI model and Strudel source.

The mapper supports a defined canonical subset of source constructs first. It preserves source outside the subset and reports unmapped values.

### Global controls

The UI stores tempo as BPM and stores the number of quarter notes per Strudel cycle.

```js
setcpm(bpm / quarterNotesPerCycle)
```

For example, 150 BPM in a four-quarter-note cycle becomes `setcpm(150 / 4)`. The UI exposes BPM from 0 through 300; zero is retained in source as a stopped tempo and does not produce infinite UI durations.

Meter is project metadata displayed by the UI and reflected through the rhythmic grouping of patterns.

Musical key uses a canonical source declaration:

```js
const key = "E:minor";
```

The mapper must keep the UI value and recognized source declarations synchronized.

### Source mapper

The mapper supports a defined canonical subset of Strudel source constructs first:

```text
ManagedTrack := SushiMarker LabeledExpression
LabeledExpression := Label ':' BasePattern ChainedCall*
RecognizedValue := NumericLiteral | NegativeNumericLiteral | SliderExpression
```

Base patterns include common `n(...)`, `note(...)`, `s(...)`, and `sound(...)` expressions. Chained calls include recognized pitch, gain, pan, filter, envelope, room, sustain, decay, color, and visualization methods. Pattern-valued expressions receive an explicit mapping status instead of being reduced to scalar UI values.

```ts
type MappingStatus =
  | "mapped-literal"
  | "mapped-slider"
  | "readonly-expression"
  | "unsupported"
  | "invalid";
```

The mapper uses source ranges for edits. Parsing and projecting a source document is byte-stable. Editing one mapped property changes its intended source range while preserving comments, whitespace, formatting, and unrelated expressions.

### Sync rules

- Every update carries a source revision and origin.
- UI-originated updates serialize through the mapper before runtime evaluation.
- Source-originated updates parse through the mapper before UI state changes.
- Equivalent source updates collapse to one revision.
- Unsupported source remains visible and editable through the source editor.
- Invalid source produces a visible error while the last valid runtime continues playing.

### Commands

All state changes go through typed commands.

Initial command set:

```text
createProject
renameProject
writeSource
patchSource
setTrackParameter
setTrackRange
deleteTrack
renameTrack
setTempo
setKey
play
pause
resume
stop
seek
undo
redo
```

Every command should be:

- Serializable
- Validated at the boundary
- Undoable when it changes project state
- Usable by human controls and WebMCP tools
- Observable by the UI

Source mutations carry a base revision, transaction ID, and origin. A stale base revision returns a structured conflict and leaves the current draft and runtime unchanged.

### History

Use a bounded command history for undo and redo.

The first version stores project snapshots or reversible commands locally. The implementation can choose between them after the first state model exists.

## WebMCP tool contract

Tool names describe musical actions.

Initial tools:

```text
open_studio_session
inspect_strudel_state
read_strudel_source
write_strudel_source
patch_strudel_source
set_tempo
set_key
delete_track
rename_track
set_track_range
extend_timeline
validate_strudel_source
lookup_strudel_reference
control_playback
undo_source_edit
redo_source_edit
```

Every mutating tool returns:

- The action performed
- The affected entity IDs
- A short human-readable result
- The current relevant state
- The committed revision and source diff

Every mutating source tool accepts a base revision and transaction ID. Transaction IDs provide idempotent retries for the same edit.

All musical edits operate on Strudel source through the source pipeline, with validation before runtime activation.

Source tools operate on the source document itself:

- `read_strudel_source` returns the draft, last-valid source, revision, and diagnostics.
- `write_strudel_source` replaces the draft source and validates it atomically.
- `patch_strudel_source` applies exact, revision-checked text edits and validates the result.
- `set_tempo` writes a 0–300 BPM value as `setcpm(bpm / quarterNotesPerCycle)` and `set_key` updates the canonical `const key` declaration; both validate through Strudel and return the shared source revision.
- `extend_timeline` advances the project boundary by the next 30-bar page (capped at 137) without changing source text.
- `inspect_strudel_state` returns source, parsed source blocks, recognized controls, diagnostics, and runtime status.
- `validate_strudel_source` checks candidate source and returns diagnostics.
- `control_playback` starts, pauses, or stops the derived Strudel runtime.
- `undo_source_edit` and `redo_source_edit` operate on source revisions.

Invalid writes remain as drafts with structured diagnostics. The runtime and playable project remain on the last valid revision. A successful correction promotes the draft and clears the diagnostics.

Track creation, removal, patterns, transpose, effects, mixer values, tempo, key, and meter are all represented by source edits. Track tools accept a stable track ID, 1-based track number, or exact track name. The UI derives its state from the resulting source.

The tool registry should grow from real interaction needs rather than expose the entire command dispatcher automatically.

The timeline starts with a 30-bar capacity and new tracks default to a four-bar range. Dragging or lengthening a track beyond the current boundary adds the next 30-bar page (60, 90, 120, then 137); the user or agent can also advance the boundary with `extend_timeline`. Its zoom is view-only: the mountain/left end shows all available bars, the magnifier/right end shows one bar, and it opens at the midpoint.

## Musical model

Sushi presents a DAW-style visual model while preserving Strudel's pattern-based musical model.

Initial model:

- One project
- Multiple source-defined lanes
- Drum, synth, and sample-pattern track types
- One UI lane per source-defined Strudel block
- Shared tempo and transport
- Source-mapped gain, pan, transpose, and selected effects
- Runtime master output and solo controls
- Source-authored mute through Strudel label state
- Pattern editing and replacement
- Derived visual lanes

### Agent composition

The agent can turn a natural-language description of a sound or song into a playable project. It should create or modify Strudel patterns, select track types, set arrangement metadata, and return a result the user can immediately audition.

The app should support iterative refinement: the user can ask for a closer match, isolate a track, change its pitch or effects, and compare revisions.

Arrangement, scenes, pattern sections, automation, and multi-project workspaces can extend this model after the first playable slice.

## Persistence

Initial persistence is client-only.

- Save the project document and imported sample assets in IndexedDB
- Save lightweight preferences in browser storage
- Serialize the project document as versioned JSON
- Keep Strudel source and asset metadata intact
- Autosave source and last-valid state atomically
- Recompute the derived source index when a project opens
- Support local export and import

### Assets

V1 audio tracks are Strudel patterns that trigger project-local or registered samples. Linear waveform clips, trimming, recording, and fades belong to a later audio model.

```ts
interface AssetManifestEntry {
  id: string;
  alias: string;
  originalName: string;
  contentHash: string;
  mimeType: string;
  byteLength: number;
  storageKey: string;
  sourceUrl?: string;
  license?: string;
  attribution?: string;
}
```

Aliases are unique within a project. Missing, undecodable, or quota-failed assets produce structured diagnostics. Portable exports package the manifest, source, and local assets together.

### Compatibility and licensing

Sushi pins its Strudel package versions and records the compatibility version in every project. Opening a project under a different compatible version produces a visible compatibility state and uses an explicit migration when required.

Sushi includes Strudel attribution, dependency notices, and sample attribution in the application and exported projects. Its distribution license and source-availability model must satisfy Strudel's AGPL-3.0 requirements and receive legal review before deployment.

## Runtime boundaries

### Audio

Strudel and Web Audio run only in the browser.

Audio initialization must account for browser user-gesture requirements. The UI provides an explicit playback entry point and reports runtime readiness to the agent-facing surface.

### WebMCP

Feature-detect `document.modelContext` before registration.

The app should remain usable as a normal studio when WebMCP is unavailable. WebMCP registration is an enhancement to the same command surface.

### Network

The application has no server-side runtime. Cloudflare serves static application assets only. Strudel, Web Audio, project state, persistence, and WebMCP execution run in the browser.

Default Strudel templates, sounds, and patterns are loaded and used client-side.

## Repository structure

```text
src/
  components/
    ui/
    Studio.tsx
    studio/
  lib/
    project/
      model.ts
      commands.ts
      history.ts
      sync.ts
    strudel/
      adapter.ts
      mapper.ts
      reference/
        sounds.ts
        templates.ts
        examples.ts
    webmcp/
      tools.ts
  pages/
    index.astro
public/
SPEC.md
```

The exact component split can evolve. The boundaries between project state, Strudel, and WebMCP should remain explicit.

## First vertical slice

The work is staged as progressively complete vertical slices:

### Slice 0: runtime proof

- Astro loads the React studio island.
- The adapter initializes `@strudel/web`.
- Sushi evaluates source, plays a Pattern, and stops it.
- Draft source, last-valid source, diagnostics, and active revision are visible.
- An invalid draft leaves the last-valid Pattern playing.

### Slice 1: source-first project

- Multiple marked `$:` and `_$:` blocks render as source-derived lanes.
- Track IDs survive source edits and reordering.
- The mapper supports tempo, key, one scalar track control, and exact source ranges.
- UI changes update source; source changes update the UI.
- Projects save and reopen from IndexedDB.

### Slice 2: musical transport

- Timeline positions use cycles and display derived seconds.
- Dragging track in/out points writes `arrange(...)` or `seqPLoop(...)`.
- Source timing changes update the timeline.
- Play, pause, resume, stop, seek, and `songEndCycle` work as defined.

### Slice 3: agent surface

- WebMCP exposes source inspection, validation, reference lookup, playback, and revision-checked edits.
- Successful edits return a diff and new revision.
- Stale edits return a structured conflict.
- Human and agent changes share undo history.

## Acceptance criteria

- A project can be composed and played in the browser.
- Strudel is the only musical execution engine.
- Human and agent actions produce the same state transitions.
- WebMCP tools expose useful musical operations with schemas.
- The studio UI is derived deterministically from the source index.
- State changes are visible, inspectable, and undoable.
- A no-op source projection is byte-identical.
- A mapped control edit changes only its intended source range.
- Comments, formatting, and unsupported expressions survive unrelated edits.
- Duplicate track IDs produce diagnostics; track IDs survive reordering.
- An older asynchronous evaluation cannot replace a newer revision.
- Invalid source leaves the last-valid Pattern active.
- Transport stops at `songEndCycle`.
- Saved projects reopen with the same source and local assets.
- Stale agent edits fail with no mutation.
- The [Strudel Open Songs](https://github.com/dissonancefm/Strudel-Open-Songs) corpus exercises source loading, parsing, mapping, validation, and playback across complete songs.
- The app functions as a standalone browser studio and exposes WebMCP when available.
- `bun run build` succeeds.

## Open decisions

- Exact Strudel package set beyond `@strudel/web`
- Versioned reference-catalog generation and curation
- Expansion of the canonical mapper grammar
- Effect chain and orbit policy
- Portable project bundle format
- Tool approval behavior for large source changes

## References

- [WebMCP](https://github.com/webmachinelearning/webmcp)
- [WebMCP Challenge](https://openai.com/webmcp-challenge/)
- [Strudel](https://codeberg.org/uzu/strudel)
- [Strudel Open Songs](https://github.com/dissonancefm/Strudel-Open-Songs)
- [Using Strudel in your Project](https://strudel.cc/technical-manual/project-start/)
