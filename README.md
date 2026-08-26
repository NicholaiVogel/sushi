# sushi

Browser-based DAW for composing music with an agent, powered by Strudel.

A human and an agent share the same client-side studio. Both can create, edit, arrange, and hear the music.

## Architecture

- Astro shell with a React studio island
- Strudel via `@strudel/web`
- WebMCP source-editing tools
- IndexedDB for local projects and audio assets
- Cloudflare Pages for static deployment

Strudel source is canonical. `$:` blocks become tracks, method chains become controls, and `arrange(...)` / `seqPLoop(...)` provide timeline ranges. The UI and agent operate on the same source.

See [SPEC.md](./SPEC.md) for the canonical product and architecture specification.

## Commands

```sh
bun install
bun run dev
bun run build
bun run preview
```
