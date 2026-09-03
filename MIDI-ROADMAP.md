# Sushi MIDI + WebMCP roadmap

## Direction

### Implementation status

The core implementation is now in the working tree: browser access/hot-plug, shared Strudel MIDI loading, source-backed routing, note/automation recording, quantization, review/accept, panic, clock send/receive, UI controls, and revision-safe WebMCP tools. Hardware validation and a native WebMCP bridge remain environment-dependent; the browser also provides a local computer-keyboard fallback for live audition and recording.

Use Strudel's published [`@strudel/midi`](https://www.npmjs.com/package/@strudel/midi) package rather than vendoring Strudel. Sushi now has `@strudel/midi@1.3.0` installed. The WebMCP GitHub repository is the platform specification/explainer, not a browser runtime package; Sushi already uses the official `webmcp-types@0.1.5` definitions and registers tools through `document.modelContext`.

MIDI should be a first-class Strudel output/input capability, not a second audio engine or a hidden DAW event store:

- Strudel remains the playback and scheduling authority.
- Sushi's source remains canonical; recorded material is converted to valid Strudel source before it becomes project state.
- The UI and WebMCP/WebCLI use the same MIDI controller/service, so agents do not get a parallel or less capable API.
- Browser permissions, device selection, and external-hardware actions remain visible and human-controlled.

## Important implementation facts

- `@strudel/midi` adds the `.midi()` Pattern method and exports `enableWebMidi`, `midin`, `midikeys`, and `WebMidi`. It supports note output, channels, velocity, CC, program change, SysEx, NRPN, pitch bend, aftertouch, and MIDI clock messages.
- `@strudel/web` does not automatically expose the MIDI package's exports in its evaluation scope. Sushi must dynamically load `@strudel/midi` during `StrudelAdapter.init()`, patch the same `Pattern` prototype, and inject the MIDI exports into the existing Strudel evaluation scope. Merely adding the dependency is not sufficient.
- Strudel's current `midikeys()` intentionally ignores note-off events and produces fixed-length notes. It is useful for live performance input, but it is not sufficient for a DAW recorder. Recording must capture raw note-on/note-off pairs from the shared Web MIDI/WebMidi access object.
- Web MIDI requires a secure context, is subject to the browser's `midi` Permissions Policy, and is not supported by every browser. MIDI access must be requested from a visible user action; a WebMCP agent cannot silently grant browser permission.

## Canonical source representation

### Routed MIDI track

A track that sends to an external instrument should contain its route in source, for example:

```js
// @sushi-track {"id":"trk_bass","name":"Bass","type":"synth","schema":1}
$: seqPLoop([0, 4, note("c2 ~ c2 ~").slow(4)])
  .midichan(1)
  .midi("USB Bass Station")
```

Channel, velocity, CC mappings, program changes, clock commands, and other MIDI behavior should likewise be represented by native Strudel methods/options. Device IDs may be used at runtime, but generated source should use a human-readable port name and Sushi should keep a best-effort preferred-port identity separately from source.

### Recorded material

The recorder should choose the smallest source form that preserves the take:

1. **Quantized grid:** use the existing explicit note-grid representation with `.slow(totalCycles)`, rests, `.velocity(...)`, and native duration controls.
2. **Exact/overlapping events:** emit a `seqPLoop` with one or more explicit timed sections, for example:

   ```js
   $: seqPLoop(
     [0.00, 0.50, note("c4").velocity(0.82)],
     [0.75, 1.25, note("e4").velocity(0.71)]
   ).midi("USB Bass Station", { midichannel: 1 })
   ```

   This keeps overlaps and note lengths expressible in Strudel's timing model instead of putting an opaque JSON event list in IndexedDB.

The serializer has deterministic unit coverage and must still be checked against Strudel's real `queryArc()` and MIDI output with a browser device before release. A raw take may exist in memory while recording or while the user reviews it, but it must not become a second playback authority. Stopping/accepting a take creates one normal source revision and therefore participates in undo, validation, persistence, and WebMCP revision conflicts.

## UX surface

### Global MIDI setup

