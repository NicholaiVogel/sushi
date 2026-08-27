import { describe, expect, test } from 'bun:test';
import { diagnosticFromError } from './model';

describe('source diagnostics', () => {
	test('maps parser locations to a source range and context line', () => {
		const source = 'setcpm(84 / 4)\n$: s("bd"\n';
		const diagnostic = diagnosticFromError(7, {
			message: 'Unexpected token',
			loc: { line: 2, column: 9 },
		}, source);

		expect(diagnostic.phase).toBe('evaluate');
		expect(diagnostic.range).toMatchObject({ line: 2, column: 10 });
		expect(diagnostic.context).toBe('$: s("bd"');
	});

	test('extracts line and column from common parser messages', () => {
		const source = 'const key = "E:minor"\n$: s("bd")';
		const diagnostic = diagnosticFromError(8, new SyntaxError('Unexpected token (2:4)'), source);

		expect(diagnostic.phase).toBe('parse');
		expect(diagnostic.range).toMatchObject({ line: 2, column: 5 });
		expect(diagnostic.context).toBe('$: s("bd")');
	});
});
