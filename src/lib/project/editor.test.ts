import { describe, expect, test } from 'bun:test';
import { getSourceLineNumbers } from './editor';

describe('source editor line model', () => {
	test('keeps gutter entries aligned with logical source lines', () => {
		expect(getSourceLineNumbers('setcpm(90/4)\n$: s("bd")\n\n')).toEqual([1, 2, 3, 4]);
	});

	test('keeps an empty source addressable at line one', () => {
		expect(getSourceLineNumbers('')).toEqual([1]);
	});
});
