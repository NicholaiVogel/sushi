import { describe, expect, test } from 'bun:test';
import { MidiRecorder, classifyMidiMessage, normalizeMidiTimestamp } from './recorder';
import type { MidiRawMessage } from './types';

const clock = (cycle: number, timestampMs: number) => ({ cycle, timestampMs, cyclesPerSecond: 2 });
const message = (data: number[], timestampMs: number, inputId = 'input-1'): MidiRawMessage => {
	const parsed = classifyMidiMessage(data);
	return { inputId, inputName: 'Keyboard', timestampMs, data, ...parsed };
};

const options = {
	trackId: 'track', inputId: 'input-1', channel: 'all' as const, mode: 'replace' as const,
	quantize: 'off' as const, quantizeStrength: 1, swing: 0, countInBars: 0 as const, loop: false, captureAutomation: true,
};

describe('MIDI recorder', () => {
	test('pairs note-on/off messages on the musical clock', () => {
		const recorder = new MidiRecorder();
		recorder.start(options, clock(2, 1_000), 'input-1');
		recorder.addMessage(message([0x90, 60, 100], 1_000), clock(2, 1_000));
		recorder.addMessage(message([0x80, 60, 64], 1_500), clock(3, 1_500));
		const take = recorder.stop(clock(3.5, 1_750));
		expect(take.notes).toHaveLength(1);
		expect(take.notes[0]).toMatchObject({ note: 60, channel: 1, startCycle: 2, endCycle: 3 });
		expect(take.rawMessageCount).toBe(2);
	});

	test('snapshots captured and held notes while recording', () => {
		const recorder = new MidiRecorder();
		recorder.start(options, clock(0, 0), 'input-1');
		recorder.addMessage(message([0x90, 60, 100], 100), clock(0.2, 100));
		const preview = recorder.snapshotTake(clock(1, 500));
		expect(preview).not.toBeNull();
		expect(preview?.notes).toHaveLength(1);
		expect(preview?.notes[0]).toMatchObject({ note: 60, startCycle: 0.2, endCycle: 1 });
		expect(preview?.endedAtCycle).toBe(1);
	});

	test('treats velocity-zero note-on as note-off and closes held notes at stop', () => {
		const recorder = new MidiRecorder();
		recorder.start(options, clock(0, 0), 'input-1');
		recorder.addMessage(message([0x90, 64, 90], 100), clock(0.2, 100));
		recorder.addMessage(message([0x90, 64, 0], 600), clock(1.2, 600));
		recorder.addMessage(message([0x90, 67, 80], 700), clock(1.4, 700));
		const take = recorder.stop(clock(2, 1_000));
		expect(take.notes.map((note) => note.note)).toEqual([64, 67]);
		expect(take.notes[0].endCycle).toBeCloseTo(1.2);
		expect(take.notes[1].endCycle).toBe(2);
	});

	test('filters by input and channel while retaining automation', () => {
		const recorder = new MidiRecorder();
		recorder.start({ ...options, channel: 2, captureAutomation: true }, clock(0, 0), 'input-1');
		recorder.addMessage(message([0x90, 60, 100], 10, 'other-input'), clock(0.02, 10));
		recorder.addMessage(message([0xb1, 74, 90], 100), clock(0.2, 100));
		recorder.addMessage(message([0x91, 60, 100], 200), clock(0.4, 200));
		const take = recorder.stop(clock(1, 500));
		expect(take.notes).toHaveLength(1);
		expect(take.notes[0].channel).toBe(2);
		expect(take.automation).toHaveLength(1);
		expect(take.automation[0].kind).toBe('controlchange');
	});

	test('classifies channel and system messages', () => {
		expect(classifyMidiMessage([0xe0, 0, 64])).toEqual({ kind: 'pitchbend', channel: 1, data1: 0, data2: 64 });
		expect(classifyMidiMessage([0xfa])).toEqual({ kind: 'start' });
		expect(classifyMidiMessage([0xf8])).toEqual({ kind: 'clock' });
	});

	test('normalizes epoch-style event timestamps', () => {
		const original = (globalThis as typeof globalThis & { performance?: Performance }).performance;
		Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => 250, timeOrigin: 1_000_000_000 } });
		try {
			expect(normalizeMidiTimestamp(1_000_000_250, 250)).toBe(250);
			expect(normalizeMidiTimestamp(200, 250)).toBe(200);
		} finally {
			if (original) Object.defineProperty(globalThis, 'performance', { configurable: true, value: original });
			else Reflect.deleteProperty(globalThis, 'performance');
		}
	});
});
