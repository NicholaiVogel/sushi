export const APPEARANCE_STORAGE_KEY = 'sushi-appearance';

export type AppearanceMode = 'system' | 'light' | 'dark';

export function normalizeAppearanceMode(value: unknown): AppearanceMode {
	return value === 'light' || value === 'dark' ? value : 'system';
}

export function readStoredAppearanceMode(): AppearanceMode {
	if (typeof window === 'undefined') return 'system';

	try {
		return normalizeAppearanceMode(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
	} catch {
		return 'system';
	}
}
