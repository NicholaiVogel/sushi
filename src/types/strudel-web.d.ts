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

declare module '@strudel/soundfonts' {
	export function registerSoundfonts(): void;
	export function getFontBufferSource(name: string, value: Record<string, any>, audioContext: AudioContext): Promise<AudioBufferSourceNode>;
}

declare module '@strudel/soundfonts/gm.mjs' {
	const soundfonts: Record<string, string[]>;
	export default soundfonts;
}
