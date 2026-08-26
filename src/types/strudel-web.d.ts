declare module '@strudel/web' {
	interface StrudelRepl {
		evaluate(code: string, autostart?: boolean, shouldHush?: boolean): Promise<unknown>;
		start(): Promise<void>;
		stop(): void;
		pause(): void;
	}

	interface InitStrudelOptions {
		onEvalError?: (error: unknown) => void;
		onToggle?: (started: boolean) => void;
	}

	export function initStrudel(options?: InitStrudelOptions): Promise<StrudelRepl>;
	export function initAudio(options?: Record<string, unknown>): Promise<void>;
	export function hush(): void;
	export function evaluate(code: string, autoplay?: boolean): Promise<unknown>;
}
