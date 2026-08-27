import type { AudioState, TransportState } from '../project/model';

interface StrudelModule {
	initStrudel(options?: {
		onEvalError?: (error: unknown) => void;
		onToggle?: (started: boolean) => void;
	}): Promise<StrudelRepl>;
	initAudio?: (options?: Record<string, unknown>) => Promise<void>;
	hush?: () => void;
}

type StrudelModuleLoader = () => Promise<StrudelModule>;

interface StrudelRepl {
	evaluate(code: string, autostart?: boolean): Promise<unknown>;
	start(): Promise<void>;
	stop(): void;
	pause(): void;
	scheduler: StrudelScheduler;
}

interface StrudelScheduler {
	now(): number;
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

	private async evaluateSourceNow(
		source: string,
		options: { autoplay?: boolean; restoreSource?: string },
	): Promise<AdapterResult> {
		await this.init();
		const result = await this.evaluateRaw(source, options.autoplay ?? false);
		if (!result.ok && options.restoreSource && options.restoreSource !== source) {
			await this.evaluateRaw(options.restoreSource, false);
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
			if (currentEvaluation.error) {
				return { ok: false, error: currentEvaluation.error };
			}
			if (!pattern) {
				return { ok: false, error: new Error('Strudel did not produce a playable pattern.') };
			}

			return { ok: true };
		} catch (error) {
			return { ok: false, error };
		} finally {
			if (this.activeEvaluation === currentEvaluation) this.activeEvaluation = undefined;
		}
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
			await this.repl.start();
			this.startCycleTimer();
			return { ok: true };
		} catch (error) {
			this.setRuntime({ audioState: 'error', transport: 'stopped' });
			return { ok: false, error };
		}
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
