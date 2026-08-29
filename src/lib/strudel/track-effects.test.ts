import { describe, expect, test } from 'bun:test';
import {
	getTrackEffectDefinition,
	getUnknownTrackEffectDefinition,
	listTrackEffectDefinitions,
	normalizeTrackEffectMethod,
	parseTrackEffectParameter,
	STRUDEL_EFFECT_SOURCE,
} from './track-effects';

describe('track effects library', () => {
	test('exposes Strudel-derived metadata with Sushi UI ranges', () => {
		const lpf = getTrackEffectDefinition('lpf');
		const room = getTrackEffectDefinition('room');

		expect(STRUDEL_EFFECT_SOURCE.packageName).toBe('@strudel/core');
		expect(lpf).toMatchObject({ method: 'lpf', source: 'strudel', group: 'filter' });
		expect(lpf?.description).toContain('cutoff');
		expect(lpf?.parameters[0]).toMatchObject({ name: 'frequency', min: 0, max: 20000, type: 'number' });
		expect(room?.parameters[0]).toMatchObject({ name: 'level', min: 0, max: 1, defaultValue: 0.5 });
	});

	test('resolves aliases to canonical methods while preserving source metadata', () => {
		expect(normalizeTrackEffectMethod('det')).toBe('detune');
		expect(normalizeTrackEffectMethod('lpe')).toBe('lpenv');
		expect(getTrackEffectDefinition('lp')?.method).toBe('lpf');
	});

	test('follows Strudel runtime precedence for ambiguous aliases', () => {
		expect(getTrackEffectDefinition('size')?.method).toBe('roomsize');
		expect(getTrackEffectDefinition('delaytime')?.method).toBe('delaytime');
		expect(getTrackEffectDefinition('delayfeedback')?.method).toBe('delayfeedback');
		expect(normalizeTrackEffectMethod('size')).toBe('roomsize');
		expect(normalizeTrackEffectMethod('dt')).toBe('delaytime');
	});

	test('lists addable effects from the shared library, grouped independently of the UI', () => {
		const definitions = listTrackEffectDefinitions({ addable: true });
		expect(definitions.length).toBeGreaterThan(20);
		expect(definitions.some((definition) => definition.method === 'chorus')).toBe(true);
		expect(definitions.some((definition) => definition.method === 'room')).toBe(true);
		expect(definitions.every((definition) => definition.addable)).toBe(true);
	});

	test('provides a forward-compatible fallback for newer Strudel controls', () => {
		const definition = getUnknownTrackEffectDefinition('futureEffect');
		const parameter = parseTrackEffectParameter(definition, 0, 'somePattern()');

		expect(definition).toMatchObject({ method: 'futureEffect', source: 'fallback', group: 'unknown', addable: false });
		expect(parameter).toMatchObject({ type: 'expression', kind: 'dynamic', expression: 'somePattern()' });
	});
});
