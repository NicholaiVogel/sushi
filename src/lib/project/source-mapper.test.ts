import { describe, expect, test } from 'bun:test';
import { DEFAULT_SOURCE } from './model';
import { getSourceBlockDetails, updateTrackGain, updateTrackMode, updateTrackPan } from './source-mapper';

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
});
