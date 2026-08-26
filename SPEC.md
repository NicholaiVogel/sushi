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
4. The tool updates the canonical composition state.
5. Sushi compiles the state into Strudel runtime patterns.
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
- Compile project patterns into a playable Strudel structure
- Start and stop playback
- Update patterns through the source mapper
- Expose runtime status to the studio
- Handle audio initialization and browser lifecycle

The first integration should use `@strudel/web` with a custom interface.

### Strudel authoring and validation

Strudel's transpilation, evaluation, and runtime are the source of truth for whether a composition is valid.

Every source edit follows the same pipeline:

```text
candidate Strudel source
→ transpile and evaluate
→ return diagnostics
→ commit only valid source
→ update the UI and audio runtime
```

The user editor and WebMCP source tools use this pipeline. A failed edit keeps the draft source and diagnostics in shared client state while playback continues from `lastValid`. The human sees the diagnostic in the editor and the agent receives the same structured diagnostic in the tool result and through subsequent state reads, so either actor can correct it.

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

### Canonical project state

The application owns a serializable `ProjectState`.

```ts
interface ProjectState {
  version: 1;
  id: string;
  name: string;
  tempo: number;
  swing: number;
  tracks: Track[];
  strudelSource: SourceState;
  masterVolumeDb: number;
  transport: TransportState;
}

interface SourceState {
  draft: string;
  lastValid: string;
  revision: number;
  diagnostics: SourceDiagnostic[];
}

interface SourceDiagnostic {
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

interface Track {
  id: string;
  name: string;
  sourceLabel: string;
  type: "drums" | "synth" | "audio" | "other";
  transposeSemitones: number;
  effects: TrackEffects;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
}

interface TrackEffects {
  equalizer: {
    low: number;
    mid: number;
    high: number;
  };
  compressor: {
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
  };
}

interface TransportState {
  playing: boolean;
  position: number;
}
```

The Strudel source document is the canonical musical content. UI lanes are derived from labeled Strudel source blocks. `ProjectState` contains session metadata and arrangement state.

The UI projection and Strudel runtime are derived from the source document.

### Source-defined tracks

A Strudel track is a labeled source block. For example:

```js
$: n("<<0 0 -2 -2> 4 7>*16")
  .scale(key)
  .s("bytebeat")
  .gain(.5)
```

The UI derives its track list, block identity, source range, and visual lane from the source document. Adding, removing, or editing a track means adding, removing, or editing a valid source block.

The source contains enough metadata to render the first DAW surface:

- Global declarations provide tempo, key, and reusable helpers.
- Labeled blocks provide track boundaries and source ranges.
- Comments can provide display names when present.
- Method chains provide recognized musical, mixer, and effect controls.
- `slider(value, min, max)` provides editable control metadata.
- `color()` provides track visual identity.
- Visualizer methods such as `_pianoroll()` and `_scope()` provide lane visualization hints.
- Underscore-prefixed labels such as `_$:` remain source-defined blocks but are muted by Strudel.

The parser produces a source index for the UI.

### Temporal arrangement

Live label changes control immediate performance state. Song and track in/out points use Strudel's pattern timing primitives:

- `arrange(...)` sequences sections with explicit cycle durations.
- `seqPLoop(...)` places patterns at explicit start and stop cycle positions, including overlaps.
- `mask(...)` and `when(...)` express recurring conditional activation.

Sushi stores timeline positions in seconds in the UI and converts them to Strudel cycles:

```text
cycles = seconds × BPM / (60 × beatsPerCycle)
```

At 84 BPM with four beats per cycle, 30 seconds is 10.5 cycles. The source mapper writes the resulting timing expression into the track's source block. The arrangement boundary provides the song duration, and the transport stops at that boundary.

### Timeline editing

Dragging a track's in or out point is a source edit. The mapper converts the dragged seconds to cycles and updates the track's timing wrapper:

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

The UI stores tempo as BPM and stores the number of perceived beats per Strudel cycle.

```js
setcpm(bpm / beatsPerCycle)
```

For example, 84 BPM in a four-beat cycle becomes `setcpm(84 / 4)`.

Meter is represented by the UI model and by the rhythmic grouping of patterns. The mapper preserves this distinction because Strudel expresses meter through pattern structure.

Musical key uses a canonical source declaration:

```js
const key = "E:minor";
```

The mapper must keep the UI value and recognized source declarations synchronized.

### Sync rules

- Every update carries a source revision and origin.
- UI-originated updates serialize through the mapper before runtime evaluation.
- Source-originated updates parse through the mapper before UI state changes.
- Equivalent source updates collapse to one revision.
- Unsupported source remains visible and editable.
- Invalid source produces a visible error while the last valid runtime continues playing.

### Commands

All state changes go through typed commands.

Initial command set:

```text
createProject
renameProject
addSourceBlock
removeSourceBlock
editSourceBlock
setSourceBlockParameter
setTempo
setSwing
setMasterVolume
play
stop
undo
redo
```

Every command should be:

- Serializable
- Validated at the boundary
- Undoable when it changes project state
- Usable by human controls and WebMCP tools
- Observable by the UI

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

All musical edits operate on Strudel source directly at the runtime boundary, with validation before compilation.

Source tools operate on the source document itself:

- `read_strudel_source` returns the draft, last-valid source, revision, and diagnostics.
- `write_strudel_source` replaces the draft source and validates it atomically.
- `patch_strudel_source` applies exact, revision-checked text edits and validates the result.
- `inspect_strudel_state` returns source, parsed source blocks, recognized controls, diagnostics, and runtime status.
- `validate_strudel_source` checks candidate source and returns diagnostics.
- `control_playback` starts, pauses, or stops the derived Strudel runtime.
- `undo_source_edit` and `redo_source_edit` operate on source revisions.

Invalid writes remain as drafts with structured diagnostics. The runtime and playable project remain on the last valid revision. A successful correction promotes the draft and clears the diagnostics.

Track creation, removal, patterns, transpose, effects, mixer values, tempo, key, and meter are all represented by source edits. The UI derives its state from the resulting source.

The tool registry should grow from real interaction needs rather than expose the entire command dispatcher automatically.

## Musical model

Sushi presents a DAW-style visual model while preserving Strudel's pattern-based musical model.

Initial model:

- One project
- Multiple source-defined audio lanes
- Drum, synth, and audio-file track types
- One UI lane per source-defined Strudel block
- Shared tempo and transport
- Per-track mixer controls
- Master volume from -20 dB to +5 dB, with -20 dB mapped to silence in the product UI
- Per-track equalizer and compressor controls
- Per-track transpose from -12 to +12 semitones per operation, with repeated operations supported
- Pattern editing and replacement
- Derived visual lanes

### Agent composition

The agent can turn a natural-language description of a sound or song into a playable project. It should create or modify Strudel patterns, select track types, set arrangement metadata, and return a result the user can immediately audition.

The app should support iterative refinement: the user can ask for a closer match, isolate a track, change its pitch or effects, and compare revisions.

Arrangement, scenes, pattern sections, automation, and multi-project workspaces can extend this model after the first playable slice.

## Persistence

Initial persistence is client-only.

- Save projects and imported audio assets in IndexedDB
- Save lightweight preferences in browser storage
- Include a schema version
- Serialize project state as JSON
- Support export and import
- Keep Strudel pattern source intact

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

The first playable slice proves the architecture with a small but complete loop:

- Studio page loads in Astro
- React island mounts
- Strudel initializes through the adapter
- Default Strudel templates, sounds, and patterns are available
- Agent can open or restore a studio session
- User can play, pause, and stop a project
- Project contains drum, synth, and audio lanes
- User can edit a track's Strudel source
- User can read, replace, patch, and semantically edit the Strudel source
- Invalid Strudel source remains visible as a draft, returns actionable diagnostics to the editing actor, and preserves the last valid playback
- UI BPM changes update the underlying Strudel source
- Strudel source changes update the UI BPM state
- UI and source remain synchronized for the canonical subset
- User can adjust the BPM
- User can drag track in/out points and see `arrange(...)` or `seqPLoop(...)` update the source
- Source timing changes update the UI timeline
- Playback stops at the derived song duration
- User can adjust per-track mixer and basic effects
- User can transpose a track
- User can adjust master volume
- Agent can inspect project state
- Agent can inspect source-defined tracks
- Agent can add, remove, or change a source block through source tools
- Agent can compose from a natural-language description
- UI reflects agent changes
- Undo restores the previous project state
- Project can be saved and loaded locally

## Acceptance criteria

- A project can be composed and played in the browser.
- Strudel is the only musical execution engine.
- Human and agent actions produce the same state transitions.
- WebMCP tools expose useful musical operations with schemas.
- The studio UI is derived deterministically from project state.
- State changes are visible, inspectable, and undoable.
- The app functions as a standalone browser studio and exposes WebMCP when available.
- `bun run build` succeeds.

## Open decisions

- Exact Strudel package set beyond `@strudel/web`
- Pattern representation for multi-section arrangements
- Audio sample and sound-bank strategy
- Project serialization format and share links
- Tool approval behavior for large or destructive changes
- Share and export behavior for client-only projects

## References

- [WebMCP](https://github.com/webmachinelearning/webmcp)
- [WebMCP Challenge](https://openai.com/webmcp-challenge/)
- [Strudel](https://codeberg.org/uzu/strudel)
- [Using Strudel in your Project](https://strudel.cc/technical-manual/project-start/)
