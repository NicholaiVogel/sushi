import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { StateEffect, type Compartment, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export const SUSHI_EDITOR_FONT_SIZE = 12;
export const SUSHI_EDITOR_FONT_FAMILY = 'var(--mono)';

const sushiHighlightStyle = HighlightStyle.define([
	{ tag: t.comment, color: 'var(--comment) !important' },
	{ tag: [t.string, t.special(t.string)], color: 'var(--string) !important' },
	{ tag: [t.number, t.unit], color: 'var(--number) !important' },
	{ tag: [t.keyword, t.bool, t.atom], color: 'var(--keyword) !important' },
	{ tag: t.labelName, color: 'var(--label) !important' },
	{ tag: [t.variableName, t.definition(t.variableName), t.special(t.variableName)], color: 'var(--identifier) !important' },
	{ tag: t.propertyName, color: 'var(--property) !important' },
	{ tag: t.function(t.variableName), color: 'var(--function) !important' },
	{ tag: [t.operator, t.punctuation, t.bracket], color: 'var(--operator) !important' },
	{ tag: [t.typeName, t.className], color: 'var(--keyword) !important' },
	{ tag: t.meta, color: 'var(--number) !important' },
	{ tag: t.invalid, color: 'var(--danger) !important' },
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


export function applySushiEditorTheme(view: EditorView, themeCompartment?: Compartment) {
	// Strudel's default theme includes a fixed dark syntax palette. Replace that
	// compartment before layering Sushi's variable-driven theme so the editor
	// follows the application's light/dark appearance setting too.
	if (themeCompartment) view.dispatch({ effects: themeCompartment.reconfigure([]) });
	view.dispatch({ effects: StateEffect.appendConfig.of(sushiEditorTheme) });
}
