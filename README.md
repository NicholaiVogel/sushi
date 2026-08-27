# sushi

Browser-based DAW for composing music with an agent, powered by Strudel.

A human and an agent share the same client-side studio. Both can create, edit, arrange, and hear the music.

## Architecture

- Astro shell with a React studio island
- Strudel via `@strudel/web`
- Feature-detected WebMCP adapter for agent-facing source and transport tools
- IndexedDB for local projects and audio assets
- Cloudflare Pages for static deployment

Strudel source is canonical. `$:` blocks become tracks, recognized method chains become controls, and `arrange(...)` / `seqPLoop(...)` provide timeline ranges. The UI and agent operate on the same source.

See [SPEC.md](./SPEC.md) for the canonical product and architecture specification.

## Current vertical slice

The current vertical slice is a source-first DAW workstation at `/`:

- The Astro shell mounts `Studio` as a `client:load` React island.
- A BandLab-minimal arrangement surface pairs a numbered bar ruler, compact track-control strips, source clips, and a Zed-inspired, line-numbered Strudel source sidebar.
- New sessions start with only the canonical `setcpm(150 / 4)` and `const key = "E:minor"` header; the first track is added explicitly.
- The top transport includes a 0–300 BPM control centered at 150 and a musical-key dropdown. Both rewrite the canonical source header and evaluate through Strudel immediately.
- **Add track** appends a valid synth block to the source and commits it through the same Strudel evaluation path as an editor change.
- Track gain and pan controls rewrite numeric `.gain(...)` and `.pan(...)` calls in the marked Strudel expression and evaluate the updated source immediately.
- Mute and solo use Strudel's source labels (`_$:` and `S$:`), so their state is visible and editable in the source editor. Unsupported chain values remain source-visible and are not presented as editable scalar controls.
- Tracks can be selected and removed with Backspace/Delete or a context menu, renamed through the inline pencil editor, and moved or resized on quarter-cycle timeline boundaries. Each action writes and evaluates the corresponding Strudel source.
- The track pan control exposes a full 0–100 left-to-right range, with the current value shown beside the L/R slider.
- Project name, draft source, last-valid source, and revisions autosave to IndexedDB and restore before the initial Strudel evaluation.
- Tempo, key, track ranges, and derived seconds are projected from committed Strudel source. Dragging a clip edge writes a `seqPLoop(...)` range back into that track's source block.
- The header BPM, quarter-notes-per-cycle, and key fields are source-backed controls: each edit rewrites the canonical declaration and re-enters the same validated Strudel commit path.
- Undo and redo buttons share the bounded source history with WebMCP transactions. The export and import buttons use a versioned `.sushi.json` envelope, validate it before evaluation, and preserve project asset metadata.
- `StrudelAdapter` is the only module that imports `@strudel/web`; it evaluates the accepted source and owns play, pause, resume, stop, seek, cycle progress, and song-end handling.
- When the browser exposes a usable `document.modelContext`, the studio waits briefly for late host injection before registering the Slice 3 WebMCP tools for state inspection, source read/write/patch, validation, local reference lookup, playback, and revision-aware undo/redo. Transactions are idempotent, stale revisions return structured conflicts, and agent edits share the human source history.
- Tempo, key, track ranges, and derived seconds are projected from committed Strudel source. Dragging a clip moves it; dragging either edge resizes it. Both gestures write quarter-cycle-snapped `seqPLoop(...)` ranges back into the track's source block.
- The timeline starts with a 30-bar capacity; new tracks default to a 4-bar range. The **Extend 137** control (or a longer source/agent range) expands the timeline to 137 bars. Zoom runs from a one-bar close view to every available bar and starts at its midpoint.
- `StrudelAdapter` is the only module that imports `@strudel/web`; it evaluates the accepted source and owns play, pause, resume, stop, seek, cycle progress, and song-end handling.
- When the browser exposes a usable `document.modelContext`, the studio waits briefly for late host injection before registering the Slice 3 WebMCP tools for state inspection, source read/write/patch, tempo/key controls, track deletion/renaming/range edits, validation, local reference lookup, playback, and revision-aware undo/redo. Transactions are idempotent, stale revisions return structured conflicts, and agent edits share the human source history.
- Source edits stay in a draft until **Commit source** evaluates them through Strudel.
- Failed evaluations remain visible as diagnostics while the last-valid source and active revision stay playable.
- The page footer lists the main keyboard and context-menu commands for source validation, track deletion, and clip movement.
- Audio waits for an explicit Play gesture to satisfy browser autoplay policy.

The source fixture and project state live in `src/lib/project/model.ts`. The visual execution contract for this slice is recorded in [DESIGN-BRIEF.md](./DESIGN-BRIEF.md).

WebMCP is an optional browser enhancement. The client feature-detects the canonical `document.modelContext` surface (with legacy host fallbacks), waits for a usable `registerTool` method when an embedded browser installs it after hydration, and leaves the normal browser studio unchanged when it is not available. Registration is tied to the React lifecycle so teardown aborts both late discovery and partially completed registrations. Source-bearing tools declare WebMCP read-only and untrusted-content hints so hosts can apply their normal safety policy. Astro dev/preview and Cloudflare Pages responses send `Origin-Agent-Cluster: ?1` and the default `tools` Permissions Policy. The bounded transaction cache deduplicates concurrent/retried calls within a session; persisted source revisions make accepted edits safe to replay after reload, while the cache itself is intentionally not a cross-browser transaction ledger. For production Chrome origin-trial access, provide the trial token as `PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN` at build time. Local Chrome testing can use `chrome://flags/#enable-webmcp-testing` without a token.

## Commands

```sh
bun install
bun run dev
bun run build
bun run preview
```
