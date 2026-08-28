import { DEFAULT_SONG_END_CYCLE, type AudioState, type TransportState } from '../project/model';
import { getSourceBlockDetails, type TrackVisualizer } from '../project/source-mapper';
import soundfontDefinitions from '@strudel/soundfonts/gm.mjs';
import { clearInterval as clearSchedulerInterval, setInterval as setSchedulerInterval } from 'worker-timers';

interface StrudelModule {
	initStrudel(options?: {
		onEvalError?: (error: unknown) => void;
		onToggle?: (started: boolean) => void;
		afterEval?: (update: StrudelEvaluationUpdate) => void;
		prebake?: () => void | Promise<void>;
		beforeStart?: () => void | Promise<void>;
		sync?: boolean;
		setInterval?: (...args: any[]) => any;
		clearInterval?: (...args: any[]) => void;
	}): Promise<StrudelRepl>;
	register?: (name: string, func: (...args: any[]) => unknown, patternify?: boolean) => unknown;
	ref?: (accessor: () => unknown) => unknown;
	Pattern?: { prototype: Record<string, unknown> };
	initAudio?: (options?: Record<string, unknown>) => Promise<void>;
	hush?: () => void;
	aliasBank?: (path: string) => Promise<void>;
	samples?: (sampleMap: string, baseUrl?: string, options?: Record<string, unknown>) => Promise<void>;
	registerSound?: (name: string, trigger: (time: number, value: Record<string, any>, onended: () => void) => Promise<unknown>, data?: Record<string, unknown>) => void;
	getAnalyserById?: (id: number, fftSize?: number, smoothingTimeConstant?: number) => unknown;
	getAnalyzerData?: (...args: any[]) => ArrayLike<number>;
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

export interface StrudelHap {
	value?: Record<string, any>;
	hasOnset?: () => boolean;
	whole?: { begin?: unknown; end?: unknown };
	endClipped?: unknown;
	duration?: unknown;
	context?: Record<string, any>;
	setContext?: (context: Record<string, any>) => StrudelHap;
}

export interface StrudelPattern {
	queryArc?: (begin: number, end: number, controls?: Record<string, unknown>) => StrudelHap[];
	withHaps?: (func: (haps: StrudelHap[], state: { controls?: Record<string, unknown> }) => StrudelHap[]) => StrudelPattern;
	analyze?: (id?: number) => StrudelPattern;
}

export interface StrudelEvaluationMeta {
	miniLocations?: Array<[number, number]>;
	widgets?: Array<Record<string, any>>;
}

export interface StrudelEvaluationUpdate {
	code: string;
	pattern: StrudelPattern;
	meta?: StrudelEvaluationMeta;
	range?: [number, number];
	widgetRemoved?: boolean;
}

export type StrudelVisualizer = TrackVisualizer;

export interface VisualizerHap {
	begin: number;
	end: number;
	value: Record<string, unknown>;
	analyzerId?: number;
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
const MAX_PRELOAD_VARIANTS = 24;
const AUDIO_ASSET_TIMEOUT_MS = 8_000;
const PIANO_SAMPLE_MAP_URL = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json';
// NeoCyclist applies setCycle() through a SharedWorker. The worker can deliver
// the first tick after the UI's 50ms runtime timer, so its local cursor may
// briefly report the previous finite boundary when a new transport starts.
// Keep the requested start cycle authoritative until the worker acknowledges a
// nearby cursor, avoiding an immediate false song-end stop.
const SCHEDULER_START_GRACE_MS = 250;
const SCHEDULER_START_TOLERANCE_CYCLES = 1;
// Warming an entire arrangement before the first scheduler tick makes a large
// pasted song feel frozen (and can make Cyclist miss its first deadlines). The
// first couple of cycles cover the assets needed to get playback started; later
// events can continue loading through Strudel's normal lazy path.
const PRELOAD_LOOKAHEAD_CYCLES = 2;

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
		notes: [...(assetNotes.size ? assetNotes : notes)].slice(0, MAX_PRELOAD_VARIANTS),
	}));
}

function isHeaderOnlyAstError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('unexpected ast format without body expression');
}

function appendRuntimeSilence(source: string): string {
	const trimmed = source.trimEnd();
	return `${trimmed}${trimmed ? '\n\n' : ''}silence`;
}

