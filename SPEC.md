# Sushi

Canonical product and architecture specification.

Status: Draft 0.1

## Product

Sushi is an agent-native browser DAW for composing music with Strudel.

A human and an agent share one musical workspace. The human hears, edits, and arranges the music. The agent creates and transforms musical structures through WebMCP tools.

## Core stack

- Astro: application shell and static deployment
- React: interactive studio island
- Strudel: musical runtime, pattern language, scheduling, synthesis, and audio
- `@strudel/web`: Strudel integration for a custom interface
- WebMCP: agent-facing tool surface
- json-render: under evaluation as an optional dynamic UI layer
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
- Agent-generated panels
- Playback state

The studio uses one command dispatcher for human actions and agent actions.

### Strudel adapter

The adapter is the only application layer that talks directly to Strudel.

Responsibilities:

- Initialize Strudel and Web Audio
- Compile project patterns into a playable Strudel structure
- Start and stop playback
- Update patterns without duplicating musical semantics
- Expose runtime status to the studio
- Handle audio initialization and browser lifecycle

The first integration should use `@strudel/web` with a custom interface.

### WebMCP adapter

WebMCP registration lives in a client-side module.

Responsibilities:

- Register Sushi tools with `document.modelContext`
- Expose structured input schemas
- Dispatch tool calls through the shared command layer
- Return compact, useful results
- Register tools only when the browser exposes WebMCP
- Unregister tools through an `AbortController` when the studio unmounts

Tools operate on musical state and commands. They do not operate on DOM selectors or pixel coordinates.

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
  masterVolumeDb: number;
  transport: TransportState;
}

interface Track {
  id: string;
  name: string;
  type: "drums" | "synth" | "audio" | "other";
  pattern: string;
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

Strudel pattern source is the canonical musical content for each track. Track metadata and arrangement state belong to `ProjectState`.

The Strudel runtime is derived from project state. It is not a second persistent store.

### Commands

All state changes go through typed commands.

Initial command set:

```text
createProject
renameProject
addTrack
removeTrack
renameTrack
setTrackPattern
setTrackType
transposeTrack
setTrackEqualizer
setTrackCompressor
setTrackVolume
setTrackPan
setTrackMute
setTrackSolo
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

Tool names describe musical actions, not interface mechanics.

Initial tools:

```text
open_studio_session
get_project_state
compose_from_description
create_track
set_track_pattern
transpose_track
set_track_effects
set_track_parameter
set_transport
set_master_volume
play_project
stop_project
undo_change
redo_change
```

Every mutating tool returns:

- The action performed
- The affected entity IDs
- A short human-readable result
- The current relevant state

Pattern tools accept Strudel source directly at the runtime boundary, with validation before compilation.

The tool registry should grow from real interaction needs rather than expose the entire command dispatcher automatically.

## Musical model

Sushi presents a DAW-style visual model while preserving Strudel's pattern-based musical model.

Initial model:

- One project
- Multiple audio lanes
- Drum, synth, and audio-file track types
- One Strudel pattern per track
- Shared tempo and transport
- Per-track mixer controls
- Master volume from -20 dB to +5 dB, with -20 dB mapped to silence in the product UI
- Per-track equalizer and compressor controls
- Per-track transpose from -12 to +12 semitones per operation, with repeated operations supported
- Pattern editing and replacement
- Derived visual lanes

### Agent composition

The agent can turn a natural-language description of a sound or song into a playable project. It should create or modify Strudel patterns, select track types, set arrangement metadata, and return a result the user can immediately audition.

The app should support iterative refinement: the user can ask for a closer match, isolate a track, change its pitch or effects, and compare the result without losing the previous state.

Arrangement, scenes, pattern sections, automation, and multi-project workspaces can extend this model after the first playable slice.

## Persistence

Initial persistence is local-first.

- Save projects in browser storage
- Include a schema version
- Serialize project state as JSON
- Support export and import
- Keep Strudel pattern source intact

A server-backed project store can be added later without changing the WebMCP or Strudel boundaries.

## Runtime boundaries

### Audio

Strudel and Web Audio run only in the browser.

Audio initialization must account for browser user-gesture requirements. The UI provides an explicit playback entry point and reports runtime readiness to the agent-facing surface.

### WebMCP

Feature-detect `document.modelContext` before registration.

The app should remain usable as a normal studio when WebMCP is unavailable. WebMCP registration is an enhancement to the same command surface.

### Network

The initial playable loop does not require a server round trip. Cloudflare hosts the application shell and static assets.

## Repository structure

```text
src/
  components/
    Studio.tsx
    studio/
  lib/
    project/
      model.ts
      commands.ts
      history.ts
    strudel/
      adapter.ts
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
- Agent can open or restore a studio session
- User can play and stop a project
- Project contains drum, synth, and audio lanes
- User can edit a track pattern
- User can adjust per-track mixer and basic effects
- User can transpose a track
- User can adjust master volume
- Agent can inspect project state
- Agent can create a track
- Agent can change a pattern
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
- The app remains functional without WebMCP support.
- `bun run build` succeeds.

## Open decisions

- Exact Strudel package set beyond `@strudel/web`
- Pattern representation for multi-section arrangements
- Audio sample and sound-bank strategy
- Project serialization format and share links
- Tool approval behavior for large or destructive changes
- Whether collaboration requires a server during the challenge

## References

- [WebMCP](https://github.com/webmachinelearning/webmcp)
- [WebMCP Challenge](https://openai.com/webmcp-challenge/)
- [Strudel](https://codeberg.org/uzu/strudel)
- [Using Strudel in your Project](https://strudel.cc/technical-manual/project-start/)
