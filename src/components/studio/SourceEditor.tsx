import { useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import type { StrudelEditorUpdate, StrudelEditorView } from '@strudel/codemirror';
import type { SourceDiagnostic, TransportState } from '../../lib/project/model';
import { dedentSourceSelection, indentSourceSelection, insertSourceDelimiterPair, insertSourceNewline, replaceSourceSelection, skipSourceClosingDelimiter } from '../../lib/project/editor';
import type { StrudelHap } from '../../lib/strudel/adapter';
import { getDiagnosticLabel, getDiagnosticLocation, formatRevision } from './helpers';

export type StrudelCodeMirrorModule = typeof import('@strudel/codemirror');

export interface SourceEditorProps {
	draft: string;
	diagnostics: SourceDiagnostic[];
	editorModule: StrudelCodeMirrorModule | null;
	editorError?: string | null;
	sourceEditorViewRef: RefObject<StrudelEditorView | null>;
	runtimeTransport: TransportState;
	getCurrentCycle: () => number;
	getEditorHaps: (begin: number, end: number) => StrudelHap[];
	onPaste: (source: string, caret: number) => void;
	onChange: (source: string) => void;
	onValidate: () => void;
	onStop: () => void;
	onReady?: () => void;
	onRetryEditor?: () => void;
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
	diagnostics,
	editorModule,
	editorError,
	sourceEditorViewRef,
	runtimeTransport,
	getCurrentCycle,
	getEditorHaps,
	onPaste,
	onChange,
	onValidate,
	onStop,
	onReady,
	onRetryEditor,
}: SourceEditorProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<StrudelEditorView | null>(null);
	const [editorReady, setEditorReady] = useState(false);
	const [initializationError, setInitializationError] = useState<string | null>(null);
	const syncingRef = useRef(false);
	const previousTransportRef = useRef<TransportState>(runtimeTransport);
	const initialDraftRef = useRef(draft);
	initialDraftRef.current = draft;
	const callbacksRef = useRef<EditorCallbacks>({ onPaste, onChange, onValidate, onStop, onReady });
	callbacksRef.current = { onPaste, onChange, onValidate, onStop, onReady };

	useEffect(() => {
		setEditorReady(false);
		setInitializationError(null);
		const root = rootRef.current;
		if (!root || !editorModule) return undefined;

		let editor: StrudelEditorView | null = null;
		let disposed = false;
		let removeListeners: (() => void) | null = null;

		const initialize = async () => {
			try {
				const { applySushiEditorTheme, SUSHI_EDITOR_FONT_FAMILY, SUSHI_EDITOR_FONT_SIZE } = await import('../../lib/project/sushi-editor-theme');
				if (disposed) return;

				const handleKeyDown = (event: KeyboardEvent) => {
					if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && editor) {
						event.preventDefault();
						event.stopPropagation();
						editorModule.flash(editor);
						callbacksRef.current.onValidate();
						return;
					}
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
				editor.contentDOM.setAttribute('autocapitalize', 'off');
				editor.contentDOM.setAttribute('spellcheck', 'false');
				root.addEventListener('keydown', handleKeyDown, true);
				editor.dom.addEventListener('paste', handlePaste, true);
				removeListeners = () => {
					root.removeEventListener('keydown', handleKeyDown, true);
					editor?.dom.removeEventListener('paste', handlePaste, true);
				};
				setEditorReady(true);
				callbacksRef.current.onReady?.();
			} catch (error) {
				if (disposed) return;
				console.error('[sushi] could not initialize the Strudel code editor', error);
				removeListeners?.();
				editor?.destroy();
				if (sourceEditorViewRef.current === editor) sourceEditorViewRef.current = null;
				if (viewRef.current === editor) viewRef.current = null;
				setEditorReady(false);
				setInitializationError(error instanceof Error ? error.message : String(error));
			}
		};

		void initialize();

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
		let queriedCycle = -1;
		let cachedHaps: StrudelHap[] = [];
		let lastHighlightAt = -Infinity;
		const animate = (timestamp: number) => {
			if (viewRef.current !== editor) return;
			const reportedCycle = getCurrentCycle();
			const currentCycle = Number.isFinite(reportedCycle) ? Math.max(0, reportedCycle) : 0;
			const cycleBucket = Math.floor(currentCycle);
			if (cycleBucket !== queriedCycle) {
				cachedHaps = getEditorHaps(Math.max(0, cycleBucket - 0.05), cycleBucket + 1.05)
					.filter((hap) => hap.hasOnset?.() !== false);
				queriedCycle = cycleBucket;
			}
			if (timestamp - lastHighlightAt >= 33) {
				editorModule.highlightMiniLocations(editor, currentCycle, cachedHaps);
				lastHighlightAt = timestamp;
			}
			frame = window.requestAnimationFrame(animate);
		};
		frame = window.requestAnimationFrame(animate);
		return () => {
			if (frame !== null) window.cancelAnimationFrame(frame);
		};
	}, [draft, getCurrentCycle, getEditorHaps, runtimeTransport]);

	const visibleEditorError = initializationError ?? editorError ?? null;

	return (
		<aside className="source-sidebar" aria-label="Strudel source editor">
			<div className="source-editor-shell source-editor-shell-codemirror">
				<div ref={rootRef} className={`source-editor-host${editorReady ? '' : ' source-editor-host-hidden'}`} aria-hidden={editorReady ? undefined : 'true'} />
				{!editorReady ? <NativeSourceEditor draft={draft} onPaste={onPaste} onChange={onChange} onValidate={onValidate} /> : null}
				{visibleEditorError ? (
					<div className="source-editor-error" role="alert">
						<span>Code editor unavailable: {visibleEditorError}</span>
						{onRetryEditor ? <button type="button" onClick={onRetryEditor}>Retry editor</button> : null}
					</div>
				) : null}
			</div>
			{diagnostics.length ? <SourceDiagnosticBanner diagnostic={diagnostics[0]} location="sidebar" /> : null}
		</aside>
	);
}