Add a MIDI section to the transport/settings area with:

- `Connect MIDI` / `Disconnect MIDI` and a clear permission/error state.
- Support status and secure-context guidance.
- Input and output port lists with manufacturer/name, connected/disconnected state, and activity indicators.
- Refresh/hot-plug handling through `MIDIAccess.statechange`.
- Preferred input/output selection, with graceful fallback when a device disappears.
- A separate, explicit advanced control for SysEx permission; do not request SysEx merely to play ordinary notes.
- MIDI input channel filter and output channel default.
- Input monitor/thru toggle.
- Panic / All Notes Off / Reset Controllers, available even when playback is stopped.

### Per-track MIDI panel

Replace the current MIDI placeholder in `TrackFxDrawer` with:

- MIDI output enable/bypass.
- Output port selector and channel selector (`1`–`16` / all where applicable).
- A local live-instrument picker for MIDI tracks; the blank track stays `silence` until a take is accepted, while incoming notes use the selected Strudel synth/soundfont immediately.
- Velocity source/default, gain multiplier, note-off/latency offset, and optional program number.
- CC learn: arm the shared service, move a hardware knob, and expose the learned controller/value for source mapping and automation capture.
- Clock mode: off, send MIDI clock, or receive external transport/clock telemetry.
- A test-note button that requires an intentional click and reports the selected port/channel.
- A concise source preview showing the native Strudel calls that will be written.

### Transport and recording

Add a real record control beside Play/Pause/Stop:

- `Add track` offers separate Audio track and MIDI track actions; a MIDI track starts as a marked `silence` lane with no sound calls.
- `Record now` creates/selects a MIDI track when needed, defaults to the selected hardware input when one is connected, and starts the input state machine; the source picker can switch explicitly to computer keys.
- While recording, the live take is shown both in the MIDI panel and as note blocks on the target timeline lane; Stop & save commits it into the canonical source.
- `Record` arms the selected track and makes the MIDI input requirement explicit.
- A count-in (off, one bar, or two bars) starts on a musical boundary using the same audio transport clock as the playhead.
- States are visible: idle, armed, count-in, recording, stopping, review/error.
- Stop ends the take, closes unmatched notes safely, and commits the normal UI take immediately; the review state still offers **Keep**, **Retry**, and **Cancel** to WebMCP/manual recovery callers.
- Quantize menu: off, 1/4, 1/8, 1/16, 1/32, triplets, with strength and swing options. Default recommendation: 1/16 at 100% for the first release, with an explicit Off mode for exact recording.
- Overdub replaces or layers the selected track intentionally; it must never silently overwrite source.
- Capture note, velocity, channel, onset, and release. Preserve chords and overlapping notes.
- During review, show captured notes on the existing piano roll/timeline before committing source.
- Stop/pause/re-evaluation/disconnect must send a panic or all-notes-off message on affected ports so external instruments cannot hang.
- The browser piano layout uses `A W S E D F T G Y H U J K` (Shift raises one octave), while the `R` shortcut follows the record state machine only when a piano key is not being played.

## Runtime architecture

Create one browser-side `MidiService` owned by the studio session:

```text
Studio
  ├─ StrudelAdapter (audio + Strudel scheduler + visual transport clock)
  ├─ MidiService (WebMidi access, ports, listeners, panic, recorder)
  └─ WebMCP controller (calls the same Studio/MidiService methods)
```

Suggested modules:

- `src/lib/midi/types.ts` — port, permission, message, recording, and runtime state contracts.
- `src/lib/midi/service.ts` — one Web MIDI/WebMidi access lifecycle, hot-plug, listeners, send/panic, and permission errors.
- `src/lib/midi/recorder.ts` — timestamp normalization, note pairing, unmatched-note policy, channel filtering, and take lifecycle.
- `src/lib/midi/quantize.ts` — cycle/beat conversion using the canonical BPM and quarter-notes-per-cycle, quantization, swing, clamping, and overlap-safe duration handling.
- `src/lib/midi/source-writer.ts` — deterministic Strudel source generation and source-range expansion.
- `src/components/studio/MidiPanel.tsx` — accessible device, permission, recording, clock, learn, and safety controls.

