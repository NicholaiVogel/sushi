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
		afterEval?: (update: {
			code: string;
			pattern: unknown;
			meta?: { miniLocations?: Array<[number, number]>; widgets?: Array<Record<string, any>> };
			range?: [number, number];
			widgetRemoved?: boolean;
		}) => void;
	}

	export function initStrudel(options?: InitStrudelOptions): Promise<StrudelRepl>;
	export function initAudio(options?: Record<string, unknown>): Promise<void>;
	export function hush(): void;
	export function evaluate(code: string, autoplay?: boolean): Promise<unknown>;
}

// The browser-facing web entry intentionally re-exports the external Strudel
// packages instead of the self-contained dist bundle. Keeping this declaration
// separate lets the adapter opt into that shared-runtime entry without
// changing the public package typings used elsewhere in the app.
declare module '@strudel/web/web.mjs' {
	export * from '@strudel/web';
}

declare module '@strudel/core' {
	export const Pattern: { prototype: Record<string, unknown> };
}

declare module '@strudel/codemirror' {
	import type { EditorView } from '@codemirror/view';

	export type StrudelEditorView = EditorView;

	export interface StrudelEditorUpdate {
		docChanged: boolean;
		state: { doc: { toString(): string } };
	}

	export interface StrudelEditorSettings {
		fontFamily: string;
		fontSize: number;
		[key: string]: unknown;
	}

	export interface InitEditorOptions {
		initialCode?: string;
		onChange: (update: StrudelEditorUpdate) => void;
		onEvaluate?: () => boolean | void;
		onStop?: () => boolean | void;
		root: HTMLElement;
		mondo?: boolean;
	}

	export function initEditor(options: InitEditorOptions): StrudelEditorView;
	export function flash(view: StrudelEditorView, ms?: number): void;
	export function updateMiniLocations(view: StrudelEditorView, locations: Array<[number, number]>, range?: [number, number] | null): void;
	export function highlightMiniLocations(view: StrudelEditorView, atTime: number, haps: unknown[]): void;
	export function updateSliderWidgets(view: StrudelEditorView, widgets: Array<Record<string, any>>): void;
	export function updateWidgets(view: StrudelEditorView, widgets: Array<Record<string, any>>): void;
	export const codemirrorSettings: { get(): StrudelEditorSettings };
}

// Importing this module registers Strudel's official inline visualizer widgets
// on the shared Pattern/transpiler runtime before source evaluation begins.
declare module '@strudel/codemirror/widget.mjs' {
	export function registerWidget(type: string, fn?: (...args: any[]) => unknown): void;
}

declare module '@strudel/soundfonts' {
	export function registerSoundfonts(): void;
	export function getFontBufferSource(name: string, value: Record<string, any>, audioContext: AudioContext): Promise<AudioBufferSourceNode>;
}

declare module '@strudel/soundfonts/gm.mjs' {
	const soundfonts: Record<string, string[]>;
	export default soundfonts;
}
