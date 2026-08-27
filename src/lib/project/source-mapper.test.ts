import { describe, expect, test } from 'bun:test';
import { DEFAULT_SOURCE } from './model';
import {
	cyclesToSeconds,
	getSourceBlockDetails,
	getSourceGlobals,
	secondsToCycles,
	updateTrackGain,
	updateTrackMode,
	updateTrackPan,
	updateTrackRange,
} from './source-mapper';

const pulseId = 'trk_01J4PULSE';

describe('source mapper', () => {
	test('projects marked labels and scalar chain controls', () => {
		const [pulse, glass] = getSourceBlockDetails(DEFAULT_SOURCE);

		expect(pulse).toMatchObject({ id: pulseId, name: 'Pulse', line: 4, label: '$', gain: 0.24, muted: false, soloed: false });
		expect(pulse.expressionRange?.line).toBe(5);
		expect(pulse.pan).toBeUndefined();
		expect(glass.gain).toBe(0.16);
	});

	test('updates only the selected block and appends missing pan', () => {
		const withGain = updateTrackGain(DEFAULT_SOURCE, pulseId, 0.5);
		const withPan = updateTrackPan(withGain, pulseId, 0.25);

		expect(withPan).toContain('$: note("<e2 e2 g2 b2>").s("sawtooth").gain(0.5).pan(0.25)');
		expect(withPan).toContain('$: note("<e4 b3 g4 a4>").s("triangle").gain(0.16)');
	});

	test('projects and updates controls across a multiline chain', () => {
		const source = `// @sushi-track {"id":"trk_multiline","name":"Lead","type":"synth","schema":1}\n$: n("<0 2 4>")\n  .s("sawtooth")\n  .gain(.5)\n  .room(.7)\n\n// @sushi-track {"id":"trk_other","name":"Other","type":"synth","schema":1}\n$: s("bd")`;
		const [lead] = getSourceBlockDetails(source);
		const updated = updateTrackGain(source, 'trk_multiline', 0.8);

		expect(lead.gain).toBe(0.5);
		expect(lead.gainEditable).toBe(true);
		expect(updated).toContain('  .gain(0.8)');
		expect(updated.match(/\.gain\(/g)?.length).toBe(1);
		expect(updated).toContain('  .room(.7)\n\n// @sushi-track');
	});

	test('uses Strudel labels for mute and solo', () => {
		const soloed = updateTrackMode(DEFAULT_SOURCE, pulseId, 'solo', true);
		const unmuted = updateTrackMode(soloed, pulseId, 'solo', false);
		const muted = updateTrackMode(unmuted, pulseId, 'mute', true);
		const restored = updateTrackMode(muted, pulseId, 'mute', false);

		expect(soloed).toContain('S$: note("<e2 e2 g2 b2>")');
		expect(muted).toContain('_$: note("<e2 e2 g2 b2>")');
		expect(unmuted).toContain('$: note("<e2 e2 g2 b2>")');
		expect(restored).toContain('$: note("<e2 e2 g2 b2>")');
	});

	test('does not rewrite non-scalar chain expressions', () => {
		const source = DEFAULT_SOURCE.replace('.gain(0.24)', '.gain(slider(0.24, 0, 1))');
		expect(updateTrackGain(source, pulseId, 0.5)).toBe(source);
	});

	test('projects source tempo, key, and cycle/second conversion', () => {
		const globals = getSourceGlobals(DEFAULT_SOURCE);

		expect(globals).toEqual({ bpm: 84, quarterNotesPerCycle: 4, key: 'E:minor' });
		expect(cyclesToSeconds(10.5, globals)).toBe(30);
		expect(secondsToCycles(30, globals)).toBe(10.5);
	});

	test('writes and reads explicit seqPLoop track ranges', () => {
		const ranged = updateTrackRange(DEFAULT_SOURCE, pulseId, 1, 3.5);
		const [pulse, glass] = getSourceBlockDetails(ranged);

		expect(ranged).toContain('seqPLoop([1, 3.5, note("<e2 e2 g2 b2>").s("sawtooth").gain(0.24)])');
		expect(pulse.timing).toEqual({ mode: 'seqPLoop', startCycle: 1, endCycle: 3.5 });
		expect(glass.timing).toEqual({ mode: 'full', startCycle: 0, endCycle: 4 });
	});

	test('projects arrange durations as a source timing span', () => {
		const arrangeSource = DEFAULT_SOURCE.replace(
			'note("<e2 e2 g2 b2>").s("sawtooth").gain(0.24)',
			'arrange([2, note("<e2 e2 g2 b2>").s("sawtooth")], [3, note("<a2 b2>").s("sawtooth")])',
		);
		const [pulse] = getSourceBlockDetails(arrangeSource);

		expect(pulse.timing).toEqual({ mode: 'arrange', startCycle: 0, endCycle: 5 });
	});
});
