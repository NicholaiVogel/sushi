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
	notes: string[];
}

const soundCallPattern = /(?:^|[.\s])s\s*\(\s*(['"`])([\s\S]*?)\1\s*\)/g;
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
		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = (async () => {
			if (typeof window === 'undefined') {
				throw new Error('The Strudel audio runtime is only available in a browser.');
			}

			const module = await this.loadModule();
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
			this.setRuntime({ audioState: 'locked', transport: 'stopped' });
		})();

		try {
			await this.initPromise;
		} catch (error) {
			this.initPromise = undefined;
			this.setRuntime({ audioState: 'error' });
			throw error;
		}
	}

	public async evaluateSource(
		source: string,
		options: { autoplay?: boolean; restoreSource?: string } = {},
	): Promise<AdapterResult> {
		const evaluation = this.evaluationQueue.then(() => this.evaluateSourceNow(source, options));
		this.evaluationQueue = evaluation.then(() => undefined, () => undefined);
		return evaluation;
	}

	/**
	 * Check a candidate through the same Strudel evaluator without promoting it
	 * to project state. The accepted source is evaluated again afterwards so a
	 * validation request cannot leave a candidate pattern running.
	 */
	public async validateSource(source: string, restoreSource: string): Promise<AdapterResult> {
		const validation = this.evaluationQueue.then(() => this.validateSourceNow(source, restoreSource));
		this.evaluationQueue = validation.then(() => undefined, () => undefined);
		return validation;
	}

	private async evaluateSourceNow(
		source: string,
		options: { autoplay?: boolean; restoreSource?: string },
	): Promise<AdapterResult> {
		await this.init();
		const wasPlaying = this.runtime.transport === 'playing';
		const wasPaused = this.runtime.transport === 'paused';
		const pausedCycle = this.runtime.currentCycle ?? 0;
		const boundaryCycle = wasPlaying ? await this.waitForNextCycleBoundary() : pausedCycle;
		const result = await this.evaluateRaw(source, options.autoplay ?? false);
		if (!result.ok && options.restoreSource && options.restoreSource !== source) {
			await this.evaluateRaw(options.restoreSource, false);
		}
		if (wasPlaying || wasPaused) {
			this.setSchedulerCycle(wasPlaying ? boundaryCycle : pausedCycle);
			if (wasPlaying) {
				await this.repl?.start();
				this.startCycleTimer();
			} else {
				this.setRuntime({ transport: 'paused', currentCycle: pausedCycle });
			}
		}
		return result;
	}

	private async validateSourceNow(source: string, restoreSource: string): Promise<AdapterResult> {
		await this.init();
		const previousTransport = this.runtime.transport ?? 'stopped';
		const previousCycle = this.runtime.currentCycle ?? 0;
		const result = await this.evaluateRaw(source, false);

		if (restoreSource !== source) await this.evaluateRaw(restoreSource, false);
		await this.restoreTransport(previousTransport, previousCycle);

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

	private async restoreTransport(transport: TransportState, cycle: number): Promise<void> {
		if (!this.repl) return;

		try {
			this.setSchedulerCycle(cycle);
		} catch {
			// Validation still restores the source if this scheduler does not expose
			// a writable cursor. The next explicit seek can establish its position.
		}

		if (transport === 'playing') {
			await this.repl.start();
			this.startCycleTimer();
		} else if (transport === 'paused') {
			this.repl.pause();
			this.stopCycleTimer();
		} else {
			this.repl.stop();
			this.module?.hush?.();
			this.stopCycleTimer();
		}

		this.setRuntime({ transport, currentCycle: cycle });
	}

	public async play(songEndCycle?: number): Promise<AdapterResult> {
		try {
			await this.init();
			if (!this.repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}

			// The package registers this on first mousedown, but calling it from the
			// Play click makes the user-gesture boundary explicit for this UI.
			await this.module?.initAudio?.();
			this.songEndCycle = Number.isFinite(songEndCycle) && songEndCycle !== undefined && songEndCycle > 0 ? songEndCycle : undefined;
			await this.preloadActivePattern();
			await this.repl.start();
			this.startCycleTimer();
			return { ok: true };
		} catch (error) {
			this.setRuntime({ audioState: 'error', transport: 'stopped' });
			return { ok: false, error };
		}
	}

	/** Update the finite transport boundary without restarting the REPL. */
	public setSongEndCycle(songEndCycle?: number): void {
		this.songEndCycle = Number.isFinite(songEndCycle) && songEndCycle !== undefined && songEndCycle > 0 ? songEndCycle : undefined;
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
		const queryArc = pattern?.queryArc;
		if (!module || !repl) return;

		this.preloadPromise = (async () => {
			this.setRuntime({ audioState: 'initializing' });
			const endCycle = this.songEndCycle ?? DEFAULT_SONG_END_CYCLE;
			const cps = typeof repl.scheduler.cps === 'number' && Number.isFinite(repl.scheduler.cps) ? repl.scheduler.cps : 0.5;
			const audioContext = module.getAudioContext?.();
			let soundfontRuntime: SoundfontRuntime | undefined;
			const pending = new Map<string, Promise<unknown>>();
			const enqueueSound = async (soundName: string, data: Record<string, any> | undefined, notes: string[]) => {
				if (!data || typeof data !== 'object') return;

				if (data.type === 'sample' && data.samples && module.getSampleBuffer) {
					// Array banks (including the tidal drum machines) do not use the
					// note to select a file, so one request is enough. Note-keyed banks
					// need each note that appears in the pasted source.
					const sampleNotes = Array.isArray(data.samples) ? [notes[0] ?? 'c3'] : notes.length ? notes : ['c3'];
					for (const note of sampleNotes) {
						const value = { s: soundName, n: 0, note };
						const key = `sample:${soundName}:${note}`;
						if (!pending.has(key)) pending.set(key, module.getSampleBuffer(value, data.samples));
					}
					return;
				}

				if (data.type === 'soundfont' && Array.isArray(data.fonts) && data.fonts.length && audioContext) {
					const fontIndex = module.getSoundIndex?.(0, data.fonts.length) ?? 0;
					const font = data.fonts[fontIndex] ?? data.fonts[0];
					if (!font) return;
					for (const note of notes.length ? notes : ['c3']) {
						const key = `soundfont:${font}:${String(note)}`;
						if (!pending.has(key)) {
							soundfontRuntime ??= await loadSoundfontRuntime();
							pending.set(
								key,
								soundfontRuntime.getFontBufferSource(font, { s: soundName, n: 0, note }, audioContext).then((source) => {
									source.disconnect();
								}),
							);
						}
					}
				}
			};

			const sourceAssets = collectSourceAudioAssets(this.activeSource);
			if (sourceAssets.length) {
				for (const asset of sourceAssets) await enqueueSound(asset.name, module.getSound?.(asset.name)?.data, asset.notes);
			} else if (queryArc) {
				const haps = queryArc(0, endCycle, { _cps: cps }).filter((hap) => hap.hasOnset?.() !== false);
				for (const hap of haps) {
					const value = hap.value;
					if (!value || typeof value.s !== 'string') continue;
					await enqueueSound(value.s, module.getSound?.(value.s)?.data, [String(value.note ?? value.freq ?? 'c3')]);
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
		try {
			await this.init();
			if (!this.repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}

			const currentCycle = this.readCurrentCycle();
			this.repl.pause();
			this.stopCycleTimer();
			this.setRuntime({ transport: 'paused', currentCycle });
			return { ok: true };
		} catch (error) {
			return { ok: false, error };
		}
	}

	public async stop(): Promise<AdapterResult> {
		try {
			await this.init();
			if (!this.repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}
			this.repl.stop();
			this.module?.hush?.();
			this.stopCycleTimer();
			this.setRuntime({ transport: 'stopped', currentCycle: 0 });
			return { ok: true };
		} catch (error) {
			return { ok: false, error };
		}
	}

	public async seek(cycle: number): Promise<AdapterResult> {
		try {
			await this.init();
			if (!this.repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}

			const targetCycle = Number.isFinite(cycle) ? Math.max(0, cycle) : 0;
			const wasPlaying = this.runtime.transport === 'playing';
			const wasPaused = this.runtime.transport === 'paused';
			if (wasPlaying) this.repl.pause();

			this.setSchedulerCycle(targetCycle);

			this.setRuntime({
				currentCycle: targetCycle,
				transport: wasPlaying || wasPaused ? 'paused' : 'stopped',
			});
			if (wasPlaying) {
				await this.repl.start();
				this.startCycleTimer();
			}
			return { ok: true };
		} catch (error) {
			return { ok: false, error };
		}
	}

	private setSchedulerCycle(targetCycle: number): void {
		if (!this.repl) throw new Error('Strudel did not return a browser REPL.');
		const scheduler = this.repl.scheduler;
		if (typeof scheduler.setCycle === 'function') {
			scheduler.setCycle(targetCycle);
		} else if (typeof scheduler.stop === 'function' && 'lastEnd' in scheduler) {
			// Cyclist (the default @strudel/web scheduler) keeps its current
			// cycle in lastEnd but does not expose setCycle publicly. Resetting
			// that scheduler cursor preserves Strudel's own event scheduling and
			// lets the next start begin at the requested cycle.
			scheduler.stop();
			scheduler.lastEnd = targetCycle;
			scheduler.lastBegin = targetCycle;
		} else {
			throw new Error('This Strudel scheduler does not support cycle seeking.');
		}
	}

	public destroy(): void {
		this.stopCycleTimer();
		try {
			this.repl?.stop();
			this.module?.hush?.();
		} catch {
			// Destruction should never turn a route change or HMR update into an
			// uncaught browser error.
		}
	}

	private readCurrentCycle(): number {
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
			this.module?.hush?.();
		} finally {
			this.setRuntime({ transport: 'stopped', currentCycle: songEndCycle ?? this.readCurrentCycle() });
		}
	}

	private setRuntime(update: AdapterRuntimeUpdate): void {
		this.runtime = { ...this.runtime, ...update };
		this.onRuntimeUpdate?.(update);
	}
}
