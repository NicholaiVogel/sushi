import { useEffect, useRef, type RefObject } from 'react';
import type { StrudelEditorUpdate, StrudelEditorView } from '@strudel/codemirror';
import type { SourceDiagnostic, TransportState } from '../../lib/project/model';
import { dedentSourceSelection, indentSourceSelection, replaceSourceSelection } from '../../lib/project/editor';
import type { StrudelHap } from '../../lib/strudel/adapter';
import { getDiagnosticLabel, getDiagnosticLocation, formatRevision } from './helpers';

export type StrudelCodeMirrorModule = typeof import('@strudel/codemirror');

export interface SourceEditorProps {
	draft: string;
	draftBlockCount: number;
	diagnostics: SourceDiagnostic[];
	editorModule: StrudelCodeMirrorModule | null;
	sourceEditorViewRef: RefObject<StrudelEditorView | null>;
	runtimeTransport: TransportState;
	getCurrentCycle: () => number;
	getEditorHaps: (begin: number, end: number) => StrudelHap[];
	onPaste: (source: string, caret: number) => void;
	onChange: (source: string) => void;
	onValidate: () => void;
	onStop: () => void;
	onReady?: () => void;
}

interface EditorCallbacks {
	onPaste: SourceEditorProps['onPaste'];
	onChange: SourceEditorProps['onChange'];
	onValidate: SourceEditorProps['onValidate'];
	onStop: SourceEditorProps['onStop'];
	onReady?: SourceEditorProps['onReady'];
}