`StrudelAdapter` should dynamically import `@strudel/midi` after the web runtime is loaded, use the package's shared `WebMidi` instance for the service, and make sure MIDI methods/functions are available in the same `evalScope` as `note`, `s`, and `setcpm`. It must not create a second scheduler or audio context.

Use the AudioContext/transport clock as the musical clock. Convert incoming event timestamps to cycles only after anchoring the recording start to a known transport cycle. Do not use React render time or `Date.now()` as the musical timeline.

## WebMCP/WebCLI contract

All agent-facing actions should call the same controller methods as the UI. Add versioned, structured tools in `src/lib/webmcp/tools.ts` and wire them through `useStudioWebMcp.ts`.

### Read tools

- `get_midi_capabilities` — Web MIDI support, secure-context status, permission state, SysEx capability, and browser limitations.
- `list_midi_devices` — connected inputs/outputs with stable runtime IDs, names, manufacturers, and connection state. Avoid exposing unnecessary hardware metadata.
- `inspect_midi_state` — selected ports, channel/filter, monitor, clock mode, recording state, active take summary, and last error.
- `read_midi_take` — bounded, reviewable note/event summary; never return unbounded raw event data.

### Mutating/runtime tools

- `request_midi_access` — starts the permission flow only when the host can associate it with user intent; otherwise return `MIDI_USER_GESTURE_REQUIRED` with a UI action for the user.
- `select_midi_input` / `select_midi_output` — select by runtime ID or exact name and return the resulting state.
- `set_track_midi_route` — writes the native Strudel route with `trackId`, `baseRevision`, and `transactionId`.
- `arm_midi_recording` — target track, input, channel, count-in, quantization, overdub/replace mode.
- `start_midi_recording` / `stop_midi_recording` / `cancel_midi_recording` — use the same state machine and return a review/commit result.
- `accept_midi_take` — commit the serialized Strudel source as one source transaction after review.
- `set_midi_settings` — configure channels, monitor, and send/receive clock mode only after explicit user opt-in.
- `learn_midi_control` — wait for one incoming CC and return the learned controller/value for source mapping.
- `panic_midi` — send All Notes Off/All Sound Off/Reset Controllers to selected or all connected outputs.
- `send_midi_test_note` — guarded, short, explicit hardware test action; never infer it from a read request.

Every source-changing tool must use the existing optimistic revision and transaction-ID protocol and return the standard source diff/state. Runtime-only MIDI actions should return the current runtime snapshot and must not increment the source revision. Tool descriptions should state that MIDI affects connected external hardware. Mark reads with `readOnlyHint`; mark source/hardware actions as mutating and keep `untrustedContentHint` for device-provided names or source-derived content.

WebMCP's current imperative API is `document.modelContext.registerTool()`. Keep registration abortable, preserve the existing feature detection, and expose tools only from the top-level Sushi page. Add `toolchange`/discovery tests when the browser host supports them. Do not claim that a backend MCP server can access the user's local MIDI devices: only the in-page WebMCP controller can do that.

## Delivery phases

### Phase 0 — completed foundation

- Install `@strudel/midi@1.3.0`.
- Keep official `webmcp-types@0.1.5` and current `document.modelContext` registration.
- Allow `midi=(self)` in development/preview/deployment Permissions Policy.
- Keep `PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN` support for browser builds where WebMCP requires it.
- Build a fake WebMidi test double and prove shared-runtime loading without hardware.

### Phase 1 — MIDI access and output (implemented)

- Implement `MidiService` permission/access lifecycle and hot-plug inventory.
- Dynamically load `@strudel/midi` into the existing Strudel runtime/eval scope.
- Add device selectors, port status, per-track route/channel controls, test note, and panic.
- Add adapter cleanup on stop, pause, source re-evaluation, disconnect, and destroy.
- Verify native `.midi()` output against the existing playhead and BPM changes.

**Exit criteria:** a user can connect a device, choose a port/channel, play a source `.midi()` track, stop safely, and recover from disconnect without stuck notes or a second clock.

