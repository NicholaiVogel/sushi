import { describe, expect, test } from 'bun:test';
import { normalizeAppearanceMode } from './appearance';

describe('appearance preferences', () => {
	test('accepts the supported appearance modes', () => {
		expect(normalizeAppearanceMode('system')).toBe('system');
		expect(normalizeAppearanceMode('light')).toBe('light');
		expect(normalizeAppearanceMode('dark')).toBe('dark');
	});

	test('falls back to system for invalid stored values', () => {
		expect(normalizeAppearanceMode(null)).toBe('system');
		expect(normalizeAppearanceMode('sepia')).toBe('system');
		expect(normalizeAppearanceMode(42)).toBe('system');
	});
});