export function SourceEditor({
	draft,
	draftBlockCount,
	diagnostics,
	editorModule,
	sourceEditorViewRef,
	runtimeTransport,
	getCurrentCycle,
	getEditorHaps,
	onPaste,
	onChange,
	onValidate,
	onStop,
	onReady,
}: SourceEditorProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<StrudelEditorView | null>(null);
	const syncingRef = useRef(false);
	const previousTransportRef = useRef<TransportState>(runtimeTransport);
	const initialDraftRef = useRef(draft);
	initialDraftRef.current = draft;
	const callbacksRef = useRef<EditorCallbacks>({ onPaste, onChange, onValidate, onStop, onReady });
	callbacksRef.current = { onPaste, onChange, onValidate, onStop, onReady };

	useEffect(() => {
		const root = rootRef.current;
		if (!root || !editorModule) return undefined;

		let editor: StrudelEditorView | null = null;
		let disposed = false;
		let removeListeners: (() => void) | null = null;

		const initialize = async () => {
			const { applySushiEditorTheme, SUSHI_EDITOR_FONT_FAMILY, SUSHI_EDITOR_FONT_SIZE } = await import('../../lib/project/sushi-editor-theme');
			if (disposed) return;

			const handleKeyDown = (event: KeyboardEvent) => {
				if ((event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) || !editor) return;
				const source = editor.state.doc.toString();
				const { from, to } = editor.state.selection.main;
				const edit = event.shiftKey
					? dedentSourceSelection(source, from, to)
					: indentSourceSelection(source, from, to);
				event.preventDefault();
				event.stopPropagation();
				syncingRef.current = true;
				try {
					editor.dispatch({
						changes: { from: 0, to: source.length, insert: edit.source },
						selection: { anchor: edit.selectionStart, head: edit.selectionEnd },
					});
				} finally {
					syncingRef.current = false;
				}
				callbacksRef.current.onChange(edit.source);
			};
			const handlePaste = (event: ClipboardEvent) => {
				const pastedText = event.clipboardData?.getData('text/plain');
				if (!pastedText || !editor) return;

				event.preventDefault();
				event.stopPropagation();
				const source = editor.state.doc.toString();
				const { from, to } = editor.state.selection.main;
				const replacement = replaceSourceSelection(source, pastedText, from, to);
				syncingRef.current = true;
				try {
					editor.dispatch({
						changes: { from, to, insert: pastedText },
						selection: { anchor: replacement.caret },
					});
				} finally {
					syncingRef.current = false;
				}
				callbacksRef.current.onPaste(replacement.source, replacement.caret);
			};

			try {
				editor = editorModule.initEditor({
					initialCode: initialDraftRef.current,
					root,
					onChange: (update: StrudelEditorUpdate) => {
						if (!syncingRef.current && update.docChanged) callbacksRef.current.onChange(update.state.doc.toString());
					},
					onEvaluate: () => {
						if (editor) editorModule.flash(editor);
						callbacksRef.current.onValidate();
						return true;
					},
					onStop: () => {
						if (editor) editorModule.updateMiniLocations(editor, []);
						callbacksRef.current.onStop();
						return true;
					},
				});
				applySushiEditorTheme(editor);
			} catch (error) {
				console.error('[sushi] could not initialize the Strudel code editor', error);
				editor?.destroy();
				return;
			}

			if (disposed || !editor) {
				editor?.destroy();
				return;
			}
			viewRef.current = editor;
			sourceEditorViewRef.current = editor;
			root.style.fontFamily = SUSHI_EDITOR_FONT_FAMILY;
			root.style.fontSize = `${SUSHI_EDITOR_FONT_SIZE}px`;
			const cmEditor = root.querySelector('.cm-editor');
			if (cmEditor) cmEditor.setAttribute('aria-label', 'Strudel source draft');
			editor.contentDOM.setAttribute('aria-describedby', 'source-help');
			editor.contentDOM.setAttribute('autocapitalize', 'off');
			editor.contentDOM.setAttribute('spellcheck', 'false');
			root.addEventListener('keydown', handleKeyDown, true);
			editor.dom.addEventListener('paste', handlePaste, true);
			removeListeners = () => {
				root.removeEventListener('keydown', handleKeyDown, true);
				editor?.dom.removeEventListener('paste', handlePaste, true);
			};
			callbacksRef.current.onReady?.();
		};

		void initialize().catch((error) => {
			console.error('[sushi] could not load the Sushi editor theme', error);
		});

		return () => {
			disposed = true;
			removeListeners?.();
			if (sourceEditorViewRef.current === editor) sourceEditorViewRef.current = null;
			if (viewRef.current === editor) viewRef.current = null;
			editor?.destroy();
		};
	}, [editorModule, sourceEditorViewRef]);

	useEffect(() => {
		const editor = viewRef.current;
		if (!editor || editor.state.doc.toString() === draft) return;
		const selection = editor.state.selection.main;
		syncingRef.current = true;
		try {
			editor.dispatch({
				changes: { from: 0, to: editor.state.doc.length, insert: draft },
				selection: {
					anchor: Math.min(selection.anchor, draft.length),
					head: Math.min(selection.head, draft.length),
				},
			});
		} finally {
			syncingRef.current = false;
		}
	}, [draft]);

	useEffect(() => {
		const editor = viewRef.current;
		const wasPlaying = previousTransportRef.current === 'playing';
		previousTransportRef.current = runtimeTransport;
		if (!editor || !editorModule) return undefined;
		if (runtimeTransport === 'stopped' && wasPlaying) editorModule.updateMiniLocations(editor, []);
		if (runtimeTransport !== 'playing' || typeof window === 'undefined') return undefined;

		let frame: number | null = null;
		const animate = () => {
			if (viewRef.current !== editor) return;
			const currentCycle = Number.isFinite(getCurrentCycle()) ? Math.max(0, getCurrentCycle()) : 0;
			const haps = getEditorHaps(Math.max(0, currentCycle - 0.1), currentCycle + 0.1)
				.filter((hap) => hap.hasOnset?.() !== false);
			editorModule.highlightMiniLocations(editor, currentCycle, haps);
			frame = window.requestAnimationFrame(animate);
		};
		animate();
		return () => {
			if (frame !== null) window.cancelAnimationFrame(frame);
		};
	}, [getCurrentCycle, getEditorHaps, runtimeTransport]);

	return (
		<aside className="source-sidebar" aria-label="Strudel source editor">
			<div className="source-editor-shell source-editor-shell-codemirror">
				<div ref={rootRef} className="source-editor-host" />
			</div>
			<p className="editor-help" id="source-help">Tab indent <span aria-hidden="true">·</span> Shift+Tab outdent <span aria-hidden="true">·</span> Cmd/Ctrl + Enter to validate <span aria-hidden="true">·</span> {draftBlockCount} marked {draftBlockCount === 1 ? 'block' : 'blocks'}</p>
			{diagnostics.length ? <SourceDiagnosticBanner diagnostic={diagnostics[0]} location="sidebar" /> : null}
		</aside>
	);
}

function SourceDiagnosticBanner({ diagnostic, location }: { diagnostic: SourceDiagnostic; location: 'sidebar' | 'canvas' }) {
	if (location === 'canvas') {
		return (
			<div className="canvas-diagnostic" role="status" aria-live="polite">
				<div className="diagnostic-meta"><span className="error-mark" aria-hidden="true">!</span><span>{getDiagnosticLabel(diagnostic)}</span><span>{getDiagnosticLocation(diagnostic) || `REV ${formatRevision(diagnostic.revision)}`}</span></div>
				<p>{diagnostic.message}</p>
				{diagnostic.context ? <code className="diagnostic-context">{diagnostic.context}</code> : null}
			</div>
		);
	}

	return (
		<div className="sidebar-diagnostic" role="status" aria-live="polite">
			<span className="error-mark" aria-hidden="true">!</span>
			<span>{getDiagnosticLabel(diagnostic)}</span>
			<span className="sidebar-diagnostic-revision">{getDiagnosticLocation(diagnostic) || `REV ${formatRevision(diagnostic.revision)}`}</span>
		</div>
	);
}

export function CanvasDiagnostic({ diagnostic }: { diagnostic: SourceDiagnostic }) {
	return <SourceDiagnosticBanner diagnostic={diagnostic} location="canvas" />;
}
