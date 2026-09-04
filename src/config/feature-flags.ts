export function parseBooleanFeatureFlag(value: unknown): boolean {
	return value === 'true';
}

export function createIfEnabled<T>(enabled: boolean, create: () => T): T | null {
	return enabled ? create() : null;
}

export function registerIfEnabled(enabled: boolean, register: () => () => void): (() => void) | undefined {
	return enabled ? register() : undefined;
}

export const featureFlags = {
	experimentalMidi: parseBooleanFeatureFlag(import.meta.env.VITE_EXPERIMENTAL_MIDI),
} as const;
