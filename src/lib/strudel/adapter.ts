import { DEFAULT_SONG_END_CYCLE, type AudioState, type TransportState } from '../project/model';

interface StrudelModule {
	initStrudel(options?: {
		onEvalError?: (error: unknown) => void;
		onToggle?: (started: boolean) => void;
		prebake?: () => void | Promise<void>;
		beforeStart?: () => void | Promise<void>;
	}): Promise<StrudelRepl>;
	initAudio?: (options?: Record<string, unknown>) => Promise<void>;
	hush?: () => void;
	aliasBank?: (path: string) => Promise<void>;
	samples?: (sampleMap: string, baseUrl?: string, options?: Record<string, unknown>) => Promise<void>;
	registerSound?: (name: string, trigger: (time: number, value: Record<string, any>, onended: () => void) => Promise<unknown>, data?: Record<string, unknown>) => void;
	getAudioContext?: () => AudioContext;
	getSound?: (name: string) => { data?: Record<string, any> } | undefined;
	getSoundIndex?: (value: unknown, size: number) => number;
	getSampleBuffer?: (value: Record<string, any>, bank: unknown, resolveUrl?: (url: string) => string | Promise<string>) => Promise<unknown>;
	getADSRValues?: (values: unknown[]) => number[];
	getParamADSR?: (...args: any[]) => void;
	getPitchEnvelope?: (...args: any[]) => void;
	getVibratoOscillator?: (...args: any[]) => { stop?: () => void; nodes?: Record<string, unknown> } | undefined;
	onceEnded?: (source: AudioNode, callback: () => void) => void;
	releaseAudioNode?: (source: AudioNode) => void;
}

type StrudelModuleLoader = () => Promise<StrudelModule>;

interface SoundfontDefinition {
	[name: string]: string[];
}

interface SoundfontRuntime {
	getFontBufferSource: (name: string, value: Record<string, any>, audioContext: AudioContext) => Promise<AudioBufferSourceNode>;
}

interface StrudelHap {
	value?: Record<string, any>;
	hasOnset?: () => boolean;
}

interface StrudelPattern {
	queryArc?: (begin: number, end: number, controls?: Record<string, unknown>) => StrudelHap[];
}

interface SourceAudioAsset {
	name: string;
	notes: Array<string | number>;
}

type PreloadValue = Record<string, any> & {
	n?: unknown;
	note?: string | number;
	freq?: string | number;
};

const MAX_PRELOAD_HAPS = 4096;

