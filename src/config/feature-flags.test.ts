import { describe, expect, test } from 'bun:test';
import { createIfEnabled, featureFlags, parseBooleanFeatureFlag, registerIfEnabled } from './feature-flags';

const malformedValues: unknown[] = [undefined, null, '', '1', 'TRUE', 'True', ' true', 'true ', 'false', 1, true];

describe('experimental feature flag boundaries', () => {
	test('enables only the exact string true', () => {
		expect(parseBooleanFeatureFlag('true')).toBe(true);
		for (const value of malformedValues) expect(parseBooleanFeatureFlag(value)).toBe(false);
	});

	test('publishes the Vite environment value through the single umbrella flag', () => {
		expect(featureFlags.experimentalMidi).toBe(parseBooleanFeatureFlag(import.meta.env.VITE_EXPERIMENTAL_MIDI));
	});

	test('does not construct a disabled feature service', () => {
		let constructions = 0;
		const service = createIfEnabled(false, () => {
			constructions += 1;
			return { service: true };
		});

		expect(service).toBeNull();
		expect(constructions).toBe(0);
	});

	test('does not register a disabled feature subscription or shortcut', () => {
		let registrations = 0;
		let cleanups = 0;
		const cleanup = registerIfEnabled(false, () => {
			registrations += 1;
			return () => { cleanups += 1; };
		});

		expect(cleanup).toBeUndefined();
		expect(registrations).toBe(0);
		expect(cleanups).toBe(0);
	});

	test('runs an explicitly enabled composition and its cleanup', () => {
		let registrations = 0;
		let cleanups = 0;
		const cleanup = registerIfEnabled(true, () => {
			registrations += 1;
			return () => { cleanups += 1; };
		});

		expect(registrations).toBe(1);
		cleanup?.();
		expect(cleanups).toBe(1);
	});
});
