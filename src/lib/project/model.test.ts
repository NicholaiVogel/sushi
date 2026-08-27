import { describe, expect, test } from 'bun:test';
import { diagnosticFromError, getSourceIdentityDiagnostics } from './model';

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

	test('preserves the audio-lock code for agent-visible playback diagnostics', () => {
		const error = Object.assign(new Error('Audio is locked.'), { code: 'AUDIO_LOCKED' });
		const diagnostic = diagnosticFromError(9, error);

		expect(diagnostic).toMatchObject({ phase: 'evaluate', code: 'AUDIO_LOCKED', message: 'Audio is locked.' });
	});

	test('reports duplicate explicit track IDs at the later marker', () => {
		const source = [
			'// @sushi-track {"id":"trk_same","name":"One","type":"synth","schema":1}',
			'$: s("bd")',
			'// @sushi-track {"id":"trk_same","name":"Two","type":"synth","schema":1}',
			'$: s("sd")',
		].join('\n');
		const diagnostics = getSourceIdentityDiagnostics(9, source);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			revision: 9,
			phase: 'parse',
			code: 'DUPLICATE_TRACK_ID',
			range: { line: 3 },
			context: '// @sushi-track {"id":"trk_same","name":"Two","type":"synth","schema":1}',
		});
	});
});
