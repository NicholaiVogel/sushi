import { describe, expect, test } from 'bun:test';
import { StrudelAdapter } from './adapter';

describe('StrudelAdapter evaluation queue', () => {
	test('serializes evaluations so callback errors stay with their request', async () => {
		const started: string[] = [];
		let releaseFirst: (() => void) | undefined;
		let onEvalError: ((error: unknown) => void) | undefined;
		const fakeModule = {
			initStrudel: async (options?: { onEvalError?: (error: unknown) => void }) => {
				onEvalError = options?.onEvalError;
				return {
					evaluate: async (code: string) => {
						started.push(code);
						if (code === 'first') {
							await new Promise<void>((resolve) => { releaseFirst = resolve; });
							onEvalError?.(new Error('first failed'));
							return {};
						}
						return {};
					},
					start: async () => undefined,
					stop: () => undefined,
					pause: () => undefined,
				};
			},
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			const first = adapter.evaluateSource('first', { restoreSource: 'fallback' });
			await new Promise((resolve) => setTimeout(resolve, 0));
			const second = adapter.evaluateSource('second');
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(started).toEqual(['first']);
			releaseFirst?.();
			expect(await first).toEqual({ ok: false, error: expect.any(Error) });
			expect(await second).toEqual({ ok: true });
			expect(started).toEqual(['first', 'fallback', 'second']);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});
});