/**
 * The Strudel transpiler rewrites `slider(...)` to `sliderWithID(...)`. Sushi
 * renders the corresponding controls in each source lane, but the evaluated
 * pattern still needs a ref-backed helper so slider values can be read without
 * rebuilding the pattern graph on every change.
 */
let activeSliderValues: Map<string, number> | undefined;
let sliderMessageListenerInstalled = false;
const visualizerWrapperMarker = Symbol('sushiVisualizerWrapper');
const registeredVisualizerNames = new WeakMap<object, Set<string>>();

function unpureSliderValue(value: unknown): unknown {
	if (value && typeof value === 'object' && '__pure' in value) {
		return (value as { __pure?: unknown }).__pure;
	}
	return value;
}

function registerSushiCompatibility(module: StrudelModule, sliderValues: Map<string, number>): void {
	activeSliderValues = sliderValues;
	const globalScope = globalThis as typeof globalThis & { sliderWithID?: unknown };
	if (typeof globalScope.sliderWithID !== 'function') {
		const sliderWithID = (id: unknown, value: unknown) => {
			const key = String(unpureSliderValue(id));
			const initialValue = unpureSliderValue(value);
			const initial = Number(initialValue);
			if (Number.isFinite(initial)) activeSliderValues?.set(key, initial);
			const accessor = () => activeSliderValues?.get(key) ?? initialValue;
			return module.ref?.(accessor) ?? accessor();
		};
		const registered = module.register?.('sliderWithID', sliderWithID, false);
		// `register` adds functions to Strudel's private scope. The web bundle
		// copies that scope to `globalThis` during its built-in prebake, so
		// registrations made by an embedding app must expose the returned wrapper
		// themselves.
		globalScope.sliderWithID = typeof registered === 'function' ? registered : sliderWithID;
	}

	if (!sliderMessageListenerInstalled && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
		window.addEventListener('message', (event) => {
			const data = event.data as { type?: unknown; id?: unknown; value?: unknown } | null;
			if (data?.type !== 'cm-slider') return;
			const key = String(data.id);
			const value = Number(data.value);
			if (Number.isFinite(value) && activeSliderValues?.has(key)) activeSliderValues.set(key, value);
		});
		sliderMessageListenerInstalled = true;
	}

	const tagVisualizerPattern = (pattern: unknown, visualizer: StrudelVisualizer, analyzerId?: number): unknown => {
		const candidate = pattern as StrudelPattern;
		if (typeof candidate.withHaps !== 'function') return pattern;
		const analyze = candidate.analyze;
		const analyzed = (visualizer === 'scope' || visualizer === 'spectrum') && analyzerId !== undefined && typeof analyze === 'function'
			? analyze.call(candidate, analyzerId)
			: candidate;
		if (typeof analyzed.withHaps !== 'function') return analyzed;
		return analyzed.withHaps((haps, state) => {
			// Scheduler queries are the audio-critical path. The lane identity is
			// only needed by Sushi's visualizer query, so leave those haps untouched
			// when Cyclist/NeoCyclist asks for events to play. This avoids cloning and
			// re-contextualizing every event on every scheduler tick.
			if (state.controls?.cyclist || state.controls?.neocyclist) return haps;
			return haps.map((hap) => hap.setContext?.({
				...(hap.context ?? {}),
				sushiVisualizer: visualizer,
				sushiPatternId: typeof state.controls?.id === 'string' ? state.controls.id : undefined,
				...(analyzerId === undefined ? {} : { sushiAnalyzerId: analyzerId }),
			}) ?? hap);
		});
	};

	// These drawing hooks are supplied by strudel.cc's editor package when it
	// is loaded. Wrap those methods instead of replacing them, so the official
	// inline widgets keep their behavior while the Sushi timeline can continue
	// to query the same tagged events. Older/fake runtimes without the methods
	// use the registration fallback below.
	let nextAnalyzerId = 1000;
	const registerVisualizer = (name: string, visualizer: StrudelVisualizer) => {
		const prototype = module.Pattern?.prototype;
		const existing = prototype?.[name];
		if (typeof existing === 'function') {
			if ((existing as { [visualizerWrapperMarker]?: boolean })[visualizerWrapperMarker]) return;
			const wrapped = function (this: unknown, ...args: unknown[]) {
				const result = existing.apply(this, args);
				const analyzerId = visualizer === 'scope' || visualizer === 'spectrum' ? nextAnalyzerId++ : undefined;
				return tagVisualizerPattern(result, visualizer, analyzerId);
			};
			Object.defineProperty(wrapped, visualizerWrapperMarker, { value: true });
			if (prototype) prototype[name] = wrapped;
			return;
		}

		const moduleObject = module as object;
		const registered = registeredVisualizerNames.get(moduleObject) ?? new Set<string>();
		if (registered.has(name)) return;
		registered.add(name);
		registeredVisualizerNames.set(moduleObject, registered);
		module.register?.(name, (pattern: unknown) => {
			const analyzerId = visualizer === 'scope' || visualizer === 'spectrum' ? nextAnalyzerId++ : undefined;
			return tagVisualizerPattern(pattern, visualizer, analyzerId);
		});
	};
	registerVisualizer('_pianoroll', 'pianoroll');
	registerVisualizer('_scope', 'scope');
	registerVisualizer('_spectrum', 'spectrum');
}

