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
}

export interface AdapterRuntimeUpdate {
	audioState?: AudioState;
	transport?: TransportState;
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
	private runtime: AdapterRuntimeUpdate = {
		audioState: 'initializing',
		transport: 'stopped',
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
					});
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

	public async play(): Promise<AdapterResult> {
		try {
			await this.init();
			if (!this.repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}

			// The package registers this on first mousedown, but calling it from the
			// Play click makes the user-gesture boundary explicit for this UI.
			await this.module?.initAudio?.();
			await this.repl.start();
			return { ok: true };
		} catch (error) {
			this.setRuntime({ audioState: 'error', transport: 'stopped' });
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
			this.setRuntime({ transport: 'stopped' });
			return { ok: true };
		} catch (error) {
			return { ok: false, error };
		}
	}

	public destroy(): void {
		try {
			this.repl?.stop();
			this.module?.hush?.();
		} catch {
			// Destruction should never turn a route change or HMR update into an
			// uncaught browser error.
		}
	}

	private setRuntime(update: AdapterRuntimeUpdate): void {
		this.runtime = { ...this.runtime, ...update };
		this.onRuntimeUpdate?.(update);
	}
}
