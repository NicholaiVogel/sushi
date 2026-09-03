export const ONBOARDING_STORAGE_KEY = 'sushi:onboarding:v1';

type OnboardingStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): OnboardingStorage | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

export function readOnboardingCompletion(storage: OnboardingStorage | undefined = browserStorage()): boolean {
	if (!storage) return false;
	try {
		return storage.getItem(ONBOARDING_STORAGE_KEY) !== null;
	} catch {
		return false;
	}
}

export function markOnboardingCompleted(storage: OnboardingStorage | undefined = browserStorage()): void {
	if (!storage) return;
	try {
		storage.setItem(ONBOARDING_STORAGE_KEY, 'completed');
	} catch {
		// Storage is optional. Completion still applies for this mounted session.
	}
}

export function hasOnboardingOverride(search?: string): boolean {
	const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
	return new URLSearchParams(query).get('onboarding') === '1';
}
