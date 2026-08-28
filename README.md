<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/logos/brand-wordmark-white.png">
    <source media="(prefers-color-scheme: light)" srcset="./public/logos/brand-wordmark-dark.png">
    <img alt="Sushi" src="./public/logos/brand-wordmark-dark.png" width="420">
  </picture>
</p>

# Sushi

Sushi is a browser-based reimplementation of [Strudel](https://strudel.tidalcycles.org/) for importing, writing, and arranging music with [Tidal Cycles](https://tidalcycles.org/) syntax.

Compose in a source editor as you would in a live-coding environment, or use Sushi’s visual studio to organize tracks and patterns on a timeline like a traditional DAW. The source and arrangement share one musical workspace, so code, controls, and playback stay connected.

## Highlights

- Bring in existing Strudel source or write new patterns with Tidal Cycles mini-notation.
- Arrange pattern-based tracks and sections on a visual timeline.
- Shape tempo, key, gain, pan, effects, and playback from the studio.
- Save, reopen, import, and export portable `.sushi.json` projects.
- Hear compositions through Strudel and Web Audio.
- Use optional WebMCP integration to let compatible agents inspect the studio, edit source, control playback, and assist with composition.

## Example

```js
setcpm(120 / 4)

$: s("bd ~ sd ~")
  .gain(0.8)

$: note("<c3 eb3 g3 bb3>")
  .s("sawtooth")
  .lpf(900)
```

## Agent-assisted composition

Sushi uses [WebMCP](https://webmachinelearning.github.io/webmcp) to connect compatible agents to the studio. Agents can read and modify source, inspect musical state, and control playback, making it possible to collaborate on patterns and arrangements through natural-language assistance.

## Run locally

```sh
bun install
bun run dev
```

Build the application with:

```sh
bun run build
```

## Built with gratitude

Sushi builds on the work of:

- [Strudel](https://codeberg.org/uzu/strudel) and [`@strudel/web`](https://www.npmjs.com/package/@strudel/web) for the pattern language, musical runtime, scheduling, synthesis, and browser audio.
- [Tidal Cycles](https://tidalcycles.org/) for the pattern language tradition and mini-notation that make expressive live-coded music possible.
- [Astro](https://astro.build/) and [React](https://react.dev/) for the application shell and interactive studio.
- [WebMCP](https://webmachinelearning.github.io/webmcp) for the browser interface that connects web applications with AI agents.