function numericTime(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (value && typeof (value as { valueOf?: () => unknown }).valueOf === 'function') {
		const numeric = Number((value as { valueOf: () => unknown }).valueOf());
		return Number.isFinite(numeric) ? numeric : undefined;
	}
	return undefined;
}

/**
 * Mirror the anonymous pattern id allocation in @strudel/core/repl. Every
 * dollar-suffixed source lane consumes an index, even when that lane does not
 * request a visualizer.
 */
function visualizerPatternIds(source: string): Map<string, string> {
	const ids = new Map<string, string>();
	let anonymousIndex = 0;
	for (const block of getSourceBlockDetails(source)) {
		const label = block.label;
		if (!label) continue;
		if (label.includes('$')) {
			ids.set(block.id, `${label}${anonymousIndex}`);
			anonymousIndex += 1;
		} else {
			ids.set(block.id, label);
		}
	}
	return ids;
}

let soundfontRuntimePromise: Promise<SoundfontRuntime> | undefined;

function loadSoundfontRuntime(): Promise<SoundfontRuntime> {
	if (!soundfontRuntimePromise) soundfontRuntimePromise = import('@strudel/soundfonts') as Promise<SoundfontRuntime>;
	return soundfontRuntimePromise;
}

function reportAudioAssetIssue(label: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	console.warn(`[sushi] ${label} could not be prepared; playback will continue without it. ${message}`);
}

/**
 * Audio assets are an optional runtime dependency. A failed fetch/decode must
 * not reject the scheduler's start, and a decoder that never calls either
 * callback must not leave the transport stuck in PREPARING forever (Firefox's
 * decodeAudioData implementation has historically exposed both behaviors for
 * unsupported data).
 */
function settleAudioAsset(start: () => Promise<unknown> | unknown, label: string): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve();
		};
		const timeout = setTimeout(() => {
			reportAudioAssetIssue(label, new Error(`timed out after ${AUDIO_ASSET_TIMEOUT_MS}ms`));
			finish();
		}, AUDIO_ASSET_TIMEOUT_MS);

		let task: Promise<unknown>;
		try {
			task = Promise.resolve(start());
		} catch (error) {
			reportAudioAssetIssue(label, error);
			finish();
			return;
		}
		task.then(finish, (error) => {
			reportAudioAssetIssue(label, error);
			finish();
		});
	});
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

	// Keep the instrument table local and deterministic. The soundfont runtime
	// itself is loaded lazily from the trigger/preload path because it brings in
	// browser-only Web Audio helpers and should not be able to break source boot.
	const definitions = soundfontDefinitions as SoundfontDefinition;
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

			const soundfontRuntime = await loadSoundfontRuntime();
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
 * setup during Astro's server build, so the browser's unbundled web entry is
 * intentionally loaded inside init(). That entry shares @strudel/core and
 * @strudel/transpiler with the CodeMirror package, which keeps widget methods
 * and registrations on the same runtime. Evaluation requests are serialized
 * because the REPL reports errors through a shared callback. Failed candidates
 * restore the last valid source because the REPL hushes before evaluating a new
 * source document.
 */
