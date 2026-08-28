import { describe, expect, test } from 'bun:test';
import {
	dedentSourceSelection,
	getSourceLineNumbers,
	indentSourceSelection,
	insertSourceDelimiterPair,
	insertSourceNewline,
	replaceSourceSelection,
	skipSourceClosingDelimiter,
} from './editor';

describe('source editor line model', () => {
	test('keeps gutter entries aligned with logical source lines', () => {
		expect(getSourceLineNumbers('setcpm(90/4)\n$: s("bd")\n\n')).toEqual([1, 2, 3, 4]);
	});

	test('keeps an empty source addressable at line one', () => {
		expect(getSourceLineNumbers('')).toEqual([1]);
	});

	test('replaces pasted text and returns the post-paste caret', () => {
		expect(replaceSourceSelection('alpha\nomega', 'middle\n', 6, 6)).toEqual({
			source: 'alpha\nmiddle\nomega',
			caret: 13,
		});
	});

	test('normalizes reversed or out-of-range selections', () => {
		expect(replaceSourceSelection('abcdef', 'X', 99, 2)).toEqual({ source: 'abX', caret: 3 });
	});

	test('indents the caret line with a soft tab', () => {
		expect(indentSourceSelection('alpha\nomega', 7)).toEqual({
			source: 'alpha\n  omega',
			selectionStart: 9,
			selectionEnd: 9,
		});
	});

	test('indents every line touched by a selection', () => {
		expect(indentSourceSelection('one\ntwo\nthree', 1, 9)).toEqual({
			source: '  one\n  two\n  three',
			selectionStart: 3,
			selectionEnd: 15,
		});
	});

	test('dedents selected lines and preserves the adjusted selection', () => {
		expect(dedentSourceSelection('  one\n\ttwo\nthree', 1, 11)).toEqual({
			source: 'one\ntwo\nthree',
			selectionStart: 0,
			selectionEnd: 8,
		});
	});

	test('dedents a partial leading space instead of leaving it stranded', () => {
		expect(dedentSourceSelection(' one', 2)).toEqual({
			source: 'one',
			selectionStart: 1,
			selectionEnd: 1,
		});
	});

	test('carries indentation onto a new line and nests after an opener', () => {
		expect(insertSourceNewline('  register(() => {', 18)).toEqual({
			source: '  register(() => {\n    ',
			selectionStart: 23,
			selectionEnd: 23,
		});
	});

	test('auto-closes source delimiters and leaves the caret inside', () => {
		expect(insertSourceDelimiterPair('alpha', '(', 5)).toEqual({
			source: 'alpha()',
			selectionStart: 6,
			selectionEnd: 6,
		});
		expect(insertSourceDelimiterPair('alpha', '[', 5)).toEqual({
			source: 'alpha[]',
			selectionStart: 6,
			selectionEnd: 6,
		});
	});

	test('wraps a selected source range with matching delimiters', () => {
		expect(insertSourceDelimiterPair('alpha + omega', '(', 0, 5)).toEqual({
			source: '(alpha) + omega',
			selectionStart: 1,
			selectionEnd: 6,
		});
	});

	test('skips a closing delimiter already under the caret', () => {
		expect(skipSourceClosingDelimiter('alpha()', ')', 6)).toEqual({
			source: 'alpha()',
			selectionStart: 7,
			selectionEnd: 7,
		});
		expect(skipSourceClosingDelimiter('alpha()', ')', 5)).toBeUndefined();
	});
});
