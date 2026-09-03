import { describe, expect, test } from 'bun:test';
import { addTrackEffect, getSourceBlockDetails, updateTrackColor, updateTrackGain, updateTrackInstrument, updateTrackMidiRoute, updateTrackPan, updateTrackRange, updateTrackSound } from './source-mapper';
import { MIDI_GENERATED_REGION_END, MIDI_GENERATED_REGION_START, writeMidiTakeToSource } from '../midi/source-writer';
import type { MidiRecordedTake } from '../midi/types';

const source = `setcpm(120 / 4)\nconst key = "C:major"\n\n// @sushi-track {"id":"trk_one","name":"One","type":"synth","schema":1}\n$: note("c3 e3").s("sine")\n\n// @sushi-track {"id":"trk_two","name":"Two","type":"synth","schema":1}\n$: note("g3 a3").s("triangle")\n`;

const freshMidiTrackId = 'trk_fresh_midi';
const freshMidiSource = `setcpm(150 / 4)\nconst key = "E:minor"\n\n// @sushi-track ${JSON.stringify({ id: freshMidiTrackId, name: 'MIDI Track', type: 'midi', instrument: 'sine', generated: 'midi-recording', schema: 1 })}\n$: ${MIDI_GENERATED_REGION_START} silence ${MIDI_GENERATED_REGION_END}\n`;

function evaluateSourceExpression(sourceText: string): void {
	const [track] = getSourceBlockDetails(sourceText);
	const expression = track?.expression;
	expect(expression).toBeDefined();
	if (expression === undefined) return;
	let chain: Record<string, unknown>;
	chain = new Proxy({}, { get: () => (..._args: unknown[]) => chain });
	const evaluate = new Function('silence', 'note', 'seqPLoop', 's', 'sound', `return (${expression});`);
	expect(() => evaluate(chain, () => chain, () => chain, () => chain, () => chain)).not.toThrow();
}

function expectCallAfterGeneratedRegion(sourceText: string, call: string): void {
	const expression = getSourceBlockDetails(sourceText)[0]?.expression ?? '';
	const endMarker = expression.indexOf(MIDI_GENERATED_REGION_END);
	const callStart = expression.indexOf(call);
	expect(endMarker).toBeGreaterThanOrEqual(0);
	expect(callStart).toBeGreaterThan(endMarker);
}

function sourceOutsideGeneratedRegion(sourceText: string): string {
	const start = sourceText.indexOf(MIDI_GENERATED_REGION_START);
	const endMarker = sourceText.indexOf(MIDI_GENERATED_REGION_END, start + MIDI_GENERATED_REGION_START.length);
	if (start < 0 || endMarker < 0) return sourceText;
	return `${sourceText.slice(0, start)}${sourceText.slice(endMarker + MIDI_GENERATED_REGION_END.length)}`;
}

const recordedTake: MidiRecordedTake = {
	trackId: freshMidiTrackId,
	inputId: 'in-1',
	startedAtCycle: 0,
	endedAtCycle: 1,
	notes: [{ id: 'note-1', note: 60, velocity: 0.8, channel: 3, startCycle: 0, endCycle: 0.5 }],
	automation: [],
	rawMessageCount: 2,
	options: {
		trackId: freshMidiTrackId,
		inputId: 'in-1',
		channel: 3,
		mode: 'replace',
		quantize: 'off',
		quantizeStrength: 1,
		swing: 0,
		countInBars: 0,
		loop: false,
		captureAutomation: false,
	},
};

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

	test('places gain after the generated region on a fresh MIDI lane', () => {
		const updated = updateTrackGain(freshMidiSource, freshMidiTrackId, 0.5);

		expectCallAfterGeneratedRegion(updated, '.gain(0.5)');
		evaluateSourceExpression(updated);
	});

	test('places effects after the generated region on a fresh MIDI lane', () => {
		const updated = addTrackEffect(freshMidiSource, freshMidiTrackId, 'room');

		expectCallAfterGeneratedRegion(updated, '.room(');
		evaluateSourceExpression(updated);
	});

	test('places MIDI routing after the generated region on a fresh MIDI lane', () => {
		const updated = updateTrackMidiRoute(freshMidiSource, freshMidiTrackId, { output: 'USB Synth', channel: 3, enabled: true, program: 42 });

		expectCallAfterGeneratedRegion(updated, '.midichan(3)');
		expectCallAfterGeneratedRegion(updated, ".midi('USB Synth')");
		expectCallAfterGeneratedRegion(updated, '.progNum(42)');
		evaluateSourceExpression(updated);
	});

	test('keeps every source-backed control outside the generated region', () => {
		const withGain = updateTrackGain(freshMidiSource, freshMidiTrackId, 0.5);
		const withPan = updateTrackPan(withGain, freshMidiTrackId, 0.25);
		const withColor = updateTrackColor(withPan, freshMidiTrackId, '#8fe1ff');
		const withSound = updateTrackSound(withColor, freshMidiTrackId, 'sine');
		const withEffect = addTrackEffect(withSound, freshMidiTrackId, 'room');
		const withRoute = updateTrackMidiRoute(withEffect, freshMidiTrackId, { output: 'USB Synth', channel: 3, enabled: true, program: 42 });

		for (const call of ['.gain(0.5)', '.pan(0.25)', '.color("#8fe1ff")', '.sound("sine")', '.room(', '.midichan(3)', ".midi('USB Synth')", '.progNum(42)']) {
			expectCallAfterGeneratedRegion(withRoute, call);
		}
		evaluateSourceExpression(withRoute);

		const written = writeMidiTakeToSource(withRoute, recordedTake);
		expect(written.ok).toBe(true);
		if (!written.ok) return;
		expect(sourceOutsideGeneratedRegion(written.source)).toBe(sourceOutsideGeneratedRegion(withRoute));
		evaluateSourceExpression(written.source);
	});

	test('updates a fresh MIDI range without losing the generated region', () => {
		const updated = updateTrackRange(freshMidiSource, freshMidiTrackId, 1, 3);
		if (updated === freshMidiSource) return;

		const [track] = getSourceBlockDetails(updated);
		expect(track.generated).toBe('midi-recording');
		expect(track.expression?.trim()).not.toBe('');
		expect(track.expression?.indexOf(MIDI_GENERATED_REGION_START)).toBeGreaterThanOrEqual(0);
		expect(track.expression?.indexOf(MIDI_GENERATED_REGION_END)).toBeGreaterThan(track.expression?.indexOf(MIDI_GENERATED_REGION_START) ?? -1);
		evaluateSourceExpression(updated);
	});

	test('keeps ordinary non-MIDI block comments trailing source-backed controls', () => {
		const nonMidiSource = `// @sushi-track {"id":"trk_comment_block","name":"Commented","type":"synth","schema":1}\n$: s("bd") /* keep this comment */`;
		const updated = updateTrackGain(nonMidiSource, 'trk_comment_block', 0.5);

		expect(updated).toContain('$: s("bd").gain(0.5) /* keep this comment */');
		evaluateSourceExpression(updated);
	});
});