interface NativeSourceEditorProps {
	draft: string;
	onPaste: SourceEditorProps['onPaste'];
	onChange: SourceEditorProps['onChange'];
	onValidate: SourceEditorProps['onValidate'];
}

function NativeSourceEditor({ draft, onPaste, onChange, onValidate }: NativeSourceEditorProps) {
	const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);

	const applyEdit = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>, edit: { source: string; selectionStart: number; selectionEnd: number }) => {
		event.preventDefault();
		const editor = event.currentTarget;
		onChange(edit.source);
		requestAnimationFrame(() => {
			if (sourceEditorRef.current !== editor) return;
			editor.setSelectionRange(edit.selectionStart, edit.selectionEnd, editor.selectionDirection);
		});
	}, [onChange]);

	const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			onValidate();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const editor = event.currentTarget;
		if (event.key === 'Tab') {
			const edit = event.shiftKey
				? dedentSourceSelection(editor.value, editor.selectionStart, editor.selectionEnd)
				: indentSourceSelection(editor.value, editor.selectionStart, editor.selectionEnd);
			applyEdit(event, edit);
			return;
		}
		if (event.key === '(' || event.key === '[' || event.key === '{') {
			const edit = insertSourceDelimiterPair(editor.value, event.key, editor.selectionStart, editor.selectionEnd);
			if (edit) applyEdit(event, edit);
			return;
		}
		if (event.key === ')' || event.key === ']' || event.key === '}') {
			const edit = skipSourceClosingDelimiter(editor.value, event.key, editor.selectionStart, editor.selectionEnd);
			if (edit) applyEdit(event, edit);
			return;
		}
		if (event.key === 'Enter') {
			applyEdit(event, insertSourceNewline(editor.value, editor.selectionStart, editor.selectionEnd));
		}
	};

	const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
		const pastedText = event.clipboardData.getData('text/plain');
		if (!pastedText) return;
		event.preventDefault();
		const editor = event.currentTarget;
		const replacement = replaceSourceSelection(editor.value, pastedText, editor.selectionStart, editor.selectionEnd);
		onPaste(replacement.source, replacement.caret);
		requestAnimationFrame(() => {
			if (sourceEditorRef.current !== editor) return;
			editor.setSelectionRange(replacement.caret, replacement.caret);
		});
	};

	return (
		<div className="source-editor-fallback">
			<label className="sr-only" htmlFor="source-editor">Strudel source draft</label>
			<textarea
				id="source-editor"
				ref={sourceEditorRef}
				className="source-editor-fallback-input"
				value={draft}
				onPaste={handlePaste}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				spellCheck={false}
				autoCapitalize="off"
				wrap="off"
			/>
		</div>
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
