import { useCallback, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react';
import type { SourceDiagnostic } from '../../lib/project/model';
import { dedentSourceSelection, indentSourceSelection, insertSourceDelimiterPair, insertSourceNewline, skipSourceClosingDelimiter } from '../../lib/project/editor';
import { getDiagnosticLabel, getDiagnosticLocation, formatRevision } from './helpers';

export interface SourceEditorProps {
	draft: string;
	draftLines: number[];
	draftBlockCount: number;
	highlightedSource: string;
	diagnostics: SourceDiagnostic[];
	sourceEditorRef: RefObject<HTMLTextAreaElement | null>;
	sourceHighlightRef: RefObject<HTMLPreElement | null>;
	editorGutterRef: RefObject<HTMLDivElement | null>;
	onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
	onChange: (source: string) => void;
	onScroll: () => void;
	onValidate: () => void;
}

export function SourceEditor({
	draft,
	draftLines,
	draftBlockCount,
	highlightedSource,
	diagnostics,
	sourceEditorRef,
	sourceHighlightRef,
	editorGutterRef,
	onPaste,
	onChange,
	onScroll,
	onValidate,
}: SourceEditorProps) {
	const applyEdit = useCallback((event: KeyboardEvent<HTMLTextAreaElement>, edit: { source: string; selectionStart: number; selectionEnd: number }) => {
		event.preventDefault();
		const editor = event.currentTarget;
		onChange(edit.source);
		requestAnimationFrame(() => {
			if (sourceEditorRef.current !== editor) return;
			editor.setSelectionRange(edit.selectionStart, edit.selectionEnd, editor.selectionDirection);
		});
	}, [onChange, sourceEditorRef]);

	const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			onValidate();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'Tab') {
			const editor = event.currentTarget;
			const edit = event.shiftKey
				? dedentSourceSelection(editor.value, editor.selectionStart, editor.selectionEnd)
				: indentSourceSelection(editor.value, editor.selectionStart, editor.selectionEnd);
			applyEdit(event, edit);
			return;
		}
		if (event.key === '(' || event.key === '[' || event.key === '{') {
			const editor = event.currentTarget;
			const edit = insertSourceDelimiterPair(editor.value, event.key, editor.selectionStart, editor.selectionEnd);
			if (edit) applyEdit(event, edit);
			return;
		}
		if (event.key === ')' || event.key === ']' || event.key === '}') {
			const editor = event.currentTarget;
			const edit = skipSourceClosingDelimiter(editor.value, event.key, editor.selectionStart, editor.selectionEnd);
			if (edit) applyEdit(event, edit);
			return;
		}
		if (event.key === 'Enter') {
			const editor = event.currentTarget;
			applyEdit(event, insertSourceNewline(editor.value, editor.selectionStart, editor.selectionEnd));
		}
	};

	return (
		<aside className="source-sidebar" aria-label="Strudel source editor">
			<div className="source-editor-shell">
				<div className="editor-gutter" ref={editorGutterRef} aria-hidden="true">{draftLines.map((line) => <span key={line}>{line.toString().padStart(2, '0')}</span>)}</div>
				<div className="editor-code-layer">
					<pre ref={sourceHighlightRef} className="source-highlight" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightedSource }} />
					<label className="sr-only" htmlFor="source-editor">Strudel source draft</label>
					<textarea
						id="source-editor"
						ref={sourceEditorRef}
						className="source-editor"
						value={draft}
						onPaste={onPaste}
						onChange={(event) => onChange(event.target.value)}
						onScroll={onScroll}
						onKeyDown={handleEditorKeyDown}
						spellCheck={false}
						autoCapitalize="off"
						wrap="off"
						aria-describedby="source-help"
					/>
				</div>
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