const soundCallPattern = /(?:^|[.\s])(?:s|sound)\s*\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
const directSoundPattern = /\(\s*(['"`])([\s\S]*?)\1\s*\)\s*\.note\s*\(/g;
const sourceNotePattern = /\b[A-Ga-g](?:#|b)?(?:-?\d+)\b/g;

function unescapeSourceLiteral(value: string): string {
	return value.replace(/\\([\\'"`])/g, '$1');
}

/**
 * Pull static sound and note names out of ordinary Strudel source. Dynamic
 * JavaScript expressions are left to the pattern-query fallback below.
 */
function collectSourceAudioAssets(source: string): SourceAudioAsset[] {
	const values: string[] = [];
	for (const match of source.matchAll(soundCallPattern)) values.push(unescapeSourceLiteral(match[2]));
	for (const match of source.matchAll(directSoundPattern)) values.push(unescapeSourceLiteral(match[2]));

	const notes = [...new Set(source.match(sourceNotePattern)?.map((note) => note.toLowerCase()) ?? [])];
	const assets = new Map<string, Set<string>>();
	for (const value of values) {
		for (const token of value.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? []) {
			const name = token.toLowerCase();
			if (!assets.has(name)) assets.set(name, new Set());
		}
	}

	return [...assets.entries()].map(([name, assetNotes]) => ({
		name,
		notes: [...(assetNotes.size ? assetNotes : notes)].slice(0, 64),
	}));
}

let soundfontRuntimePromise: Promise<SoundfontRuntime> | undefined;
let soundfontDefinitionsPromise: Promise<{ default: SoundfontDefinition }> | undefined;

function loadSoundfontRuntime(): Promise<SoundfontRuntime> {
	if (!soundfontRuntimePromise) soundfontRuntimePromise = import('@strudel/soundfonts') as Promise<SoundfontRuntime>;
	return soundfontRuntimePromise;
}

function loadSoundfontDefinitions(): Promise<{ default: SoundfontDefinition }> {
	if (!soundfontDefinitionsPromise) soundfontDefinitionsPromise = import('@strudel/soundfonts/gm.mjs') as Promise<{ default: SoundfontDefinition }>;
	return soundfontDefinitionsPromise;
}

/**
 * Register the GM soundfont callbacks against the exact @strudel/web module
 * instance that owns the REPL. Calling @strudel/soundfonts.registerSoundfonts
 * directly would register into its separately bundled webaudio sound map, so
 * the runtime would still report every GM sound as missing.
 */
async function registerSoundfontsOnModule(module: StrudelModule): Promise<void> {
	if (!module.registerSound || !module.getAudioContext || !module.getADSRValues || !module.getParamADSR || !module.getSoundIndex || !module.getPitchEnvelope || !module.onceEnded || !module.releaseAudioNode) {
		throw new Error('The Strudel runtime does not expose the soundfont registration hooks.');
	}

	const [soundfontRuntime, definitionsModule] = await Promise.all([
		loadSoundfontRuntime(),
		loadSoundfontDefinitions(),
	]);
	const definitions = definitionsModule.default;
	Object.entries(definitions).forEach(([name, fonts]) => {
		module.registerSound?.(name, async (time, value, onended) => {
			const [attack, decay, sustain, release] = module.getADSRValues?.([
				value.attack,
				value.decay,
				value.sustain,
				value.release,
			]) ?? [0.001, 0.05, 0.6, 0.01];
			const duration = typeof value.duration === 'number' ? value.duration : 0.2;
			const fontIndex = module.getSoundIndex?.(value.n, fonts.length) ?? 0;
			const font = fonts[fontIndex] ?? fonts[0];
			const context = module.getAudioContext?.();
			if (!context || !font) throw new Error(`Could not load soundfont ${name}`);

			const bufferSource = await soundfontRuntime.getFontBufferSource(font, value, context);
			bufferSource.start(time);
			const envGain = context.createGain();
			const node = bufferSource.connect(envGain) as GainNode;
			const holdEnd = time + duration;
			module.getParamADSR?.(node.gain, attack, decay, sustain, release, 0, 0.3, time, holdEnd, 'linear');
			const envEnd = holdEnd + release + 0.01;
			const vibratoHandle = module.getVibratoOscillator?.(bufferSource.detune, value, time);
			module.getPitchEnvelope?.(bufferSource.detune, value, time, holdEnd);
			bufferSource.stop(envEnd);
			module.onceEnded?.(bufferSource, () => {
				module.releaseAudioNode?.(bufferSource);
				vibratoHandle?.stop?.();
				onended();
			});
			return {
				node,
				stop: () => undefined,
				nodes: { source: [bufferSource], ...vibratoHandle?.nodes },
			};
		}, { type: 'soundfont', prebake: true, fonts });
	});
}

interface StrudelRepl {
	evaluate(code: string, autostart?: boolean): Promise<unknown>;
	start(): Promise<void>;
	stop(): void;
	pause(): void;
	scheduler: StrudelScheduler;
}

interface StrudelScheduler {
	now(): number;
	cps?: number;
	setCycle?: (cycle: number) => void;
	stop?: () => void;
	lastEnd?: number;
	lastBegin?: number;
}

export interface AdapterRuntimeUpdate {
	audioState?: AudioState;
	transport?: TransportState;
	currentCycle?: number;
}

export type AdapterResult =
	| { ok: true }
	| { ok: false; error: unknown };

/** Returned when playback was requested before the browser granted audio output. */
export class AudioLockedError extends Error {
	public readonly code = 'AUDIO_LOCKED';

	public constructor() {
		super('Audio is locked by the browser. Click Play in Sushi once to enable audio, then try again.');
		this.name = 'AudioLockedError';
	}
}

export function isAudioLockedError(error: unknown): error is AudioLockedError {
	return error instanceof AudioLockedError || (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'AUDIO_LOCKED');
}

function isAudioPolicyError(error: unknown): boolean {
	if (isAudioLockedError(error)) return true;
	if (typeof error !== 'object' || error === null) return false;
	const record = error as { name?: unknown; message?: unknown };
	const name = typeof record.name === 'string' ? record.name : '';
	const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';
	return name === 'NotAllowedError'
		|| name === 'SecurityError'
		|| message.includes('not allowed')
		|| message.includes('user gesture')
		|| message.includes('autoplay')
		|| message.includes('audio context');
}

/**
 * The only application layer that talks to Strudel.
 *
 * Importing @strudel/web at module evaluation time would execute its browser
 * setup during Astro's server build, so the package is intentionally loaded
 * inside init(). Evaluation requests are serialized because the REPL reports
 * errors through a shared callback. Failed candidates restore the last valid
 * source because the REPL hushes before evaluating a new source document.
 */
export class StrudelAdapter {
	private destroyed = false;
	private module: StrudelModule | undefined;
	private repl: StrudelRepl | undefined;
	private activePattern: StrudelPattern | undefined;
	private activeSource = '';
	private preloadPromise: Promise<void> | undefined;
	private initPromise: Promise<void> | undefined;
	private evaluationQueue: Promise<void> = Promise.resolve();
	private activeEvaluation: { error: unknown } | undefined;
	private cycleTimer: ReturnType<typeof setInterval> | undefined;
	private songEndCycle: number | undefined;
	private runtime: AdapterRuntimeUpdate = {
		audioState: 'initializing',
		transport: 'stopped',
		currentCycle: 0,
	};

	public constructor(
		private readonly onRuntimeUpdate?: (update: AdapterRuntimeUpdate) => void,
		private readonly loadModule: StrudelModuleLoader = async () => (await import('@strudel/web')) as unknown as StrudelModule,
	) {}

	public async init(): Promise<void> {
		if (this.destroyed) throw new Error('The Strudel runtime has been destroyed.');
		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = (async () => {
			if (this.destroyed) throw new Error('The Strudel runtime has been destroyed.');
			if (typeof window === 'undefined') {
				throw new Error('The Strudel audio runtime is only available in a browser.');
			}

			const module = await this.loadModule();
			if (this.destroyed) throw new Error('The Strudel runtime has been destroyed.');
			this.module = module;
			this.repl = await module.initStrudel({
				prebake: async () => {
					// @strudel/web only registers oscillator synths by default. Strudel.cc
					// adds its GM soundfonts and the two sample collections below before
					// evaluating user code, so ordinary Strudel snippets resolve the same
					// sounds in Sushi instead of silently dropping unsupported layers.
					await registerSoundfontsOnModule(module);
					await Promise.all([
						module.samples?.('github:tidalcycles/dirt-samples', undefined, { prebake: true }),
						module.samples?.(
							'https://strudel.b-cdn.net/tidal-drum-machines.json',
							'https://strudel.b-cdn.net/tidal-drum-machines/machines/',
							{ prebake: true, tag: 'drum-machines' },
						),
					]);
					await module.aliasBank?.('https://strudel.b-cdn.net/tidal-drum-machines-alias.json');
				},
				beforeStart: () => this.preloadActivePattern(),
				onEvalError: (error) => {
					if (this.activeEvaluation) this.activeEvaluation.error = error;
				},
				onToggle: (started) => {
					this.setRuntime({
						transport: started ? 'playing' : 'stopped',
						audioState: started ? 'ready' : this.runtime.audioState,
						currentCycle: started ? this.readCurrentCycle() : this.runtime.currentCycle,
					});
					if (started) {
						this.startCycleTimer();
					} else {
						this.stopCycleTimer();
					}
				},
			});
			if (this.destroyed) {
				try {
					this.repl.stop();
					this.module?.hush?.();
				} catch {
					// The owner may have gone away while Strudel was initializing.
				}
				throw new Error('The Strudel runtime has been destroyed.');
			}
			this.setRuntime({ audioState: 'locked', transport: 'stopped' });
		})();

		try {
			await this.initPromise;
		} catch (error) {
			const repl = this.repl;
			const module = this.module;
			this.repl = undefined;
			this.module = undefined;
			this.activePattern = undefined;
			this.activeSource = '';
			this.preloadPromise = undefined;
			this.activeEvaluation = undefined;
			this.stopCycleTimer();
			try {
				repl?.stop();
				module?.hush?.();
			} catch {
				// Initialization cleanup is best-effort; the error below remains the
				// source of truth for the caller.
			}
			this.initPromise = undefined;
			this.setRuntime({ audioState: 'error', transport: 'stopped', currentCycle: 0 });
			throw error;
		}
	}

	public async evaluateSource(
		source: string,
		options: { autoplay?: boolean; restoreSource?: string } = {},
	): Promise<AdapterResult> {
		return this.enqueueSerialized(async () => {
			try {
				return await this.evaluateSourceNow(source, options);
			} catch (error) {
				return { ok: false, error };
			}
		});
	}

	/**
	 * Check a candidate through the same Strudel evaluator without promoting it
	 * to project state. The accepted source is evaluated again afterwards so a
	 * validation request cannot leave a candidate pattern running.
	 */
	public async validateSource(source: string, restoreSource: string): Promise<AdapterResult> {
		return this.enqueueSerialized(async () => {
			try {
				return await this.validateSourceNow(source, restoreSource);
			} catch (error) {
				return { ok: false, error };
			}
		});
	}

	/**
	 * Serialize every operation that can touch the REPL, not only source
	 * evaluation. A transport request arriving while a candidate is evaluating
	 * must wait for that evaluation (and its restore path) to finish; otherwise
	 * the scheduler can start the old pattern or seek into a pattern that is
	 * about to be replaced.
	 */
	private enqueueSerialized<T>(operation: () => Promise<T>): Promise<T> {
		const queued = this.evaluationQueue.then(operation);
		this.evaluationQueue = queued.then(() => undefined, () => undefined);
		return queued;
	}

	private async evaluateSourceNow(
		source: string,
		options: { autoplay?: boolean; restoreSource?: string },
	): Promise<AdapterResult> {
		await this.init();
		if (this.destroyed) return { ok: false, error: this.destroyedError() };
		const repl = this.repl;
		if (!repl) return { ok: false, error: new Error('Strudel did not return a browser REPL.') };
		const wasPlaying = this.runtime.transport === 'playing';
		const wasPaused = this.runtime.transport === 'paused';
		const pausedCycle = this.runtime.currentCycle ?? 0;
		const boundaryCycle = wasPlaying ? await this.waitForNextCycleBoundary() : pausedCycle;
		if (this.destroyed) return { ok: false, error: this.destroyedError() };
		const result = await this.evaluateRaw(source, options.autoplay ?? false);
		if (this.destroyed) return { ok: false, error: this.destroyedError() };
		// The caller normally supplies the accepted source explicitly, but keeping
		// the adapter's last successful source as a fallback makes direct adapter
		// use transactional too. A failed evaluation while playing must never leave
		// the scheduler running an unknown or half-evaluated pattern.
		const restoreSource = options.restoreSource ?? this.activeSource;
		if (!result.ok && restoreSource && restoreSource !== source) {
			const restored = await this.evaluateRaw(restoreSource, false);
			if (!restored.ok) {
				this.stopAfterRestoreFailure();
				return {
					ok: false,
					error: new Error(`Strudel rejected the candidate and could not restore the accepted source: ${this.describeError(restored.error)}`),
				};
			}
		}
		if (!result.ok && (wasPlaying || wasPaused) && (!restoreSource || restoreSource === source)) {
			this.stopAfterRestoreFailure();
			return result;
		}
		if (this.destroyed) return { ok: false, error: this.destroyedError() };
		if (wasPlaying || wasPaused) {
			try {
				this.setSchedulerCycle(wasPlaying ? boundaryCycle : pausedCycle);
				if (wasPlaying) {
					await repl.start();
					this.startCycleTimer();
				} else {
					this.setRuntime({ transport: 'paused', currentCycle: pausedCycle });
				}
			} catch (error) {
				this.stopAfterRestoreFailure();
				return {
					ok: false,
					error: new Error(`Strudel restored the source but could not resume transport: ${this.describeError(error)}`),
				};
			}
		}
		return result;
	}

	private async validateSourceNow(source: string, restoreSource: string): Promise<AdapterResult> {
		await this.init();
		if (this.destroyed) return { ok: false, error: this.destroyedError() };
		const previousTransport = this.runtime.transport ?? 'stopped';
		const previousCycle = this.runtime.currentCycle ?? 0;
		const result = await this.evaluateRaw(source, false);
		if (this.destroyed) return { ok: false, error: this.destroyedError() };

		if (!result.ok && restoreSource === source) {
			this.stopAfterRestoreFailure();
			return result;
		}
		if (restoreSource !== source) {
			const restored = await this.evaluateRaw(restoreSource, false);
			if (!restored.ok) {
				this.stopAfterRestoreFailure();
				return {
					ok: false,
					error: new Error(`Strudel could not restore the accepted source after validation: ${this.describeError(restored.error)}`),
				};
			}
		}
		if (this.destroyed) return { ok: false, error: this.destroyedError() };
		try {
			await this.restoreTransport(previousTransport, previousCycle);
		} catch (error) {
			this.stopAfterRestoreFailure();
			return {
				ok: false,
				error: new Error(`Strudel restored the source but could not restore transport: ${this.describeError(error)}`),
			};
		}

		return result;
	}

	private async evaluateRaw(source: string, autoplay: boolean): Promise<AdapterResult> {
		const currentEvaluation = { error: undefined as unknown };
		this.activeEvaluation = currentEvaluation;
		try {
			if (!this.repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}

			const pattern = await this.repl.evaluate(source, autoplay);
			if (this.destroyed) return { ok: false, error: this.destroyedError() };
			if (currentEvaluation.error) {
				return { ok: false, error: currentEvaluation.error };
			}
			if (!pattern) {
				return { ok: false, error: new Error('Strudel did not produce a playable pattern.') };
			}

			this.activePattern = pattern as StrudelPattern;
			this.activeSource = source;
			this.preloadPromise = undefined;

			return { ok: true };
		} catch (error) {
			return { ok: false, error };
		} finally {
			if (this.activeEvaluation === currentEvaluation) this.activeEvaluation = undefined;
		}
	}

	private describeError(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	/**
	 * A failed restore is different from a rejected candidate: the accepted
	 * pattern is no longer guaranteed to be resident in the REPL. Stop and hush
	 * immediately so the UI cannot claim that an unknown pattern is still live.
	 */
	private stopAfterRestoreFailure(): void {
		this.stopCycleTimer();
		try {
			this.repl?.stop();
		} catch {
			// Keep cleanup best-effort; the runtime is already in a failed state.
		}
		try {
			this.setSchedulerCycle(0);
		} catch {
			// A scheduler without seeking support is still safely stopped below.
		}
		try {
			this.module?.hush?.();
		} catch {
			// Hushing is best-effort during a failed restore.
		}
		this.setRuntime({ transport: 'stopped', currentCycle: 0 });
	}

	private async restoreTransport(transport: TransportState, cycle: number): Promise<void> {
		const repl = this.repl;
		if (!repl || this.destroyed) return;

		try {
			this.setSchedulerCycle(cycle);
		} catch {
			// Validation still restores the source if this scheduler does not expose
			// a writable cursor. The next explicit seek can establish its position.
		}

		if (transport === 'playing') {
			await repl.start();
			if (this.destroyed) return;
			this.startCycleTimer();
		} else if (transport === 'paused') {
			if (this.destroyed) return;
			repl.pause();
			this.stopCycleTimer();
		} else {
			if (this.destroyed) return;
			repl.stop();
			this.module?.hush?.();
			this.stopCycleTimer();
		}

		this.setRuntime({ transport, currentCycle: cycle });
	}

	public async play(songEndCycle?: number): Promise<AdapterResult> {
		return this.enqueueSerialized(() => this.playNow(songEndCycle));
	}

	private async playNow(songEndCycle?: number): Promise<AdapterResult> {
		let startAttempted = false;
		try {
			await this.init();
			if (this.destroyed) throw this.destroyedError();
			const repl = this.repl;
			if (!repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}
			if (this.runtime.transport === 'playing') return { ok: true };

			// The package registers this on first mousedown, but calling it from the
			// Play click makes the user-gesture boundary explicit for this UI.
			await this.module?.initAudio?.();
			if (this.destroyed) throw this.destroyedError();
			await this.ensureAudioContextRunning();
			if (this.destroyed) throw this.destroyedError();
			// An omitted boundary means "resume the configured arrangement", not
			// "forget the boundary". This matters for callers that use the adapter
			// directly (the Studio always passes its current project boundary).
			if (songEndCycle !== undefined) {
				this.songEndCycle = Number.isFinite(songEndCycle) && songEndCycle > 0 ? songEndCycle : undefined;
			}
			if (this.songEndCycle !== undefined && this.readCurrentCycle() >= this.songEndCycle) {
				this.setSchedulerCycle(0);
				this.setRuntime({ currentCycle: 0 });
			}
			await this.preloadActivePattern();
			if (this.destroyed) throw this.destroyedError();
			startAttempted = true;
			await repl.start();
			if (this.destroyed) {
				try {
					repl.stop();
				} catch {
					// The owner may have gone away while playback was starting.
				}
				throw this.destroyedError();
			}
			this.setRuntime({ audioState: 'ready', transport: 'playing', currentCycle: this.readCurrentCycle() });
			this.startCycleTimer();
			return { ok: true };
		} catch (error) {
			const normalizedError = isAudioPolicyError(error) && !isAudioLockedError(error) ? new AudioLockedError() : error;
			if (startAttempted) this.stopAfterRestoreFailure();
			else this.stopCycleTimer();
			this.setRuntime({ audioState: isAudioLockedError(normalizedError) ? 'locked' : 'error', transport: 'stopped' });
			return { ok: false, error: normalizedError };
		}
	}

	private async ensureAudioContextRunning(): Promise<void> {
		const context = this.module?.getAudioContext?.();
		if (!context || context.state === 'running') return;

		try {
			// AudioContext.resume() can remain pending indefinitely when an agent
			// invokes playback outside a user gesture. Bound that wait so WebMCP
			// reports AUDIO_LOCKED instead of leaving the tool call hanging.
			await Promise.race([
				context.resume().catch(() => undefined),
				new Promise<void>((resolve) => setTimeout(resolve, 300)),
			]);
		} catch {
			// Browsers reject resume() when the call is outside a user gesture. The
			// state check below turns that policy decision into a useful result.
		}
		// `state` can change while `resume()` is settling; avoid relying on the
		// control-flow narrowing from the initial guard above.
		if ((context.state as AudioContextState) !== 'running') throw new AudioLockedError();
	}

	/** Update the finite transport boundary without restarting the REPL. */
	public setSongEndCycle(songEndCycle?: number): void {
		const nextEndCycle = Number.isFinite(songEndCycle) && songEndCycle !== undefined && songEndCycle > 0 ? songEndCycle : undefined;
		this.songEndCycle = nextEndCycle;
		if (nextEndCycle === undefined || this.runtime.transport === 'playing') return;

		const currentCycle = this.readCurrentCycle();
		if (currentCycle <= nextEndCycle) return;
		const transport = this.runtime.transport;
		try {
			this.setSchedulerCycle(nextEndCycle);
		} catch {
			// A scheduler without a writable cursor can still be stopped at the
			// boundary by the normal transport timer. Keep the visible state sane.
		}
		this.setRuntime({ transport, currentCycle: nextEndCycle });
	}

	/**
	 * Resolve the sounds used by the accepted pattern before starting the clock.
	 * Strudel registers sample and soundfont definitions during prebake, but the
	 * actual network fetch/decode is lazy. If the first event is scheduled while
	 * that work is still pending, Cyclist drops it as "too late". Preloading the
	 * first song span keeps the transport musical on a cold cache as well as a
	 * warm one.
	 */
	private async preloadActivePattern(): Promise<void> {
		if (this.preloadPromise) return this.preloadPromise;
		const pattern = this.activePattern;
		const module = this.module;
		const repl = this.repl;
		if (!module || !repl || !pattern?.queryArc) return;

		this.preloadPromise = (async () => {
			this.setRuntime({ audioState: 'initializing' });
			const endCycle = this.songEndCycle ?? DEFAULT_SONG_END_CYCLE;
			const cps = typeof repl.scheduler.cps === 'number' && Number.isFinite(repl.scheduler.cps) ? repl.scheduler.cps : 0.5;
			const audioContext = module.getAudioContext?.();
			let soundfontRuntime: SoundfontRuntime | undefined;
			const pending = new Map<string, Promise<unknown>>();
			const enqueueSound = async (soundName: string, data: Record<string, any> | undefined, notes: Array<string | number>, values: PreloadValue[] = []) => {
				if (!data || typeof data !== 'object') return;
				const variants: PreloadValue[] = values.length
					? values
					: (notes.length ? notes : ['c3']).map((note) => ({ note }));

				if (data.type === 'sample' && data.samples && module.getSampleBuffer) {
					// Array banks select a file with `n`; note-keyed banks select a
					// note. Keep the values found in the actual pattern so `.bank()`
					// and pattern-valued `n(...)` controls preload the same variant
					// that the scheduler will request.
					const sampleVariants = Array.isArray(data.samples)
						? (values.length ? variants : [{ note: notes[0] ?? 'c3', n: 0 }])
						: variants;
					for (const variant of sampleVariants) {
						const value = { ...variant, s: soundName, n: variant.n ?? 0, note: variant.note ?? 'c3' };
						const key = `sample:${soundName}:${String(value.n)}:${String(value.note)}`;
						if (!pending.has(key)) pending.set(key, module.getSampleBuffer(value, data.samples));
					}
					return;
				}

				if (data.type === 'soundfont' && Array.isArray(data.fonts) && data.fonts.length && audioContext) {
					for (const variant of variants) {
						const fontIndex = module.getSoundIndex?.(variant.n ?? 0, data.fonts.length) ?? 0;
						const font = data.fonts[fontIndex] ?? data.fonts[0];
						if (!font) continue;
						const noteKey = variant.freq ?? variant.note ?? 'c3';
						const key = `soundfont:${font}:${String(noteKey)}`;
						if (!pending.has(key)) {
							soundfontRuntime ??= await loadSoundfontRuntime();
							pending.set(
								key,
								soundfontRuntime.getFontBufferSource(font, { ...variant, s: soundName, n: variant.n ?? 0, note: variant.note ?? 'c3' }, audioContext).then((source) => {
									source.disconnect();
								}),
							);
						}
					}
				}
			};

			const sourceAssets = collectSourceAudioAssets(this.activeSource);
			for (const asset of sourceAssets) await enqueueSound(asset.name, module.getSound?.(asset.name)?.data, asset.notes);

			// Static extraction covers ordinary pasted source without querying a
			// potentially expensive pattern. Query as a second pass as well: it
			// discovers `.bank(...)`, dynamic `n(...)`/`note(...)`, and sounds whose
			// names only exist after Strudel's mini-notation expansion.
			if (pattern.queryArc) {
				try {
					// Keep the Pattern receiver intact. Strudel's queryArc implementation
					// reads `this.query`; detaching the method makes ordinary pasted
					// patterns fail their preload pass even though playback can still start.
					const queried = pattern.queryArc(0, endCycle, { _cps: cps });
					const haps = Array.isArray(queried) ? queried : [];
					let inspected = 0;
					for (const hap of haps) {
						if (inspected >= MAX_PRELOAD_HAPS) break;
						inspected += 1;
						if (hap.hasOnset?.() === false) continue;
						const value = hap.value;
						if (!value || typeof value.s !== 'string') continue;
						const bank = typeof value.bank === 'string' && value.bank.trim() ? value.bank.trim() : '';
						const soundName = bank && !value.s.toLowerCase().startsWith(`${bank.toLowerCase()}_`)
							? `${bank}_${value.s}`
							: value.s;
						await enqueueSound(soundName, module.getSound?.(soundName)?.data, [], [{ ...value, s: soundName }]);
					}
				} catch {
					// Static extraction remains a useful fallback for fake or dynamic
					// patterns whose query throws before playback begins.
				}
			}

			await Promise.all(pending.values());
			this.setRuntime({ audioState: 'locked' });
		})().catch((error) => {
			this.preloadPromise = undefined;
			throw error;
		});

		return this.preloadPromise;
	}

	public async pause(): Promise<AdapterResult> {
		return this.enqueueSerialized(() => this.pauseNow());
	}

	private async pauseNow(): Promise<AdapterResult> {
		let pauseAttempted = false;
		try {
			await this.init();
			if (this.destroyed) throw this.destroyedError();
			if (!this.repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}
			if (this.runtime.transport === 'stopped') return { ok: true };
			if (this.runtime.transport === 'paused') return { ok: true };

			const currentCycle = this.readCurrentCycle();
			pauseAttempted = true;
			this.repl.pause();
			this.stopCycleTimer();
			this.setRuntime({ transport: 'paused', currentCycle });
			return { ok: true };
		} catch (error) {
			if (pauseAttempted) this.stopAfterRestoreFailure();
			return { ok: false, error };
		}
	}

	public async stop(): Promise<AdapterResult> {
		return this.enqueueSerialized(() => this.stopNow());
	}

	private async stopNow(): Promise<AdapterResult> {
		let stopAttempted = false;
		try {
			await this.init();
			if (this.destroyed) throw this.destroyedError();
			if (!this.repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}
			stopAttempted = true;
			this.repl.stop();
			// `repl.stop()` resets Cyclist in the current Strudel build, but that is
			// not part of the public scheduler contract and lightweight hosts/fakes
			// may leave the cursor where it was. Reset explicitly so Stop always
			// satisfies Sushi's transport contract and the next Play starts at zero.
			try {
				this.setSchedulerCycle(0);
			} catch {
				// Some third-party schedulers are not seekable. They should still be
				// considered stopped; their own stop implementation remains the
				// fallback for resetting any internal cursor.
			}
			this.module?.hush?.();
			this.stopCycleTimer();
			this.setRuntime({ transport: 'stopped', currentCycle: 0 });
			return { ok: true };
		} catch (error) {
			if (stopAttempted) this.stopAfterRestoreFailure();
			return { ok: false, error };
		}
	}

	public async seek(cycle: number): Promise<AdapterResult> {
		return this.enqueueSerialized(() => this.seekNow(cycle));
	}

	private async seekNow(cycle: number): Promise<AdapterResult> {
		let transportTouched = false;
		try {
			await this.init();
			if (this.destroyed) throw this.destroyedError();
			if (!this.repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}

			const targetCycle = Number.isFinite(cycle)
				? Math.max(0, this.songEndCycle === undefined ? cycle : Math.min(this.songEndCycle, cycle))
				: 0;
			const wasPlaying = this.runtime.transport === 'playing';
			const wasPaused = this.runtime.transport === 'paused';
			if (wasPlaying) {
				transportTouched = true;
				this.repl.pause();
			}

			transportTouched = true;
			this.setSchedulerCycle(targetCycle);

			this.setRuntime({
				currentCycle: targetCycle,
				transport: wasPlaying || wasPaused ? 'paused' : 'stopped',
			});
			if (wasPlaying) {
				await this.repl.start();
				if (this.destroyed) throw this.destroyedError();
				this.startCycleTimer();
			}
			return { ok: true };
		} catch (error) {
			if (transportTouched) this.stopAfterRestoreFailure();
			return { ok: false, error };
		}
	}

	public destroy(): void {
		this.destroyed = true;
		this.stopCycleTimer();
		const repl = this.repl;
		const module = this.module;
		this.repl = undefined;
		this.module = undefined;
		this.activePattern = undefined;
		this.activeSource = '';
		this.preloadPromise = undefined;
		try {
			repl?.stop();
			module?.hush?.();
		} catch {
			// Destruction should never turn a route change or HMR update into an
			// uncaught browser error.
		}
	}

	private destroyedError(): Error {
		return new Error('The Strudel runtime has been destroyed.');
	}

	private readCurrentCycle(): number {
		// Cyclist intentionally reports zero while paused or stopped even though
		// its internal `lastEnd` cursor remains at the paused/boundary position.
		// Runtime state is the authoritative playhead outside active playback;
		// consulting scheduler.now() here would make Play after a pause or finite
		// song end jump back to the wrong cursor.
		if (this.runtime.transport !== 'playing') return this.runtime.currentCycle ?? 0;
		const cycle = this.repl?.scheduler?.now?.();
		return typeof cycle === 'number' && Number.isFinite(cycle) ? Math.max(0, cycle) : this.runtime.currentCycle ?? 0;
	}

	private async waitForNextCycleBoundary(): Promise<number> {
		const scheduler = this.repl?.scheduler;
		const currentCycle = this.readCurrentCycle();
		const nextCycle = Math.floor(currentCycle) + 1;
		const cps = scheduler?.cps;
		if (typeof cps === 'number' && Number.isFinite(cps) && cps > 0 && nextCycle > currentCycle) {
			await new Promise<void>((resolve) => setTimeout(resolve, ((nextCycle - currentCycle) / cps) * 1000));
		}
		return nextCycle;
	}

	private setSchedulerCycle(
		targetCycle: number,
		scheduler = this.repl?.scheduler,
	): void {
		if (!scheduler) {
			throw new Error('Strudel did not return a scheduler.');
		}
		if (typeof scheduler.setCycle === 'function') {
			scheduler.setCycle(targetCycle);
			return;
		}
		if (typeof scheduler.stop === 'function' && 'lastEnd' in scheduler) {
			// Cyclist (the default @strudel/web scheduler) keeps its current
			// cycle in lastEnd but does not expose setCycle publicly. Resetting
			// that scheduler cursor preserves Strudel's own event scheduling and
			// lets the next start begin at the requested cycle.
			scheduler.stop();
			scheduler.lastEnd = targetCycle;
			scheduler.lastBegin = targetCycle;
			return;
		}
		throw new Error('This Strudel scheduler does not support cycle seeking.');
	}

	private startCycleTimer(): void {
		this.stopCycleTimer();
		this.cycleTimer = setInterval(() => {
			const currentCycle = this.readCurrentCycle();
			if (this.songEndCycle !== undefined && currentCycle >= this.songEndCycle) {
				this.finishAtSongEnd();
				return;
			}
			this.setRuntime({ currentCycle });
		}, 50);
	}

	private stopCycleTimer(): void {
		if (this.cycleTimer !== undefined) {
			clearInterval(this.cycleTimer);
			this.cycleTimer = undefined;
		}
	}

	private finishAtSongEnd(): void {
		const songEndCycle = this.songEndCycle;
		this.stopCycleTimer();
		try {
			this.repl?.stop();
			if (songEndCycle !== undefined) {
				try {
					// Keep the scheduler cursor and the exposed runtime boundary in
					// agreement. Play can then deterministically rewind to zero on the
					// next request, even when a host scheduler's stop() leaves its cursor
					// untouched.
					this.setSchedulerCycle(songEndCycle);
				} catch {
					// The visible runtime still reports the finite boundary when a
					// third-party scheduler does not support seeking.
				}
			}
			this.module?.hush?.();
		} finally {
			this.setRuntime({ transport: 'stopped', currentCycle: songEndCycle ?? this.readCurrentCycle() });
		}
	}

	private setRuntime(update: AdapterRuntimeUpdate): void {
		if (this.destroyed) return;
		this.runtime = { ...this.runtime, ...update };
		this.onRuntimeUpdate?.(update);
	}
}
