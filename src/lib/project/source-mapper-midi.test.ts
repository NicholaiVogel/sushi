import { describe, expect, test } from 'bun:test';
import { getSourceBlockDetails, updateTrackInstrument, updateTrackMidiRoute } from './source-mapper';

const source = `setcpm(120 / 4)\nconst key = "C:major"\n\n// @sushi-track {"id":"trk_one","name":"One","type":"synth","schema":1}\n$: note("c3 e3").s("sine")\n\n// @sushi-track {"id":"trk_two","name":"Two","type":"synth","schema":1}\n$: note("g3 a3").s("triangle")\n`;

describe('source MIDI route mapping', () => {
	test('projects and updates a MIDI track instrument marker without adding a sound', () => {
		const midiSource = source.replace('// @sushi-track {"id":"trk_one","name":"One","type":"synth","schema":1}', '// @sushi-track {"id":"trk_one","name":"One","type":"midi","instrument":"sine","schema":1}').replace('note("c3 e3").s("sine")', 'silence');
		const details = getSourceBlockDetails(midiSource)[0];
		expect(details.type).toBe('midi');
		expect(details.instrument).toBe('sine');
		expect(details.sound).toBeUndefined();
		const changed = updateTrackInstrument(midiSource, 'trk_one', 'gm_acoustic_grand_piano');
		expect(getSourceBlockDetails(changed)[0].instrument).toBe('gm_acoustic_grand_piano');
		expect(changed).toContain('$: silence');
	});

	test('projects a native MIDI route without confusing nested calls', () => {
		const routed = updateTrackMidiRoute(source, 'trk_one', { output: 'USB Synth', channel: 3, enabled: true });
		const details = getSourceBlockDetails(routed);
		expect(details[0].midi).toEqual({ output: 'USB Synth', channel: 3, enabled: true });
		expect(details[0].effects.some((effect) => effect.method === 'midi')).toBe(false);
		expect(details[1].midi).toBeUndefined();
		expect(routed).toContain(".midichan(3).midi('USB Synth')");
	});

	test('projects native MIDI velocity, gain, note-off, and program settings', () => {
		const routed = updateTrackMidiRoute(source, 'trk_one', { output: 'USB Synth', channel: 3, enabled: true, velocity: 0.72, gain: 0.8, noteOffsetMs: 14, midimap: 'performance', program: 42 });
		const details = getSourceBlockDetails(routed)[0];
		expect(details.midi).toEqual({ output: 'USB Synth', channel: 3, enabled: true, velocity: 0.72, gain: 0.8, noteOffsetMs: 14, midimap: 'performance', program: 42 });
		expect(routed).toContain(".midi('USB Synth', { velocity: 0.72, gain: 0.8, noteOffsetMs: 14, midimap: 'performance' })");
		expect(routed).toContain('.progNum(42)');
	});

	test('preserves existing MIDI options when only output or channel changes', () => {
		const initial = updateTrackMidiRoute(source, 'trk_one', { output: 'A', channel: 2, enabled: true, velocity: 0.6, gain: 0.7, noteOffsetMs: 12 });
		const changed = updateTrackMidiRoute(initial, 'trk_one', { output: 'B', channel: 4, enabled: true });
		expect(changed).toContain(".midi('B', { velocity: 0.6, gain: 0.7, noteOffsetMs: 12 })");
		const settingsOnly = updateTrackMidiRoute(changed, 'trk_one', { channel: 5, enabled: true, velocity: 0.8 });
		expect(settingsOnly).toContain(".midichan(5).midi('B', { velocity: 0.8, gain: 0.7, noteOffsetMs: 12 })");
		const cleared = updateTrackMidiRoute(settingsOnly, 'trk_one', { channel: 5, enabled: true, midimap: null });
		expect(cleared).toContain(".midi('B', { velocity: 0.8, gain: 0.7, noteOffsetMs: 12 })");
	});

	test('uses the valid object form when default output options are configured', () => {
		const routed = updateTrackMidiRoute(source, 'trk_one', { output: null, channel: 2, enabled: true, velocity: 0.5 });
		expect(routed).toContain('.midichan(2).midi({ velocity: 0.5 })');
	});

	test('preserves and updates legacy object-form MIDI routes', () => {
		const legacy = source.replace('note("c3 e3").s("sine")', 'note("c3 e3").midi({ port: "Legacy", velocity: 0.6, gain: 0.7 })');
		const changed = updateTrackMidiRoute(legacy, 'trk_one', { channel: 4, enabled: true, velocity: 0.8 });
		expect(changed).toContain('.midi({ port: "Legacy", velocity: 0.8, gain: 0.7 })');
		const moved = updateTrackMidiRoute(changed, 'trk_one', { output: 'Modern', channel: 4, enabled: true });
		expect(moved).toContain(".midi('Modern', { velocity: 0.8, gain: 0.7 })");
		const defaultOutput = updateTrackMidiRoute(moved, 'trk_one', { output: null, channel: 4, enabled: true });
		expect(defaultOutput).toContain('.midi({ velocity: 0.8, gain: 0.7 })');
	});

	test('adds an output when a source already has only a channel control', () => {
		const channelOnly = source.replace('note("c3 e3").s("sine")', 'note("c3 e3").midichan(2).s("sine")');
		const routed = updateTrackMidiRoute(channelOnly, 'trk_one', { output: 'A', channel: 4, enabled: true });
		expect(routed).toContain(".midichan(4).s(\"sine\").midi('A')");
	});

	test('updates and disables an existing route while preserving the pattern', () => {
		const enabled = updateTrackMidiRoute(source, 'trk_one', { output: 'A', channel: 1, enabled: true });
		const changed = updateTrackMidiRoute(enabled, 'trk_one', { output: 'B', channel: 16, enabled: true });
		const disabled = updateTrackMidiRoute(changed, 'trk_one', { output: null, channel: 16, enabled: false });
		expect(changed).toContain(".midichan(16).midi('B')");
		expect(disabled).not.toContain('.midi(');
		expect(disabled).toContain('note("c3 e3").s("sine")');
	});
});
