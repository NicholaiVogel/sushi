import { describe, expect, test } from 'bun:test';
import { isAudioLockedError, StrudelAdapter } from './adapter';

describe('StrudelAdapter evaluation queue', () => {
	test('registers editor-only Strudel compatibility helpers', async () => {
		const registrations: string[] = [];
		let schedulerOptions: { setInterval?: unknown; clearInterval?: unknown; sync?: unknown } | undefined;
		const scheduler = { now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const fakeModule = {
			register: (name: string) => {
				registrations.push(name);
				return (...args: unknown[]) => args[1];
			},
			initStrudel: async (options?: { setInterval?: unknown; clearInterval?: unknown; sync?: unknown }) => {
				schedulerOptions = options;
				return {
					evaluate: async () => ({}),
					start: async () => undefined,
					stop: () => undefined,
					pause: () => undefined,
					scheduler,
				};
			},
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		const hadSlider = 'sliderWithID' in globalThis;
		const originalSlider = (globalThis as typeof globalThis & { sliderWithID?: unknown }).sliderWithID;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
		Reflect.deleteProperty(globalThis, 'sliderWithID');

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			await adapter.init();

			expect(registrations).toEqual(['sliderWithID', '_pianoroll', '_scope', '_spectrum']);
			expect(typeof (globalThis as typeof globalThis & { sliderWithID?: unknown }).sliderWithID).toBe('function');
			expect(typeof schedulerOptions?.setInterval).toBe('function');
			expect(typeof schedulerOptions?.clearInterval).toBe('function');
			expect(schedulerOptions?.setInterval).not.toBe(globalThis.setInterval);
			expect(schedulerOptions?.sync).toBe(false);
			adapter.destroy();
		} finally {
			if (hadSlider) {
				Object.defineProperty(globalThis, 'sliderWithID', { configurable: true, value: originalSlider });
			} else {
				Reflect.deleteProperty(globalThis, 'sliderWithID');
			}
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('keeps slider patterns live when their source value changes', async () => {
		const registered = new Map<string, (...args: unknown[]) => unknown>();
		const fakeModule = {
			ref: (accessor: () => unknown) => ({ read: accessor }),
			register: (name: string, func: (...args: unknown[]) => unknown) => {
				registered.set(name, func);
				return (...args: unknown[]) => func(...args);
			},
			initStrudel: async () => ({
				evaluate: async () => ({}),
				start: async () => undefined,
				stop: () => undefined,
				pause: () => undefined,
				scheduler: { now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 },
			}),
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		const hadSlider = 'sliderWithID' in globalThis;
		const originalSlider = (globalThis as typeof globalThis & { sliderWithID?: unknown }).sliderWithID;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
		Reflect.deleteProperty(globalThis, 'sliderWithID');

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			await adapter.init();
			const slider = (globalThis as typeof globalThis & { sliderWithID: (...args: unknown[]) => unknown }).sliderWithID;
			const first = slider({ __pure: 'slider_10' }, { __pure: 200 }, { __pure: 200 }, { __pure: 4000 }) as { read: () => unknown };
			const second = slider({ __pure: 'slider_10' }, { __pure: 2200 }, { __pure: 200 }, { __pure: 4000 }) as { read: () => unknown };

			expect(registered.has('sliderWithID')).toBe(true);
			expect(first.read()).toBe(2200);
			expect(second.read()).toBe(2200);
			adapter.destroy();
		} finally {
			if (hadSlider) {
				Object.defineProperty(globalThis, 'sliderWithID', { configurable: true, value: originalSlider });
			} else {
				Reflect.deleteProperty(globalThis, 'sliderWithID');
			}
			if (hadWindow) Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			else Reflect.deleteProperty(globalThis, 'window');
		}
	});

	test('keeps visualizer haps associated with their source lane', async () => {
		const visualizerRegistrations = new Map<string, (pattern: unknown) => unknown>();
		let schedulerHaps: unknown;
		const fakeHap = {
			whole: { begin: 0, end: 1 },
			value: { note: 'c4', color: '#ff4d00' },
			context: {},
			setContext(context: Record<string, unknown>) {
				return { ...fakeHap, context };
			},
		};
		const fakePattern = {
			withHaps(func: (haps: unknown[], state: { controls: Record<string, unknown> }) => unknown[]) {
				return {
					queryArc: (_begin: number, _end: number, controls: Record<string, unknown>) => {
						const haps = func([fakeHap], { controls: { ...controls, id: '$0' } });
						if (controls.cyclist || controls.neocyclist) schedulerHaps = haps;
						return haps;
					},
				};
			},
		};
		let visualizerPattern: unknown;
		const fakeModule = {
			Pattern: { prototype: {} },
			register: (name: string, func: (pattern: unknown) => unknown) => {
				if (name === '_pianoroll' || name === '_scope' || name === '_spectrum') visualizerRegistrations.set(name, func);
				return (...args: unknown[]) => args[1];
			},
			getAnalyzerData: (type: 'time' | 'frequency') => [type === 'frequency' ? -12 : 0],
			initStrudel: async () => ({
				evaluate: async () => visualizerPattern,
				start: async () => undefined,
				stop: () => undefined,
				pause: () => undefined,
				scheduler: { now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 },
			}),
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			await adapter.init();
			visualizerPattern = visualizerRegistrations.get('_pianoroll')?.(fakePattern);
			const source = '$: note("c4")._pianoroll()';
			expect(await adapter.evaluateSource(source)).toEqual({ ok: true });
			expect(adapter.getVisualizerHaps('trk_source_01', 'pianoroll', 0, 1)).toEqual([
					{ begin: 0, end: 1, value: { note: 'c4', color: '#ff4d00' } },
				]);
			const queryArc = (visualizerPattern as { queryArc?: (begin: number, end: number, controls: Record<string, unknown>) => unknown[] }).queryArc;
			queryArc?.(0, 1, { neocyclist: 'neocyclist' });
			expect(schedulerHaps).toEqual([fakeHap]);

			visualizerPattern = visualizerRegistrations.get('_spectrum')?.(fakePattern);
			expect(await adapter.evaluateSource(source.replace('_pianoroll', '_spectrum'))).toEqual({ ok: true });
			expect(adapter.getVisualizerHaps('trk_source_01', 'spectrum', 0, 1)).toEqual([
				{ begin: 0, end: 1, value: { note: 'c4', color: '#ff4d00' }, analyzerId: 1000 },
			]);
			expect(adapter.getVisualizerSpectrumData('trk_source_01')).toEqual([-12]);
			adapter.destroy();
		} finally {
			if (hadWindow) Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			else Reflect.deleteProperty(globalThis, 'window');
		}
	});

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

	test('waits to start playback until a queued evaluation has settled', async () => {
		let releaseCandidate: (() => void) | undefined;
		let starts = 0;
		const scheduler = { now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async (code: string) => {
					if (code === 'candidate') await new Promise<void>((resolve) => { releaseCandidate = resolve; });
					return {};
				},
				start: async () => { starts += 1; },
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
			expect(await adapter.evaluateSource('initial')).toEqual({ ok: true });
			const candidate = adapter.evaluateSource('candidate');
			const playback = adapter.play(4);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(starts).toBe(0);
			releaseCandidate?.();
			expect(await candidate).toEqual({ ok: true });
			expect(await playback).toEqual({ ok: true });
			expect(starts).toBe(1);
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

	test('evaluates a header-only source with runtime silence without changing source text', async () => {
		const evaluated: string[] = [];
		let onEvalError: ((error: unknown) => void) | undefined;
		const fakeModule = {
			initStrudel: async (options?: { onEvalError?: (error: unknown) => void }) => {
				onEvalError = options?.onEvalError;
				return {
					evaluate: async (code: string) => {
						evaluated.push(code);
						if (!code.endsWith('silence')) onEvalError?.(new Error('unexpected ast format without body expression'));
						return code.endsWith('silence') ? {} : undefined;
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
			const source = 'setcpm(150 / 4)\nconst key = "E:minor"\n';
			expect(await adapter.evaluateSource(source)).toEqual({ ok: true });
			expect(evaluated).toEqual([source, 'setcpm(150 / 4)\nconst key = "E:minor"\n\nsilence']);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('stops safely when a rejected candidate cannot restore the accepted source', async () => {
		let onEvalError: ((error: unknown) => void) | undefined;
		let acceptedEvaluations = 0;
		let stops = 0;
		let hushes = 0;
		const scheduler = { now: () => 0, setCycle: (_cycle: number) => undefined, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const fakeModule = {
			initStrudel: async (options?: { onEvalError?: (error: unknown) => void }) => {
				onEvalError = options?.onEvalError;
				return {
					evaluate: async (code: string) => {
						if (code === 'candidate') {
							onEvalError?.(new Error('candidate failed'));
						} else if (code === 'accepted') {
							acceptedEvaluations += 1;
							if (acceptedEvaluations > 1) onEvalError?.(new Error('restore failed'));
						}
						return {};
					},
					start: async () => undefined,
					stop: () => { stops += 1; },
					pause: () => undefined,
					scheduler,
				};
			},
			hush: () => { hushes += 1; },
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			const result = await adapter.evaluateSource('candidate', { restoreSource: 'accepted' });
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toEqual(expect.any(Error));
			expect(stops).toBeGreaterThan(0);
			expect(hushes).toBeGreaterThan(0);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('reports restore failure when validation cannot put the accepted source back', async () => {
		let onEvalError: ((error: unknown) => void) | undefined;
		let acceptedEvaluations = 0;
		let stops = 0;
		const scheduler = { now: () => 0, setCycle: (_cycle: number) => undefined, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const fakeModule = {
			initStrudel: async (options?: { onEvalError?: (error: unknown) => void }) => {
				onEvalError = options?.onEvalError;
				return {
					evaluate: async (code: string) => {
						if (code === 'accepted') {
							acceptedEvaluations += 1;
							if (acceptedEvaluations > 1) onEvalError?.(new Error('restore failed'));
						}
						return {};
					},
					start: async () => undefined,
					stop: () => { stops += 1; },
					pause: () => undefined,
					scheduler,
				};
			},
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			const result = await adapter.validateSource('candidate', 'accepted');
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toEqual(expect.any(Error));
			expect(stops).toBeGreaterThan(0);
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

	test('does not restart a destroyed runtime after a boundary wait', async () => {
		let starts = 0;
		const scheduler = { now: () => 0.5, cps: 10, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => ({}),
				start: async () => { starts += 1; },
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
			expect(await adapter.evaluateSource('initial')).toEqual({ ok: true });
			expect(await adapter.play(4)).toEqual({ ok: true });
			const pending = adapter.evaluateSource('next', { restoreSource: 'initial' });
			adapter.destroy();

			const result = await pending;
			expect(result.ok).toBe(false);
			expect(starts).toBe(1);
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

	test('keeps playback running when a browser cannot decode an audio asset', async () => {
		const calls: string[] = [];
		let starts = 0;
		let beforeStart: (() => void | Promise<void>) | undefined;
		const scheduler = { cps: 0.5, now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const pattern = {
			queryArc: () => [{ value: { s: 'bd', n: 0 }, hasOnset: () => true }],
		};
		const fakeModule = {
			initStrudel: async (options?: { beforeStart?: () => void | Promise<void> }) => {
				beforeStart = options?.beforeStart;
				return {
					evaluate: async () => pattern,
					start: async () => {
						await beforeStart?.();
						starts += 1;
					},
					stop: () => undefined,
					pause: () => undefined,
					scheduler,
				};
			},
			getSound: () => ({ data: { type: 'sample', samples: ['https://example.test/bd.wav'] } }),
			getSampleBuffer: async () => {
				calls.push('preload');
				throw new Error('decodeAudioData failed');
			},
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('$: s("bd")')).toEqual({ ok: true });
			expect(await adapter.play(4)).toEqual({ ok: true });
			expect(calls).toEqual(['preload']);
			expect(starts).toBe(1);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('does not turn optional sample-map failures into an evaluation failure', async () => {
		const calls: string[] = [];
		let starts = 0;
		let beforeStart: (() => void | Promise<void>) | undefined;
		const scheduler = { cps: 0.5, now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const pattern = { queryArc: () => [] };
		const fakeModule = {
			initStrudel: async (options?: { prebake?: () => void | Promise<void>; beforeStart?: () => void | Promise<void> }) => {
				await options?.prebake?.();
				beforeStart = options?.beforeStart;
				return {
					evaluate: async () => pattern,
					start: async () => {
						await beforeStart?.();
						starts += 1;
					},
					stop: () => undefined,
					pause: () => undefined,
					scheduler,
				};
			},
			samples: async (path: string) => {
				calls.push(path);
				throw new Error('sample map request blocked');
			},
			aliasBank: async () => {
				calls.push('aliases');
				throw new Error('alias map request blocked');
			},
			registerSound: () => undefined,
			getAudioContext: () => ({ state: 'running' }) as unknown as AudioContext,
			getADSRValues: () => [0, 0, 1, 0],
			getParamADSR: () => undefined,
			getSoundIndex: () => 0,
			getPitchEnvelope: () => undefined,
			onceEnded: () => undefined,
			releaseAudioNode: () => undefined,
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			expect(await adapter.play(4)).toEqual({ ok: true });
			expect(calls).toEqual([
			'github:tidalcycles/dirt-samples',
			'https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json',
			'https://strudel.b-cdn.net/tidal-drum-machines.json',
			'aliases',
		]);
			expect(starts).toBe(1);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('loads the piano sample bank before preloading a piano track', async () => {
		const pianoSampleMapUrl = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json';
		const sampleMaps: string[] = [];
		const preloadedSamples: string[] = [];
		let pianoRegistered = false;
		let beforeStart: (() => void | Promise<void>) | undefined;
		const scheduler = { cps: 0.5, now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const pattern = {
			queryArc: () => [{ value: { s: 'piano', note: 'c4' }, hasOnset: () => true }],
		};
		const fakeModule = {
			initStrudel: async (options?: { prebake?: () => void | Promise<void>; beforeStart?: () => void | Promise<void> }) => {
				await options?.prebake?.();
				beforeStart = options?.beforeStart;
				return {
					evaluate: async () => pattern,
					start: async () => { await beforeStart?.(); },
					stop: () => undefined,
					pause: () => undefined,
					scheduler,
				};
			},
			samples: async (path: string) => {
				sampleMaps.push(path);
				if (path === pianoSampleMapUrl) pianoRegistered = true;
			},
			getSound: (name: string) => pianoRegistered && name === 'piano'
				? { data: { type: 'sample', samples: { C4: ['https://example.test/C4.mp3'] } } }
				: undefined,
			getSampleBuffer: async (value: Record<string, any>) => {
				preloadedSamples.push(`${String(value.s)}:${String(value.note)}`);
				return {};
			},
			registerSound: () => undefined,
			getAudioContext: () => ({ state: 'running' }) as unknown as AudioContext,
			getADSRValues: () => [0, 0, 1, 0],
			getParamADSR: () => undefined,
			getSoundIndex: () => 0,
			getPitchEnvelope: () => undefined,
			onceEnded: () => undefined,
			releaseAudioNode: () => undefined,
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('$: note("c4").sound("piano")')).toEqual({ ok: true });
			expect(await adapter.play(4)).toEqual({ ok: true });
			expect(sampleMaps).toContain(pianoSampleMapUrl);
			expect(preloadedSamples).toEqual(['piano:c4']);
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
			getSampleBuffer: async (value: Record<string, any>) => { calls.push(String(value.s)); return {}; },
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

	test('preloads static sound aliases from a pasted source', async () => {
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
			getSampleBuffer: async (value: Record<string, any>) => { calls.push(String(value.s)); return {}; },
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('$: sound("bd!4")')).toEqual({ ok: true });
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

	test('does not report playback when the browser still has a suspended AudioContext', async () => {
		let starts = 0;
		const scheduler = { now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const audioContext = {
			state: 'suspended' as AudioContextState,
			resume: async () => undefined,
		} as unknown as AudioContext;
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => ({}),
				start: async () => { starts += 1; },
				stop: () => undefined,
				pause: () => undefined,
				scheduler,
			}),
			initAudio: async () => undefined,
			getAudioContext: () => audioContext,
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			const result = await adapter.play(4);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(isAudioLockedError(result.error)).toBe(true);
			expect(starts).toBe(0);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('maps browser audio-policy rejection to a retryable audio-lock error', async () => {
		let starts = 0;
		const scheduler = { now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => ({}),
				start: async () => { starts += 1; },
				stop: () => undefined,
				pause: () => undefined,
				scheduler,
			}),
			initAudio: async () => { throw Object.assign(new Error('play() failed because it was not allowed'), { name: 'NotAllowedError' }); },
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			const result = await adapter.play(4);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(isAudioLockedError(result.error)).toBe(true);
				expect((result.error as { code?: string }).code).toBe('AUDIO_LOCKED');
			}
			expect(starts).toBe(0);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('cleans a partially initialized module and retries initialization safely', async () => {
		let initAttempts = 0;
		let hushes = 0;
		let stops = 0;
		const scheduler = { now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const fakeModule = {
			initStrudel: async () => {
				initAttempts += 1;
				if (initAttempts === 1) throw new Error('prebake failed');
				return {
					evaluate: async () => ({}),
					start: async () => undefined,
					stop: () => { stops += 1; },
					pause: () => undefined,
					scheduler,
				};
			},
			hush: () => { hushes += 1; },
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			const first = await adapter.evaluateSource('first');
			expect(first.ok).toBe(false);
			expect(initAttempts).toBe(1);
			expect(hushes).toBe(1);
			expect(await adapter.evaluateSource('second')).toEqual({ ok: true });
			expect(initAttempts).toBe(2);
			adapter.destroy();
			expect(stops).toBeGreaterThan(0);
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('queries the evaluated pattern for banked and numeric-note sound variants', async () => {
		const calls: Array<{ sound: string; n: unknown; note: unknown }> = [];
		const scheduler = { cps: 0.5, now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		let beforeStart: (() => void | Promise<void>) | undefined;
		const fakeModule = {
			initStrudel: async (options?: { beforeStart?: () => void | Promise<void> }) => {
				beforeStart = options?.beforeStart;
				return {
					evaluate: async () => ({
						queryArc: () => [{ value: { s: 'bd', bank: 'tr808', n: 2, note: 60 }, hasOnset: () => true }],
					}),
					start: async () => { await beforeStart?.(); },
					stop: () => undefined,
					pause: () => undefined,
					scheduler,
				};
			},
			initAudio: async () => undefined,
			getSound: (name: string) => name === 'tr808_bd' ? { data: { type: 'sample', samples: { 60: ['https://example.test/tr808-bd.wav'] } } } : undefined,
			getSampleBuffer: async (value: Record<string, any>) => {
				calls.push({ sound: value.s, n: value.n, note: value.note });
				return {};
			},
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('$: s("unused")')).toEqual({ ok: true });
			expect(await adapter.play(4)).toEqual({ ok: true });
			expect(calls).toEqual([{ sound: 'tr808_bd', n: 2, note: 60 }]);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('keeps Strudel queryArc bound to the evaluated pattern', async () => {
		const calls: string[] = [];
		const scheduler = { cps: 0.5, now: () => 0, stop: () => undefined, lastEnd: 0, lastBegin: 0 };
		const pattern = {
			query: () => [{ value: { s: 'bd', n: 0 }, hasOnset: () => true }],
			queryArc(begin: number, end: number, controls: Record<string, unknown>) {
				void begin;
				void end;
				void controls;
				return this.query();
			},
		};
		let beforeStart: (() => void | Promise<void>) | undefined;
		const fakeModule = {
			initStrudel: async (options?: { beforeStart?: () => void | Promise<void> }) => {
				beforeStart = options?.beforeStart;
				return {
					evaluate: async () => pattern,
					start: async () => { await beforeStart?.(); },
					stop: () => undefined,
					pause: () => undefined,
					scheduler,
				};
			},
			initAudio: async () => undefined,
			getSound: (name: string) => name === 'bd' ? { data: { type: 'sample', samples: ['https://example.test/bd.wav'] } } : undefined,
			getSampleBuffer: async (value: Record<string, any>) => { calls.push(String(value.s)); return {}; },
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('$: s("unused")')).toEqual({ ok: true });
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

	test('clamps a paused or stopped playhead when the song boundary shrinks', async () => {
		let currentCycle = 0;
		const scheduler = {
			cps: 0.5,
			now: () => currentCycle,
			setCycle: (cycle: number) => { currentCycle = cycle; },
			stop: () => undefined,
			lastEnd: 0,
			lastBegin: 0,
		};
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => ({}),
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
			expect(await adapter.seek(8)).toEqual({ ok: true });
			adapter.setSongEndCycle(4);
			expect(currentCycle).toBe(4);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('resets the scheduler cursor when stopping', async () => {
		let currentCycle = 0;
		const setCycles: number[] = [];
		const scheduler = {
			now: () => currentCycle,
			setCycle: (cycle: number) => {
				setCycles.push(cycle);
				currentCycle = cycle;
			},
			stop: () => undefined,
			lastEnd: 0,
			lastBegin: 0,
		};
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => ({}),
				start: async () => undefined,
				// Deliberately leave the cursor untouched. The adapter must enforce
				// Stop's cycle-zero contract rather than relying on this implementation.
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
			expect(await adapter.seek(7)).toEqual({ ok: true });
			expect(currentCycle).toBe(7);
			expect(await adapter.stop()).toEqual({ ok: true });
			expect(currentCycle).toBe(0);
			expect(setCycles).toEqual([7, 0]);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('does not restart an active transport and restarts cleanly after the song ends', async () => {
		let currentCycle = 0;
		let starts = 0;
		const scheduler = {
			now: () => currentCycle,
			setCycle: (cycle: number) => { currentCycle = cycle; },
			stop: () => undefined,
			lastEnd: 0,
			lastBegin: 0,
		};
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => ({}),
				start: async () => { starts += 1; },
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
			expect(await adapter.play(4)).toEqual({ ok: true });
			expect(await adapter.play(4)).toEqual({ ok: true });
			expect(starts).toBe(1);

			currentCycle = 4;
			await new Promise((resolve) => setTimeout(resolve, 70));
			expect(await adapter.play(4)).toEqual({ ok: true });
			expect(starts).toBe(2);
			expect(currentCycle).toBe(0);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('does not treat a stale shared-worker cursor as an immediate song end', async () => {
		let schedulerCycle = 30;
		let pendingSchedulerCycle: number | undefined;
		let started = false;
		const updates: Array<{ transport?: string; currentCycle?: number }> = [];
		const scheduler = {
			cps: 1,
			now: () => started ? schedulerCycle : 0,
			setCycle: (cycle: number) => {
				pendingSchedulerCycle = cycle;
				setTimeout(() => {
					schedulerCycle = pendingSchedulerCycle ?? schedulerCycle;
				}, 80);
			},
			stop: () => { started = false; },
			lastEnd: 0,
			lastBegin: 0,
		};
		const fakeModule = {
			initStrudel: async (options?: { onToggle?: (started: boolean) => void }) => ({
				evaluate: async () => ({}),
				start: async () => { started = true; options?.onToggle?.(true); },
				stop: () => { started = false; options?.onToggle?.(false); },
				pause: () => { started = false; options?.onToggle?.(false); },
				scheduler,
			}),
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter((update) => updates.push(update), async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			expect(await adapter.play(30)).toEqual({ ok: true });
			await new Promise((resolve) => setTimeout(resolve, 140));
			expect(updates.some((update) => update.transport === 'playing' && update.currentCycle === 0)).toBe(true);
			expect(await adapter.stop()).toEqual({ ok: true });
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('rewinds a paused scheduler cursor after a finite stop before replaying', async () => {
		let currentCycle = 0;
		let started = false;
		let starts = 0;
		const scheduler = {
			now: () => started ? currentCycle : 0,
			setCycle: (cycle: number) => { currentCycle = cycle; },
			stop: () => { started = false; },
			lastEnd: 0,
			lastBegin: 0,
		};
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => ({}),
				start: async () => { starts += 1; started = true; },
				stop: () => { started = false; },
				pause: () => { started = false; },
				scheduler,
			}),
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			expect(await adapter.play(2)).toEqual({ ok: true });
			currentCycle = 2;
			await new Promise((resolve) => setTimeout(resolve, 70));

			// Cyclist.now() is zero after stop, but the adapter must retain the
			// visible finite boundary and rewind the scheduler explicitly.
			expect(currentCycle).toBe(2);
			expect(await adapter.play()).toEqual({ ok: true });
			expect(starts).toBe(2);
			expect(currentCycle).toBe(0);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('keeps the scheduler at the finite song boundary after automatic stop', async () => {
		let currentCycle = 0;
		const scheduler = {
			cps: 100,
			now: () => currentCycle,
			setCycle: (cycle: number) => { currentCycle = cycle; },
			// Deliberately leave the cursor untouched to model a scheduler whose
			// stop() only cancels events.
			stop: () => undefined,
		};
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => ({}),
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
			expect(await adapter.play(2)).toEqual({ ok: true });
			currentCycle = 2;
			await new Promise((resolve) => setTimeout(resolve, 70));
			expect(currentCycle).toBe(2);
			expect(await adapter.play(2)).toEqual({ ok: true });
			expect(currentCycle).toBe(0);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('restores the last accepted source when a direct evaluation fails during playback', async () => {
		const evaluated: string[] = [];
		let onEvalError: ((error: unknown) => void) | undefined;
		let currentCycle = 0.5;
		let starts = 0;
		const scheduler = {
			now: () => currentCycle,
			setCycle: (cycle: number) => { currentCycle = cycle; },
			stop: () => undefined,
			lastEnd: 0,
			lastBegin: 0,
		};
		const fakeModule = {
			initStrudel: async (options?: { onEvalError?: (error: unknown) => void }) => {
				onEvalError = options?.onEvalError;
				return {
					evaluate: async (code: string) => {
						evaluated.push(code);
						if (code === 'candidate') onEvalError?.(new Error('candidate failed'));
						return {};
					},
					start: async () => { starts += 1; },
					stop: () => undefined,
					pause: () => undefined,
					scheduler,
				};
			},
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter(undefined, async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			expect(await adapter.play(4)).toEqual({ ok: true });
			const result = await adapter.evaluateSource('candidate');

			expect(result.ok).toBe(false);
			expect(evaluated).toEqual(['accepted', 'candidate', 'accepted']);
			expect(starts).toBe(2);
			expect(currentCycle).toBe(1);
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('reports a failed transport restart and leaves the runtime stopped', async () => {
		let starts = 0;
		let stops = 0;
		let currentCycle = 0.5;
		const updates: Array<Record<string, unknown>> = [];
		const scheduler = {
			now: () => currentCycle,
			setCycle: (cycle: number) => { currentCycle = cycle; },
			stop: () => undefined,
			lastEnd: 0,
			lastBegin: 0,
		};
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => ({}),
				start: async () => {
					starts += 1;
					if (starts === 2) throw new Error('restart failed');
				},
				stop: () => { stops += 1; },
				pause: () => undefined,
				scheduler,
			}),
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter((update) => updates.push(update as Record<string, unknown>), async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			expect(await adapter.play(4)).toEqual({ ok: true });
			const result = await adapter.evaluateSource('replacement');

			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toEqual(expect.any(Error));
			expect(stops).toBeGreaterThan(0);
			expect(currentCycle).toBe(0);
			expect(updates.at(-1)).toMatchObject({ transport: 'stopped', currentCycle: 0 });
			adapter.destroy();
		} finally {
			if (hadWindow) {
				Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
			} else {
				Reflect.deleteProperty(globalThis, 'window');
			}
		}
	});

	test('cleans up when the Strudel stop call itself throws', async () => {
		let currentCycle = 0;
		let stopCalls = 0;
		const updates: Array<Record<string, unknown>> = [];
		const scheduler = {
			now: () => currentCycle,
			setCycle: (cycle: number) => { currentCycle = cycle; },
			stop: () => undefined,
			lastEnd: 0,
			lastBegin: 0,
		};
		const fakeModule = {
			initStrudel: async () => ({
				evaluate: async () => ({}),
				start: async () => undefined,
				stop: () => {
					stopCalls += 1;
					if (stopCalls === 1) throw new Error('stop failed');
				},
				pause: () => undefined,
				scheduler,
			}),
		};
		const hadWindow = 'window' in globalThis;
		const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
		Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

		try {
			const adapter = new StrudelAdapter((update) => updates.push(update as Record<string, unknown>), async () => fakeModule);
			expect(await adapter.evaluateSource('accepted')).toEqual({ ok: true });
			expect(await adapter.seek(3)).toEqual({ ok: true });
			const result = await adapter.stop();

			expect(result.ok).toBe(false);
			expect(currentCycle).toBe(0);
			expect(updates.at(-1)).toMatchObject({ transport: 'stopped', currentCycle: 0 });
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
