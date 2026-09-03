import { describe, expect, test } from 'bun:test';
import { writeMidiTakeToSource } from './source-writer';
import type { MidiRecordedTake } from './types';

const ownedSource = `setcpm(120 / 4)
const key = "C:major"

// @sushi-track {"id":"trk_midi","name":"MIDI lane","type":"midi","instrument":"sine","generated":"midi-recording","schema":1}
$: /* @sushi-midi-generated:start */ silence /* @sushi-midi-generated:end */.room(0.25) // user suffix
`;

const authoredSource = ownedSource
	.replace('"type":"midi","instrument":"sine","generated":"midi-recording"', '"type":"synth"')
	.replace('$: /* @sushi-midi-generated:start */ silence /* @sushi-midi-generated:end */.room(0.25) // user suffix', '$: note("c3").s("sine").lpf(800).when(x => x).room(0.25) // user chain');

function take(overrides: Partial<MidiRecordedTake> = {}): MidiRecordedTake {
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
		options: { trackId: 'trk_midi', inputId: 'in-1', channel: 'all', mode: 'replace', quantize: 'off', quantizeStrength: 1, swing: 0, countInBars: 0, loop: false, captureAutomation: false },
		...overrides,
	};
}

describe('MIDI containment source writer', () => {
	test('empty takes are rejected without producing a rest replacement', () => {
		const result = writeMidiTakeToSource(ownedSource, take({ notes: [], rawMessageCount: 0 }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('EMPTY_TAKE');
		expect(result).not.toHaveProperty('source');
		expect(result.error).toMatch(/nothing was recorded|empty/i);
		expect(ownedSource).toContain('silence');
	});

	test('arbitrary hand-authored chains fail closed', () => {
		const result = writeMidiTakeToSource(authoredSource, take());
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/generated|safely|owned/i);
	});

	test('does not treat a generated marker on a non-MIDI track as ownership', () => {
		const spoofedSource = ownedSource.replace('"type":"midi"', '"type":"synth"');
		const result = writeMidiTakeToSource(spoofedSource, take());
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('UNOWNED_TRACK');
	});

	test('an owned generated region is the only region replaced', () => {
		const result = writeMidiTakeToSource(ownedSource, take());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toContain('/* @sushi-midi-generated:start */');
		expect(result.source).toContain('/* @sushi-midi-generated:end */.room(0.25) // user suffix');
		expect(result.source).toContain('.velocity(0.8).midichan(1)');
	});

	test('unsupported automation is not serialized as a rest event', () => {
		const result = writeMidiTakeToSource(ownedSource, take({
			automation: [{ id: 'cc1', kind: 'controlchange', channel: 1, value: 0.7, data: [0xb0, 74, 90], cycle: 0.25 }],
		}));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('UNSUPPORTED_AUTOMATION');
		expect(result).not.toHaveProperty('source');
		expect(result.error).toMatch(/automation.*supported|unsupported/i);
		expect(ownedSource).toContain('silence');
	});

	test('varied velocities stay per-note instead of becoming one global value', () => {
		const result = writeMidiTakeToSource(ownedSource, take({
			notes: [
				{ id: 'g1', note: 60, velocity: 0.2, channel: 1, startCycle: 0, endCycle: 0.25 },
				{ id: 'g2', note: 64, velocity: 0.8, channel: 1, startCycle: 0.5, endCycle: 0.75 },
			],
			options: { ...take().options, quantize: '1/4' },
		}));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toContain('.velocity(0.2)');
		expect(result.source).toContain('.velocity(0.8)');
		expect(result.source).not.toContain('.velocity(0.5)');
	});

	test('captured channels are not replaced by a route default', () => {
		const result = writeMidiTakeToSource(ownedSource, take({
			notes: [{ id: 'n1', note: 60, velocity: 0.8, channel: 2, startCycle: 0.1, endCycle: 0.3 }],
		}), undefined, { channel: 1 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.source).toContain('.midichan(2)');
		expect(result.source).not.toContain('.midichan(1)]');
	});

	test('overdub refuses to reconstruct existing notes with guessed values', () => {
		const result = writeMidiTakeToSource(ownedSource, take({ options: { ...take().options, mode: 'overdub' } }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatch(/overdub|supported|existing/i);
	});
});
