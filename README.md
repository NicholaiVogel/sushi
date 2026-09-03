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

Try it live at [sushidaw.com](https://sushidaw.com/).

## Highlights

- Bring in existing Strudel source or write new patterns with Tidal Cycles mini-notation.
- Arrange pattern-based tracks and sections on a visual timeline.
- Shape tempo, key, gain, pan, effects, and playback from the studio.
- Open supported flat `note(...)` and `n(...).scale(...)` lanes in a live piano-roll editor with source-backed note placement, pitch dragging, grid-snapped edge trimming, deletion, and duration editing.
- Save, reopen, import, and export portable `.sushi.json` projects.
- Hear compositions through Strudel and Web Audio.
- Connect browser MIDI devices for native Strudel output, channel routing, recording, quantization, automation capture, and panic recovery.
- Use optional WebMCP integration to let compatible agents inspect the studio, edit source, control playback, and assist with composition, including guarded MIDI state and recording tools.

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

The WebMCP integration also exposes the curated editor templates: agents can use `list_editor_templates` to browse available compositions, `view_editor_template` to inspect one, and `load_editor_template` to load it into the current session. See [`MIDI-ROADMAP.md`](./MIDI-ROADMAP.md) for the planned MIDI device, recording, routing, and agent-tool architecture.

## Browser MIDI

Open the **MIDI** button in the transport, click **Connect MIDI**, and choose the input/output ports. Web MIDI requires HTTPS or `localhost` and a browser with Web MIDI support (Chromium-based browsers are the safest choice). MIDI permission is intentionally user-gesture gated; an agent cannot grant it silently. Computer keys also work as a local piano without MIDI permission: use **A W S E D F T G Y H U J K** (hold Shift for the next octave). Use **Add track → MIDI track** for a blank recordable lane, choose its live instrument in the track controls, then click **Record now** and play computer or hardware keys until **Stop & save**; with hardware connected, the selected MIDI input is the default source, and the Note source picker switches explicitly to computer keys. The normal UI commits the take immediately; the WebMCP review tools still expose an explicit Keep/Retry/Cancel flow. Incoming notes are auditioned through the shared Strudel synth while recording; accepting the take writes editable Strudel source. Use **Panic / all notes off** if an external instrument needs to be reset.

If no ports appear, verify the device is visible to the OS first: macOS users can check **Audio MIDI Setup** (including an IAC Driver bus), while Linux users should check the ALSA/JACK MIDI bridge. Disconnect/reconnect the device and use **Refresh**. SysEx is disabled by default; disconnect and reconnect with **Enable SysEx on connect** only when a device-specific SysEx message is required. A browser permission-policy or insecure-context error must be fixed by serving Sushi from `localhost`/HTTPS rather than bypassed by an agent.

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
