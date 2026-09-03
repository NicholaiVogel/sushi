import { describe, expect, test } from 'bun:test';
import { getSourceBlockDetails, updateTrackMidiRoute } from '../project/source-mapper';
import { parseNoteGrid } from '../project/note-grid';
import { serializeMidiNotes, writeMidiTakeToSource } from './source-writer';
import type { MidiRecordedTake } from './types';

const source = `setcpm(120 / 4)\nconst key = "C:major"\n\n// @sushi-track {"id":"trk_midi","name":"MIDI lane","type":"midi","instrument":"sine","generated":"midi-recording","schema":1}\n$: /* @sushi-midi-generated:start */ silence /* @sushi-midi-generated:end */\n`;

function take(mode: 'replace' | 'overdub' = 'replace', overrides: Partial<MidiRecordedTake> = {}): MidiRecordedTake {
	return {
		trackId: 'trk_midi',
		inputId: 'in-1',
		startedAtCycle: 0,
		endedAtCycle: 1,
		notes: [
			{ id: 'n1', note: 60, velocity: 0.8, channel: 1, startCycle: 0.1, endCycle: 0.3 },
			{ id: 'n2', note: 64, velocity: 0.6, channel: 2, startCycle: 0.5, endCycle: 0.8 },
		],
		automation: [],
		rawMessageCount: 2,
		options: { trackId: 'trk_midi', inputId: 'in-1', channel: 'all', mode, quantize: 'off', quantizeStrength: 1, swing: 0, countInBars: 0, loop: false, captureAutomation: false },
		...overrides,
	};
}

describe('MIDI source writer', () => {
	test('serializes exact timed notes with native MIDI methods', () => {
		const result = writeMidiTakeToSource(source, take(), undefined, { outputName: 'USB Synth', includeRoute: true });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toContain('seqPLoop([0.1, 0.3, note("C4").velocity(0.8).midichan(1)]');
		expect(result.source).toContain('[0.5, 0.8, note("E4").velocity(0.6).midichan(2)]');
		expect(result.source).toContain(".midi('USB Synth')");
		const block = getSourceBlockDetails(result.source).find((candidate) => candidate.id === 'trk_midi');
		expect(block?.timing).toEqual({ mode: 'seqPLoop', startCycle: 0.1, endCycle: 0.8 });
	});

	test('preserves native MIDI route options when serializing a take', () => {
		const result = serializeMidiNotes(take().notes, { instrument: 'gm_acoustic_grand_piano', outputName: 'USB Synth', channel: 2, velocity: 0.7, gain: 0.8, noteOffsetMs: 14, midimap: 'performance', program: 11, includeRoute: true });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.expression).toContain(".s(\"gm_acoustic_grand_piano\").midi('USB Synth', { velocity: 0.7, gain: 0.8, noteOffsetMs: 14, midimap: 'performance' }).progNum(11)");
		expect(result.expression).toContain('.midichan(2)');
	});

	test('inherits route settings when replacing an already-routed track', () => {
		const routedSource = updateTrackMidiRoute(source, 'trk_midi', { output: 'USB Synth', channel: 2, enabled: true, velocity: 0.7, gain: 0.8, noteOffsetMs: 14, program: 11 });
		const result = writeMidiTakeToSource(routedSource, take(), undefined, {});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toContain(".midi('USB Synth', { velocity: 0.7, gain: 0.8, noteOffsetMs: 14 }).progNum(11)");
		expect(result.source).toContain('.midichan(2)');
	});

	test('writes a local instrument without inventing an external MIDI route', () => {
		const result = serializeMidiNotes(take().notes, { instrument: 'triangle', includeRoute: false });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.expression).toContain('.s(\"triangle\")');
		expect(result.expression).not.toContain('.midi(');
	});

	test('uses an editable static note grid for uniform quantized notes', () => {
		const gridTake = take();
		gridTake.notes = [
			{ id: 'g1', note: 60, velocity: 0.8, channel: 1, startCycle: 0, endCycle: 0.25 },
			{ id: 'g2', note: 64, velocity: 0.8, channel: 1, startCycle: 0.5, endCycle: 0.75 },
		];
		gridTake.endedAtCycle = 1;
		gridTake.options.quantize = '1/4';
		const result = writeMidiTakeToSource(source, gridTake, undefined, { outputName: 'USB Synth', startCycle: 0, endCycle: 1 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toContain('note("C4 ~ E4 ~")');
		expect(parseNoteGrid(result.source, 'trk_midi').ok).toBe(true);
	});

	test('keeps quantized takes with varied note lengths editable', () => {
		const gridTake = take();
		gridTake.endedAtCycle = 0.53;
		gridTake.notes = [
			{ id: 'g1', note: 60, velocity: 0.8, channel: 1, startCycle: 0, endCycle: 0.12 },
			{ id: 'g2', note: 64, velocity: 0.6, channel: 1, startCycle: 0.125, endCycle: 0.34 },
		];
		gridTake.options.quantize = '1/16';
		const result = writeMidiTakeToSource(source, gridTake, undefined, { instrument: 'sine', includeRoute: false, startCycle: 0, endCycle: 0.53 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toContain('[0, 0.125, note("C4").velocity(0.8).midichan(1)]');
		expect(result.source).toContain('[0.125, 0.3125, note("E4").velocity(0.6).midichan(1)]');
		expect(result.source).not.toContain('.velocity(0.7)');
		expect(result.source).not.toContain('.slow(');
	});

	test('refuses a static chord grid when stacked releases cannot be represented', () => {
		const gridTake = take();
		gridTake.endedAtCycle = 1;
		gridTake.notes = [
			{ id: 'g1', note: 60, velocity: 0.8, channel: 1, startCycle: 0, endCycle: 0.2 },
			{ id: 'g2', note: 64, velocity: 0.8, channel: 1, startCycle: 0, endCycle: 0.4 },
		];
		gridTake.options.quantize = '1/4';
		const result = writeMidiTakeToSource(source, gridTake, undefined, { startCycle: 0, endCycle: 1 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toContain('[0, 0.25, note("C4").velocity(0.8).midichan(1)]');
		expect(result.source).toContain('[0, 0.5, note("E4").velocity(0.8).midichan(1)]');
		expect(result.source).not.toContain('note("C4,E4")');
	});

	test('refuses overdub until existing notes can be preserved accurately', () => {
		const result = writeMidiTakeToSource(source, take('overdub'), undefined, { outputName: 'USB Synth' });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('UNSUPPORTED_OVERDUB');
	});
});
