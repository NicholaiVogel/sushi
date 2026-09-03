import { describe, expect, test } from 'bun:test';
import {
	hasOnboardingOverride,
	markOnboardingCompleted,
	ONBOARDING_STORAGE_KEY,
	readOnboardingCompletion,
} from './onboarding';

class MemoryStorage {
	private readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

describe('onboarding persistence', () => {
	test('treats the versioned key as incomplete until it exists', () => {
		const storage = new MemoryStorage();
		expect(readOnboardingCompletion(storage)).toBe(false);
		markOnboardingCompleted(storage);
		expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toBe('completed');
		expect(readOnboardingCompletion(storage)).toBe(true);
	});

	test('does not throw when browser storage is unavailable', () => {
		expect(readOnboardingCompletion(undefined)).toBe(false);
		expect(() => markOnboardingCompleted(undefined)).not.toThrow();
	});
});

describe('onboarding query override', () => {
	test('only enables the development override for onboarding=1', () => {
		expect(hasOnboardingOverride('?onboarding=1')).toBe(true);
		expect(hasOnboardingOverride('?onboarding=0')).toBe(false);
		expect(hasOnboardingOverride('?foo=1')).toBe(false);
	});
});
