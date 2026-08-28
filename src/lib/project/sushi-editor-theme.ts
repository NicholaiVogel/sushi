import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export const SUSHI_EDITOR_FONT_SIZE = 12;
export const SUSHI_EDITOR_FONT_FAMILY = 'var(--mono)';

const sushiHighlightStyle = HighlightStyle.define([
	{ tag: t.comment, color: 'var(--comment)' },
	{ tag: [t.string, t.special(t.string)], color: 'var(--string)' },
	{ tag: [t.number, t.unit], color: 'var(--number)' },
	{ tag: [t.keyword, t.bool, t.atom], color: 'var(--keyword)' },
	{ tag: t.labelName, color: 'var(--label)' },
	{ tag: [t.variableName, t.definition(t.variableName), t.special(t.variableName)], color: 'var(--identifier)' },
	{ tag: t.propertyName, color: 'var(--property)' },
	{ tag: t.function(t.variableName), color: 'var(--function)' },
	{ tag: [t.operator, t.punctuation, t.bracket], color: 'var(--operator)' },
	{ tag: [t.typeName, t.className], color: 'var(--keyword)' },
	{ tag: t.meta, color: 'var(--number)' },
	{ tag: t.invalid, color: 'var(--danger)' },
]);

export const sushiEditorTheme: Extension = [
	EditorView.theme(
		{
			'&': {
				backgroundColor: 'var(--background)',
				color: 'var(--foreground)',
				fontFamily: SUSHI_EDITOR_FONT_FAMILY,
				fontSize: `${SUSHI_EDITOR_FONT_SIZE}px`,
			},
			'.cm-content': {
				caretColor: 'var(--accent)',
			},
			'.cm-cursor, .cm-dropCursor': {
				borderLeftColor: 'var(--accent)',
			},
			'.cm-gutters': {
				backgroundColor: 'var(--gutterBackground)',
				color: 'var(--gutterForeground)',
				fontFamily: SUSHI_EDITOR_FONT_FAMILY,
				fontSize: '11px',
			},
			'.cm-activeLine, .cm-activeLineGutter': {
				backgroundColor: 'var(--lineHighlight)',
			},
			'&.cm-focused .cm-selectionBackground, & .cm-line::selection, & .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection': {
				background: 'var(--selection) !important',
			},
			'& .cm-selectionMatch': {
				backgroundColor: 'var(--selectionMatch)',
			},
		},
		{ dark: true },
	),
	syntaxHighlighting(sushiHighlightStyle),
];

export function applySushiEditorTheme(view: EditorView) {
	view.dispatch({ effects: StateEffect.appendConfig.of(sushiEditorTheme) });
}
