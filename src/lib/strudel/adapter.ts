import type { AudioState, TransportState } from '../project/model';

interface StrudelModule {
	initStrudel(options?: {
		onEvalError?: (error: unknown) => void;
		onToggle?: (started: boolean) => void;
	}): Promise<StrudelRepl>;
	initAudio?: (options?: Record<string, unknown>) => Promise<void>;
	hush?: () => void;
}

interface StrudelRepl {
	evaluate(code: string, autostart?: boolean, shouldHush?: boolean): Promise<unknown>;
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
 * inside init(). The third repl.evaluate argument is important: validation
 * can run without hushing the currently playing last-valid pattern.
 */
export class StrudelAdapter {
	private module: StrudelModule | undefined;
	private repl: StrudelRepl | undefined;
	private initPromise: Promise<void> | undefined;
	private evalError: unknown;
	private runtime: AdapterRuntimeUpdate = {
		audioState: 'initializing',
		transport: 'stopped',
	};

	public constructor(private readonly onRuntimeUpdate?: (update: AdapterRuntimeUpdate) => void) {}

	public async init(): Promise<void> {
		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = (async () => {
			if (typeof window === 'undefined') {
				throw new Error('The Strudel audio runtime is only available in a browser.');
			}

			const module = (await import('@strudel/web')) as unknown as StrudelModule;
			this.module = module;
			this.repl = await module.initStrudel({
				onEvalError: (error) => {
					this.evalError = error;
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
		options: { autoplay?: boolean; hushCurrent?: boolean } = {},
	): Promise<AdapterResult> {
		try {
			await this.init();
			if (!this.repl) {
				throw new Error('Strudel did not return a browser REPL.');
			}

			this.evalError = undefined;
			const pattern = await this.repl.evaluate(
				source,
				options.autoplay ?? false,
				options.hushCurrent ?? false,
			);
			if (this.evalError) {
				return { ok: false, error: this.evalError };
			}
			if (!pattern) {
				return { ok: false, error: new Error('Strudel did not produce a playable pattern.') };
			}

			return { ok: true };
		} catch (error) {
			return { ok: false, error };
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
