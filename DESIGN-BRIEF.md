# Sushi Slice 0 design brief

## Design read

Sushi is a source-first browser DAW for a beginner and an agent sharing one musical workspace. The first slice has to feel like a working music workstation: an authored Strudel source stays safe to edit in a docked editor, the accepted revision is immediately audible, and the derived lanes occupy the main canvas.

## Execution contract

- **Content mode:** product workspace / interactive tool.
- **Primary page archetype:** compact DAW workstation with a docked source editor and arrangement canvas.
- **First-viewport job:** show the transport, editable source, beat grid, and source-derived lanes without a marketing hero or dashboard furniture.
- **Hierarchy:** centered editable project name and transport → source sidebar plus arrangement timeline → inline diagnostics only when needed.
- **Composition grammar:** dark application frame; a flush, line-numbered source sidebar anchors a BandLab-like arrangement surface with a compact track-control strip, numbered bar ruler, full-height beat grid, and source clips that keep a consistent lane rhythm. Empty space stays available for future editor, mixer, and inspector surfaces.
- **Type roles:** expressive sans display for the promise, readable sans for controls and prose, restrained mono for source, revision, and diagnostics.
- **Spacing rhythm:** tight (8px), related (16px), group (24px), section (40px), page (64px).
- **Surface rules:** near-black canvas, charcoal panels, one-pixel hairlines, small radii, and one acid-lime interaction accent. No decorative card wall or gradient mesh.
- **Media rules:** no external media in Slice 0; the signal bars are a semantic playback indicator, not a fake waveform.
- **Interaction rules:** source-editor edits stay local until Commit; mapped track controls write the corresponding Strudel source expression and evaluate immediately; tracks can be selected, deleted with Backspace/Delete or a context menu, renamed through the hover pencil, and moved or resized on quarter-cycle boundaries; a failed draft remains visible while the last-valid source remains the playable runtime; Play and Stop are always visible.
- **Session controls:** new sessions contain only the tempo/key header; a 0–300 BPM control is centered at 150, the key dropdown rewrites `const key`, and both changes evaluate through the shared Strudel pipeline; the timeline starts at 30 bars, new tracks span four bars, and dragging or lengthening beyond the current boundary adds 30-bar pages up to 137 bars.
- **Responsive behavior:** desktop docks source left of a full-height timeline; below 980px the source editor moves above the canvas and the timeline keeps a fixed-height, horizontally scrollable grid with compact lane heights; controls remain touch-sized and source text keeps a readable minimum width.
- **Motion budget:** one restrained signal-bar pulse while playing. `prefers-reduced-motion` disables it without hiding state.
- **Signature moves:** a centered editable session name, flush line-numbered source editor, compact transport clock, BandLab-style add-track control strip, and beat-grid timeline make the boundary between draft and sound visible.
- **Anti-patterns:** no hero headline, marketing intro, redundant section headers, decorative card wall, permanent status boxes, fake waveform, opaque status badges, decorative controls with no Strudel mapping, audio autoplay, or UI that hides invalid source behind a toast.
- **Real-content fixture:** the two marked synth blocks in `src/lib/project/model.ts`, with a deliberately invalid draft exercised through the source editor.
- **Decision ownership:** the spec fixes Strudel, source-first behavior, dark monochrome undertones, and beginner-legible controls; the user selected a BandLab-minimal / Zed-detail direction, with the lime accent and existing font pairing retained.

## Route map

| Route | Purpose | Slice status |
| --- | --- | --- |
| `/` | Source-first runtime proof | In scope |

## Acceptance matrix

| Requirement | Evidence |
| --- | --- |
| Astro mounts a React island | `src/pages/index.astro` uses `Studio client:load` |
| Strudel is the runtime boundary | `src/lib/strudel/adapter.ts` dynamically imports `@strudel/web` in the browser |
| Valid source evaluates and plays | Play calls the adapter against the committed source |
| Invalid draft is visible and non-destructive | Commit preserves `lastValid` and `activeRevision`, then renders diagnostics |
| Track controls are source-backed | Gain/pan rewrite numeric Strudel chain calls; mute/solo rewrite `_$:`/`S$:` labels and re-evaluate through `StrudelAdapter` |
| Track editing is source-backed | Selection, context-menu/keyboard deletion, inline rename, clip movement, and quarter-cycle range edits update and evaluate the corresponding source block |
| Projects reopen from local storage | IndexedDB restores the project name, draft, last-valid source, and revision before the runtime boots |
| Timeline timing stays source-backed | `seqPLoop(...)` ranges render as cycle/second spans; dragging either clip edge rewrites the marked source block |
| Transport follows Strudel's scheduler | Play, pause/resume, stop-to-zero, seek, live cycle progress, and song-end stop use the adapter scheduler |
| Source state is inspectable | Draft, last-valid source, diagnostics, and active revision are visible together |
| Layout remains usable on narrow screens | Responsive CSS recomposes the workspace below 860px |