### Phase 2 — note recording (implemented)

- Implement transport-anchored note-on/off capture.
- Add record button, count-in, selected-track targeting, quantize settings, replace/overdub, review, and commit/cancel.
- Generate quantized note-grid source first; then add exact `seqPLoop` event serialization.
- Preserve velocity, duration, chords, overlaps, channel, and source route.
- Add undo/redo and invalid-draft fallback around accepted takes.

**Exit criteria:** record → review → accept produces valid Strudel source that reproduces the take at the same BPM and survives reload, range extension, and source undo.

### Phase 3 — MIDI editing and performance (core implemented; hardware validation pending)

- Display captured notes in the review preview and use the static-grid serializer to make uniform quantized takes editable in the piano roll with velocity/duration-preserving source data.
- Add input monitor/thru, channel filtering, one-pass loop-boundary recording, count-in transport, and explicit take replacement/overdub.
- Add next-controller CC learn and write native `ccn`/`ccv` automation source; full effect-specific `midimap` binding remains a follow-up UI refinement.
- Add source-aware routing UI for layered tracks without breaking procedural/read-only lanes.

### Phase 4 — complete message coverage (implemented through native controls; hardware validation pending)

- CC automation recording and playback.
- Program change, pitch bend, channel aftertouch, raw NRPN/RPN CC sequences, and SysEx with explicit advanced permissions and bounded validation; poly-aftertouch is surfaced as captured raw input and channel-aftertouch-compatible output where native Strudel lacks a dedicated sender.
- MIDI clock send, then external clock receive/sync with a clear master-clock policy.
- Device profiles only if needed; avoid hard-coding one manufacturer's protocol into the core.

### Phase 5 — WebMCP/WebCLI parity and hardening (implemented in code; native bridge validation pending)

- Add the read/mutate tools above with JSON schemas, cancellation, revision conflicts, idempotency, and bounded results.
- Add agent-visible review/approval states for hardware actions and source commits.
- Test native `document.modelContext`, the WebCLI/bridge path, unsupported browsers, permission denial, missing ports, hot-plug, multiple tabs, cancellation, and agent/UI races.
- Add user-facing MIDI docs and troubleshooting for HTTPS/localhost, browser support, OS MIDI routing, and SysEx permissions.

## Acceptance matrix

- No MIDI API / insecure context / denied permission / permission policy blocked.
- One input, multiple inputs, one output, multiple outputs, and hot-plug/disconnect.
- Note-on with velocity zero treated as note-off; explicit note-off; unmatched note-on at stop.
- Chords, overlapping notes, sustain-like long notes, channel filtering, and velocity extremes.
- BPM changes, seek, pause/resume, stop, source re-evaluation, loop/range extension, and transport restart.
- Quantized and exact recording at 4/6/8-bar ranges; no duplicate first-bar notes; no source-only hidden state.
- MIDI output timing remains aligned with the native Strudel/audio transport clock.
- Panic works on stop, disconnect, failed evaluation, and page/session teardown.
- WebMCP tools expose accurate state, refuse stale revisions, preserve transaction idempotency, and never bypass browser/user permission prompts.
- The same user operation produces the same source/state result through UI, WebMCP, and the WebCLI bridge.

## Current setup changes

- `@strudel/midi@1.3.0` is installed in `package.json`/`bun.lock`.
- `webmcp-types@0.1.5` was already installed and configured in `tsconfig.json`.
- Existing WebMCP registration remains in `src/lib/webmcp/tools.ts` and `src/components/studio/useStudioWebMcp.ts`.
- WebMCP origin-trial token support remains in `src/pages/index.astro`.
- `midi=(self)` is now included in `astro.config.mjs` and `public/_headers`.
- `TrackFxDrawer` now exposes source-backed MIDI routing, while `MidiPanel` owns device access, recording, monitoring, clock, learn, and safety controls.
- Native WebMCP and WebCLI execution remain environment-dependent; unit tests cover registration, schemas, cancellation, guarded hardware actions, and revision conflicts.
