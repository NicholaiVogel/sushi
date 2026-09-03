import { describe, expect, test } from 'bun:test';
import {
	hasOnboardingOverride,
	markOnboardingCompleted,
	ONBOARDING_STORAGE_KEY,
	readOnboardingCompletion,
} from './onboarding';
import { createInitialStudioState, createBlankProjectSnapshot, rebaseProjectSnapshotRevision, snapshotFromStudio } from './helpers';

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

describe('blank project reset', () => {
	test('advances the source revision so blank state replaces persisted work', () => {
		const current = createInitialStudioState();
		current.projectName = 'Saved sketch';
		current.revision = 7;
		current.draft = 'setcpm(120 / 4)';
		current.lastValid = current.draft;

		const blank = createBlankProjectSnapshot(current);

		expect(blank.project.name).toBe('First light');
		expect(blank.project.source.draft).toBe('setcpm(150 / 4)\nconst key = "E:minor"\n');
		expect(blank.project.source.revision).toBe(8);
		expect(blank.activeRevision).toBe(8);
	});
});

describe('loaded project revisions', () => {
	test('rebases an older saved snapshot without changing its source bytes', () => {
		const current = createInitialStudioState();
		current.revision = 2;
		current.activeRevision = 2;
		current.draft = 'setcpm(120 / 4)';
		current.lastValid = current.draft;
		const snapshot = snapshotFromStudio(current);
		snapshot.project.source.revision = 3;
		snapshot.activeRevision = 2;

		const rebased = rebaseProjectSnapshotRevision(snapshot, 7);

		expect(rebased.project.source.draft).toBe(snapshot.project.source.draft);
		expect(rebased.project.source.lastValid).toBe(snapshot.project.source.lastValid);
		expect(rebased.project.source.revision).toBe(8);
		expect(rebased.activeRevision).toBe(7);
	});
});

describe('onboarding query override', () => {
	test('only enables the development override for onboarding=1', () => {
		expect(hasOnboardingOverride('?onboarding=1')).toBe(true);
		expect(hasOnboardingOverride('?onboarding=0')).toBe(false);
		expect(hasOnboardingOverride('?foo=1')).toBe(false);
	});
});
