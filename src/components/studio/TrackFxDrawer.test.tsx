import { describe, expect, test } from 'bun:test';
import { normalizeTrackFxDrawerMode } from './TrackFxDrawer';

describe('track controls drawer mode containment', () => {
	test('keeps the Sounds mode available when MIDI is disabled', () => {
		expect(normalizeTrackFxDrawerMode('sounds', false)).toBe('sounds');
	});

	test('falls back from stale MIDI state when MIDI is disabled', () => {
		expect(normalizeTrackFxDrawerMode('midi', false)).toBe('effects');
	});
});