export class StrudelAdapter {
	private destroyed = false;
	private module: StrudelModule | undefined;
	private repl: StrudelRepl | undefined;
	private activePattern: StrudelPattern | undefined;
	private activeSource = '';
	private sliderValues = new Map<string, number>();
	private visualizerPatternIds = new Map<string, string>();
	private visualizerAnalyzerIds = new Map<string, number>();
	private preloadPromise: Promise<void> | undefined;
	private audioInitPromise: Promise<void> | undefined;
	private sampleBankPromise: Promise<void> | undefined;
	private initPromise: Promise<void> | undefined;
	private evaluationQueue: Promise<void> = Promise.resolve();
	private activeEvaluation: { error: unknown } | undefined;
	private cycleTimer: ReturnType<typeof setInterval> | undefined;
	private songEndCycle: number | undefined;
	private pendingSchedulerStart: { cycle: number; expiresAt: number } | undefined;
	private runtime: AdapterRuntimeUpdate = {
		audioState: 'initializing',
		transport: 'stopped',
		currentCycle: 0,
	};

	public constructor(
		private readonly onRuntimeUpdate?: (update: AdapterRuntimeUpdate) => void,
		private readonly loadModule: StrudelModuleLoader = async () => (await import('@strudel/web/web.mjs')) as unknown as StrudelModule,
		private readonly onEvaluation?: (update: StrudelEvaluationUpdate) => void,
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
			// The editor package owns the official widget methods and transpiler
			// registrations. Load its lightweight widget module before the runtime's
			// prebake so both packages decorate the same Pattern prototype. If an
			// embedding host omits CodeMirror, the compatibility registrations below
			// still keep reduced runtimes playable.
			try {
				await import('@strudel/codemirror/widget.mjs');
			} catch {
				// `registerSushiCompatibility` supplies a reduced fallback for hosts
				// that cannot load the optional editor widget module.
			}
			// The unbundled web entry exports Pattern, while older embedding hosts
			// may still provide the self-contained bundle. Give the compatibility
			// layer the shared prototype in either case.
			if (!module.Pattern?.prototype) {
				try {
					const core = await import('@strudel/core') as { Pattern?: { prototype: Record<string, unknown> } };
					if (core.Pattern) module.Pattern = { prototype: core.Pattern.prototype };
				} catch {
					// The fallback registrations below still support reduced test
					// runtimes that do not expose the core package.
				}
			}
			this.module = module;
			this.repl = await module.initStrudel({
				// Sushi owns one transport per studio. Keep Cyclist local instead of
				// using NeoCyclist's SharedWorker clock: a worker can outlive a page
				// reload (or another open tab) and retain a stale finite cursor. That
				// makes playback appear to start while the adapter immediately thinks
				// the song has ended and hushes every audio node. The scheduler still
				// uses worker-timers below, so UI work does not drive its heartbeat.
				sync: false,
				// Strudel.cc runs Cyclist from worker-timers. Window timers can be
				// delayed by React layout, canvas work, or a busy audio callback, which
				// makes Cyclist log "skip query: too late" and drops events. Keep the
				// scheduler's heartbeat independent from the UI timer queue.
				setInterval: setSchedulerInterval,
				clearInterval: clearSchedulerInterval,
				prebake: async () => {
					registerSushiCompatibility(module, this.sliderValues);
					// @strudel/web only registers oscillator synths by default. Strudel.cc
					// adds its GM soundfonts and the sample collections below before
					// evaluating user code, so ordinary Strudel snippets resolve the same
					// sounds in Sushi instead of silently dropping unsupported layers.
					await registerSoundfontsOnModule(module);
					// Fetching the optional sample maps during init made a CORS/CDN or
					// decoder failure look like a source-evaluation failure and prevented
					// Firefox from reaching the first user-gesture Play. Start the work in
					// the background; the first playback waits only when its source needs
					// one of those banks, and always treats the work as best-effort.
					this.sampleBankPromise = this.preloadSampleBanks(module);
				},
				beforeStart: () => this.preloadActivePattern(),
				afterEval: (update) => {
					this.activePattern = update.pattern;
					try {
						this.onEvaluation?.(update);
					} catch (error) {
						console.warn('[sushi] editor evaluation callback failed', error);
					}
				},
				onEvalError: (error) => {
					if (this.activeEvaluation) this.activeEvaluation.error = error;
				},
				onToggle: (started) => {
					if (!started) this.pendingSchedulerStart = undefined;
					this.setRuntime({
						transport: started ? 'playing' : 'stopped',
						audioState: started ? 'ready' : this.runtime.audioState,
						currentCycle: started ? this.readCurrentCycle() : this.runtime.currentCycle,
					});
					if (started) {
						// The object above is evaluated while the previous transport state
						// is still visible, so take one more sample after marking the
						// transport as playing. This lets a pending SharedWorker reset
						// acknowledge itself immediately when the cursor is already near
						// the requested start cycle.
						this.setRuntime({ currentCycle: this.readCurrentCycle() });
						this.startCycleTimer();
					} else {
						this.stopCycleTimer();
					}
				},
			});
			// Keep editor-only Strudel helpers available after initialization too;
			// this is idempotent when the prebake hook already installed them.
			registerSushiCompatibility(module, this.sliderValues);
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
			this.sliderValues.clear();
			this.visualizerPatternIds.clear();
			this.visualizerAnalyzerIds.clear();
			this.preloadPromise = undefined;
			this.audioInitPromise = undefined;
			this.sampleBankPromise = undefined;
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

			let pattern = await this.repl.evaluate(source, autoplay);
			if (this.destroyed) return { ok: false, error: this.destroyedError() };
			if (currentEvaluation.error && isHeaderOnlyAstError(currentEvaluation.error)) {
				// A source document may intentionally contain only Sushi's global
				// declarations. Strudel's transpiler expects a final expression, so
				// provide silence to the runtime without adding it to canonical source.
				currentEvaluation.error = undefined;
				pattern = await this.repl.evaluate(appendRuntimeSilence(source), autoplay);
				if (this.destroyed) return { ok: false, error: this.destroyedError() };
			}
			if (currentEvaluation.error) {
				return { ok: false, error: currentEvaluation.error };
			}
			if (!pattern) {
				return { ok: false, error: new Error('Strudel did not produce a playable pattern.') };
			}

			this.activePattern = pattern as StrudelPattern;
			this.activeSource = source;
			this.visualizerPatternIds = visualizerPatternIds(source);
			this.visualizerAnalyzerIds.clear();
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
		this.pendingSchedulerStart = undefined;
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
			this.armSchedulerStart(cycle);
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
			await this.initializeAudio();
			if (this.destroyed) throw this.destroyedError();
			await this.ensureAudioContextRunning();
			if (this.destroyed) throw this.destroyedError();
			// An omitted boundary means "resume the configured arrangement", not
			// "forget the boundary". This matters for callers that use the adapter
			// directly (the Studio always passes its current project boundary).
			if (songEndCycle !== undefined) {
				this.songEndCycle = Number.isFinite(songEndCycle) && songEndCycle > 0 ? songEndCycle : undefined;
			}
			const currentCycle = this.readCurrentCycle();
			const shouldRewindStoppedTransport = this.runtime.transport === 'stopped'
				&& (currentCycle <= 0 || (this.songEndCycle !== undefined && currentCycle >= this.songEndCycle));
			if (shouldRewindStoppedTransport) {
				this.setSchedulerCycle(0);
				this.setRuntime({ currentCycle: 0 });
			}
			const startCycle = shouldRewindStoppedTransport ? 0 : this.runtime.currentCycle ?? currentCycle;
			await this.preloadActivePattern();
			if (this.destroyed) throw this.destroyedError();
			this.armSchedulerStart(startCycle);
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
			this.setRuntime({ currentCycle: this.readCurrentCycle() });
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

	/**
	 * Loading the Strudel AudioWorklets is an expensive, one-time operation for
	 * this adapter. Reusing the promise also prevents a first-click mousedown
	 * listener and the Play handler from loading the same worklets concurrently.
	 */
	private async initializeAudio(): Promise<void> {
		if (!this.audioInitPromise) {
			this.audioInitPromise = Promise.resolve(this.module?.initAudio?.()).then(
				() => undefined,
				(error) => {
					this.audioInitPromise = undefined;
					throw error;
				},
			);
		}
		return this.audioInitPromise;
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

	private async preloadSampleBanks(module: StrudelModule): Promise<void> {
		await Promise.all([
			settleAudioAsset(
				() => module.samples?.('github:tidalcycles/dirt-samples', undefined, { prebake: true }),
				'the Dirt sample map',
			),
			settleAudioAsset(
				() => module.samples?.(PIANO_SAMPLE_MAP_URL, undefined, { prebake: true, tag: 'piano' }),
				'the piano sample map',
			),
			settleAudioAsset(
				() => module.samples?.(
					'https://strudel.b-cdn.net/tidal-drum-machines.json',
					'https://strudel.b-cdn.net/tidal-drum-machines/machines/',
					{ prebake: true, tag: 'drum-machines' },
				),
				'the drum-machine sample map',
			),
		]);
		await settleAudioAsset(
			() => module.aliasBank?.('https://strudel.b-cdn.net/tidal-drum-machines-alias.json'),
			'the drum-machine aliases',
		);
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
			// Sample maps are optional remote resources. They start during init so
			// synth-only songs do not wait on a network round trip, but a song that
			// references an as-yet-unregistered sound must wait for registration
			// before its first scheduler query.
			const sourceAssets = collectSourceAudioAssets(this.activeSource);
			if (sourceAssets.some((asset) => !module.getSound?.(asset.name)) && this.sampleBankPromise) {
				await this.sampleBankPromise;
			}
			const endCycle = Math.min(this.songEndCycle ?? DEFAULT_SONG_END_CYCLE, PRELOAD_LOOKAHEAD_CYCLES);
			const cps = typeof repl.scheduler.cps === 'number' && Number.isFinite(repl.scheduler.cps) ? repl.scheduler.cps : 0.5;
			const audioContext = module.getAudioContext?.();
			let soundfontRuntime: SoundfontRuntime | undefined;
			const pending = new Map<string, Promise<unknown>>();
			const enqueueSound = async (soundName: string, data: Record<string, any> | undefined, notes: Array<string | number>, values: PreloadValue[] = []) => {
				if (!data || typeof data !== 'object') return;
				const variants: PreloadValue[] = (values.length
					? values
					: (notes.length ? notes : ['c3']).map((note) => ({ note })))
					.slice(0, MAX_PRELOAD_VARIANTS);

				if (data.type === 'sample' && data.samples && module.getSampleBuffer) {
					// Array banks select a file with `n`; note-keyed banks select a
					// note. Keep the values found in the actual pattern so `.bank()`
					// and pattern-valued `n(...)` controls preload the same variant
					// that the scheduler will request.
					const sampleVariants = Array.isArray(data.samples)
						? (values.length ? variants : [{ note: notes[0] ?? 'c3', n: 0 }])
						: variants.slice(0, MAX_PRELOAD_VARIANTS);
					for (const variant of sampleVariants) {
						const value = { ...variant, s: soundName, n: variant.n ?? 0, note: variant.note ?? 'c3' };
						const key = `sample:${soundName}:${String(value.n)}:${String(value.note)}`;
						if (!pending.has(key)) {
							pending.set(key, settleAudioAsset(
								() => module.getSampleBuffer?.(value, data.samples),
								`sample ${soundName}:${String(value.n)}`,
							));
						}
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
							try {
								soundfontRuntime ??= await loadSoundfontRuntime();
							} catch (error) {
								reportAudioAssetIssue('the soundfont runtime', error);
								return;
							}
							const runtime = soundfontRuntime;
							if (!runtime) return;
							pending.set(
								key,
								settleAudioAsset(
									() => runtime.getFontBufferSource(font, { ...variant, s: soundName, n: variant.n ?? 0, note: variant.note ?? 'c3' }, audioContext)
										.then((source) => { source.disconnect(); }),
									`soundfont ${font}:${String(noteKey)}`,
								),
							);
						}
					}
				}
			};

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

	/** Return the live scheduler cursor for animation clients such as the lane visualizers. */
	public getCurrentCycle(): number {
		return this.readCurrentCycle();
	}

	/** Query the same source-location haps that Strudel uses for live editor highlighting. */
	public getEditorHaps(begin: number, end: number, pattern = this.activePattern): StrudelHap[] {
		if (!pattern?.queryArc || !Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) return [];
		try {
			const cps = this.repl?.scheduler?.cps;
			const queried = pattern.queryArc(begin, end, {
				...(typeof cps === 'number' && Number.isFinite(cps) ? { _cps: cps } : {}),
			});
			return Array.isArray(queried) ? queried : [];
		} catch {
			return [];
		}
	}

	/**
	 * Query visualizer events for one source lane. The query is deliberately
	 * read-only and bounded by the caller's viewport, so animation never mutates
	 * Strudel state or competes with the serialized transport queue.
	 */
	public getVisualizerHaps(
		trackId: string,
		visualizer: StrudelVisualizer,
		begin: number,
		end: number,
	): VisualizerHap[] {
		const pattern = this.activePattern;
		const patternId = this.visualizerPatternIds.get(trackId);
		if (!pattern?.queryArc || !patternId || !Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) return [];

		try {
			const cps = this.repl?.scheduler?.cps;
			const queried = pattern.queryArc(begin, end, {
				...(typeof cps === 'number' && Number.isFinite(cps) ? { _cps: cps } : {}),
			});
			if (!Array.isArray(queried)) return [];

			return queried.flatMap((hap) => {
				if (hap.context?.sushiPatternId !== patternId || hap.context?.sushiVisualizer !== visualizer) return [];
				const analyzerId = typeof hap.context?.sushiAnalyzerId === 'number' ? hap.context.sushiAnalyzerId : undefined;
				if (analyzerId !== undefined) this.visualizerAnalyzerIds.set(trackId, analyzerId);
				const wholeBegin = numericTime(hap.whole?.begin);
				const wholeEnd = numericTime(hap.whole?.end);
				const duration = numericTime(hap.duration);
				const hapEnd = numericTime(hap.endClipped)
					?? (wholeBegin !== undefined && duration !== undefined ? wholeBegin + duration : wholeEnd);
				if (wholeBegin === undefined || hapEnd === undefined || hapEnd <= wholeBegin) return [];
				const rawValue = hap.value;
				const value = rawValue && typeof rawValue === 'object'
					? rawValue as Record<string, unknown>
					: { value: rawValue };
				return [{ begin: wholeBegin, end: hapEnd, value, ...(analyzerId === undefined ? {} : { analyzerId }) }];
			});
		} catch {
			return [];
		}
	}

	/** Read the Strudel analyser attached to a scope lane when the Web Audio runtime provides it. */
	public getVisualizerScopeData(trackId: string): ArrayLike<number> | undefined {
		return this.getVisualizerAnalyzerData(trackId, 'time');
	}

	/** Read the Strudel analyser attached to a spectrum lane when available. */
	public getVisualizerSpectrumData(trackId: string): ArrayLike<number> | undefined {
		return this.getVisualizerAnalyzerData(trackId, 'frequency');
	}

	private getVisualizerAnalyzerData(trackId: string, type: 'time' | 'frequency'): ArrayLike<number> | undefined {
		const analyzerId = this.visualizerAnalyzerIds.get(trackId);
		if (analyzerId === undefined || !this.module?.getAnalyzerData) return undefined;
		try {
			const data = this.module.getAnalyzerData(type, analyzerId);
			return data;
		} catch {
			return undefined;
		}
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
				this.armSchedulerStart(targetCycle);
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
		this.pendingSchedulerStart = undefined;
		this.stopCycleTimer();
		const repl = this.repl;
		const module = this.module;
		this.repl = undefined;
		this.module = undefined;
		this.activePattern = undefined;
		this.activeSource = '';
		this.sliderValues.clear();
		this.visualizerPatternIds.clear();
		this.visualizerAnalyzerIds.clear();
		this.preloadPromise = undefined;
		this.audioInitPromise = undefined;
		this.sampleBankPromise = undefined;
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

	private armSchedulerStart(cycle: number): void {
		this.pendingSchedulerStart = {
			cycle: Math.max(0, cycle),
			expiresAt: Date.now() + SCHEDULER_START_GRACE_MS,
		};
	}

	private readCurrentCycle(): number {
		// Cyclist intentionally reports zero while paused or stopped even though
		// its internal `lastEnd` cursor remains at the paused/boundary position.
		// Runtime state is the authoritative playhead outside active playback;
		// consulting scheduler.now() here would make Play after a pause or finite
		// song end jump back to the wrong cursor.
		if (this.runtime.transport !== 'playing') return this.runtime.currentCycle ?? 0;
		const pendingStart = this.pendingSchedulerStart;
		const cycle = this.repl?.scheduler?.now?.();
		if (pendingStart) {
			const isNearRequestedStart = typeof cycle === 'number'
				&& Number.isFinite(cycle)
				&& Math.abs(cycle - pendingStart.cycle) <= SCHEDULER_START_TOLERANCE_CYCLES;
			if (isNearRequestedStart || Date.now() >= pendingStart.expiresAt) {
				this.pendingSchedulerStart = undefined;
			} else {
				return pendingStart.cycle;
			}
		}
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
