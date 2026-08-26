# sushi

Browser-based DAW for composing music with an agent, powered by Strudel.

A human and an agent share the same client-side studio. Both can create, edit, arrange, and hear the music.

## Architecture

- Astro shell with a React studio island
- Strudel via `@strudel/web`
- WebMCP adapter boundary (planned for the agent-surface slice)
- IndexedDB for local projects and audio assets
- Cloudflare Pages for static deployment

Strudel source is canonical. `$:` blocks become tracks, recognized method chains become controls, and `arrange(...)` / `seqPLoop(...)` provide timeline ranges. The UI and agent operate on the same source.

See [SPEC.md](./SPEC.md) for the canonical product and architecture specification.

## Slice 0: runtime proof

The current vertical slice is a source-first DAW workstation at `/`:

- The Astro shell mounts `Studio` as a `client:load` React island.
- A BandLab-minimal arrangement surface pairs a numbered bar ruler, compact track-control strips, source clips, and a Zed-inspired, line-numbered Strudel source sidebar.
- **Add track** appends a valid synth block to the source and commits it through the same Strudel evaluation path as an editor change.
- Track gain and pan controls rewrite numeric `.gain(...)` and `.pan(...)` calls in the marked Strudel expression and evaluate the updated source immediately.
- Mute and solo use Strudel's source labels (`_$:` and `S$:`), so their state is visible and editable in the source editor. Unsupported chain values remain source-visible and are not presented as editable scalar controls.
- `StrudelAdapter` is the only module that imports `@strudel/web`; it evaluates the accepted source and owns Play/Stop.
- Source edits stay in a draft until **Commit source** evaluates them through Strudel.
- Failed evaluations remain visible as diagnostics while the last-valid source and active revision stay playable.
- Audio waits for an explicit Play gesture to satisfy browser autoplay policy.

The source fixture and project state live in `src/lib/project/model.ts`. The visual execution contract for this slice is recorded in [DESIGN-BRIEF.md](./DESIGN-BRIEF.md).

WebMCP is not registered yet. The project includes `webmcp-types`, but no client-side `document.modelContext` tool registry has been added; that is scoped to Slice 3 in [SPEC.md](./SPEC.md).

## Commands

```sh
bun install
bun run dev
bun run build
bun run preview
```
