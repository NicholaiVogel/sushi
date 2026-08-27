import { describe, expect, test } from 'bun:test';
import { StrudelAdapter } from './adapter';

describe('StrudelAdapter evaluation queue', () => {
	test('serializes evaluations so callback errors stay with their request', async () => {
		const started: string[] = [];
		let releaseFirst: (() => void) | undefined;
		let onEvalError: ((error: unknown) => void) | undefined;
		const fakeModule = {
			initStrudel: async (options?: { onEvalError?: (error: unknown) => void; onToggle?: (started: boolean) => void }) => {
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
					scheduler: { now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 },
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

	test('validates a candidate and restores the accepted source and transport', async () => {
		const evaluated: string[] = [];
		const scheduler = { now: () => 0, setCycle: (_cycle: number) => undefined, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async (code: string) => {
					evaluated.push(code);
					return {};
				},
				start: async () => undefined,
				stop: () => undefined,
				pause: () => undefined,
				scheduler,
			}),
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			expect(await adapter.validateSource('candidate', 'accepted')).toEqual({ ok: true });
			expect(evaluated).toEqual(['accepted', 'candidate', 'accepted']);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('stages a playing evaluation until the next cycle boundary', async () => {
		let now = 0.5;
		let starts = 0;
		const evaluations: string[] = [];
		let onToggle: ((started: boolean) => void) | undefined;
		const scheduler = {
			now: () => now,
			cps: 10,
			stop: () => undefined,
			lastEnd: 0,
			lastBegin: 0,
		};
		const fakeModule = {
			initStrudel: async (options?: { onToggle?: (started: boolean) => void }) => {
				onToggle = options?.onToggle;
				return {
					evaluate: async (code: string) => {
						evaluations.push(code);
						if (code === 'next') now = 1;
						return {};
					},
					start: async () => { starts += 1; onToggle?.(true); },
					stop: () => onToggle?.(false),
					pause: () => onToggle?.(false),
					scheduler,
				};
			},
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			await adapter.evaluateSource('initial');
			await adapter.play(4);
			const pending = adapter.evaluateSource('next', { restoreSource: 'initial' });
			await new Promise((resolve) => setTimeout(resolve, 5));

			expect(evaluations).toEqual(['initial']);
			expect(await pending).toEqual({ ok: true });
			expect(evaluations).toEqual(['initial', 'next']);
			expect(starts).toBe(2);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('preloads sample assets before starting the scheduler', async () => {
		const calls: string[] = [];
		const scheduler = { cps: 0.5, now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const pattern = {
			queryArc: () => [{ value: { s: 'bd', n: 0 }, hasOnset: () => true }],
		};
		let beforeStart: (() => void | Promise<void>) | undefined;
		const fakeModule = {
			initStrudel: async (options?: { beforeStart?: () => void | Promise<void> }) => {
				beforeStart = options?.beforeStart;
				return {
					evaluate: async () => pattern,
					start: async () => {
						await beforeStart?.();
						calls.push('start');
					},
					stop: () => undefined,
					pause: () => undefined,
					scheduler,
				};
			},
			initAudio: async () => { calls.push('initAudio'); },
			getSound: () => ({ data: { type: 'sample', samples: ['https://example.test/bd.wav'] } }),
			getSampleBuffer: async () => { calls.push('preload'); return {}; },
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			expect(await adapter.play(4)).toEqual({ ok: true });
			expect(calls).toEqual(['initAudio', 'preload', 'start']);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('preloads static sounds from a pasted source without relying on a fragile pattern query', async () => {
		const calls: string[] = [];
		const scheduler = { cps: 0.5, now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const pattern = {
			queryArc: () => { throw new Error('stack query should not be needed for static source'); },
		};
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => pattern,
				start: async () => undefined,
				stop: () => undefined,
				pause: () => undefined,
				scheduler,
			}),
			initAudio: async () => undefined,
			getSound: (name: string) => name === 'bd' ? { data: { type: 'sample', samples: ['https://example.test/bd.wav'] } } : undefined,
			getSampleBuffer: async (value: { s: string }) => { calls.push(value.s); return {}; },
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('$: s("bd!4")')).toEqual({ ok: true });
			expect(await adapter.play(4)).toEqual({ ok: true });
			expect(calls).toEqual(['bd']);
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
