import { describe, expect, test } from 'bun:test';
import { getNewAudioTrackExpression } from './helpers';

describe('new audio track source', () => {
	test('preserves the pre-MIDI expression when MIDI is disabled', () => {
		expect(getNewAudioTrackExpression(false)).toBe('$: seqPLoop([0, 4, note("<c3 e3 g3 a3>").s("sine").gain(0.18)])');
	});

	test('uses the MIDI-era expression only when MIDI is enabled', () => {
		expect(getNewAudioTrackExpression(true)).toBe('$: seqPLoop([0, 4, note("c3 e3 g3 a3").slow(4).s("sine").gain(0.18)])');
	});
});
