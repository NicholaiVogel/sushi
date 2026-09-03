import { describe, expect, test } from 'bun:test';
import { midiGridCycles, quantizeCycle, quantizeMidiNotes } from './quantize';

describe('MIDI quantization', () => {
	test('maps musical subdivisions into Strudel cycles', () => {
		expect(midiGridCycles('1/4', 4)).toBe(0.25);
		expect(midiGridCycles('1/16', 4)).toBe(0.0625);
		expect(midiGridCycles('1/8T', 4)).toBeCloseTo(1 / 12);
		expect(midiGridCycles('off', 4)).toBeUndefined();
	});

	test('supports partial-strength quantization and clamps negative positions', () => {
		expect(quantizeCycle(0.11, '1/4', 4, 1)).toBe(0);
		expect(quantizeCycle(0.11, '1/4', 4, 0.5)).toBeCloseTo(0.055);
		expect(quantizeCycle(-1, '1/16', 4)).toBe(0);
	});

	test('quantizes starts and releases without collapsing notes', () => {
		const result = quantizeMidiNotes([
			{ id: 'a', note: 60, velocity: 0.5, channel: 1, startCycle: 0.11, endCycle: 0.22 },
			{ id: 'b', note: 64, velocity: 0.8, channel: 1, startCycle: 0.49, endCycle: 0.5 },
		], 4, '1/4', 1, 0, 0, 1);
		expect(result[0].startCycle).toBe(0);
		expect(result[0].endCycle).toBe(0.25);
		expect(result[1].startCycle).toBe(0.5);
		expect(result[1].endCycle).toBeGreaterThan(result[1].startCycle);
	});
});
