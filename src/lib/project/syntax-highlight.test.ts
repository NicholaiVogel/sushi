import { describe, expect, test } from 'bun:test';
import { highlightStrudel } from './syntax-highlight';

describe('Strudel syntax highlighting', () => {
	test('colors source labels, calls, properties, values, and comments', () => {
		const highlighted = highlightStrudel('const key = "E:minor"\n$: note("<e2 g2>").gain(.5)\n// keep this');

		expect(highlighted).toContain('<span class="source-token-keyword">const</span>');
		expect(highlighted).toContain('<span class="source-token-label">$:</span>');
		expect(highlighted).toContain('<span class="source-token-function">note</span>');
		expect(highlighted).toContain('<span class="source-token-property">gain</span>');
		expect(highlighted).toContain('<span class="source-token-number">.5</span>');
		expect(highlighted).toContain('<span class="source-token-comment">// keep this</span>');
	});

	test('escapes source content before placing it in HTML', () => {
		const highlighted = highlightStrudel('const pattern = "<&>"');

		expect(highlighted).toContain('&lt;&amp;&gt;');
		expect(highlighted).not.toContain('<&>');
	});
});
