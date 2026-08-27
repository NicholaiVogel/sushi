import { describe, expect, test } from 'bun:test';
import { getSourceLineNumbers, replaceSourceSelection } from './editor';

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
});
