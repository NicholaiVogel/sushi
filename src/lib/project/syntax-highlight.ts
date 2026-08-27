function escapeHighlightHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function highlightToken(className: string, value: string): string {
	return `<span class="${className}">${escapeHighlightHtml(value)}</span>`;
}

/**
 * Highlight the JavaScript/Strudel subset used by the source editor.
 *
 * This intentionally stays dependency-free: the textarea remains the editable
 * and accessible control, while a read-only pre underneath provides visual
 * token colors without changing the source document or evaluation semantics.
 */
export function highlightStrudel(source: string): string {
	const keywords = new Set(['const', 'let', 'var', 'function', 'return', 'await', 'async', 'if', 'else', 'true', 'false', 'null', 'undefined']);
	let output = '';
	let index = 0;

	while (index < source.length) {
		const current = source[index];
		if (current === '/' && source[index + 1] === '/') {
			const end = source.indexOf('\n', index);
			const commentEnd = end === -1 ? source.length : end;
			output += highlightToken('source-token-comment', source.slice(index, commentEnd));
			index = commentEnd;
			continue;
		}

		if (current === '"' || current === "'" || current === '`') {
			const quote = current;
			let end = index + 1;
			while (end < source.length) {
				if (source[end] === '\\') {
					end += 2;
					continue;
				}
				if (source[end] === quote) {
					end += 1;
					break;
				}
				end += 1;
			}
			output += highlightToken('source-token-string', source.slice(index, end));
			index = end;
			continue;
		}

		const number = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
		if (number) {
			output += highlightToken('source-token-number', number[0]);
			index += number[0].length;
			continue;
		}

		const sourceLabel = ['_$:', 'S$:', '$:'].find((candidate) => source.startsWith(candidate, index));
		if (sourceLabel) {
			output += highlightToken('source-token-label', sourceLabel);
			index += sourceLabel.length;
			continue;
		}

		if (source.startsWith('=>', index)) {
			output += highlightToken('source-token-operator', '=>');
			index += 2;
			continue;
		}

		const identifier = source.slice(index).match(/^[A-Za-z_$][\w$]*/);
		if (identifier) {
			const value = identifier[0];
			const afterIdentifier = source.slice(index + value.length);
			const nextNonWhitespace = afterIdentifier.match(/^\s*([(:])/);
			const isLabel = value.endsWith('$') && nextNonWhitespace?.[1] === ':';
			const isProperty = source[index - 1] === '.';
			const isFunction = nextNonWhitespace?.[1] === '(';
			const className = isLabel
				? 'source-token-label'
				: keywords.has(value) ? 'source-token-keyword' : isProperty ? 'source-token-property' : isFunction ? 'source-token-function' : 'source-token-identifier';
			output += highlightToken(className, value);
			index += value.length;
			continue;
		}

		if ('=.!<>+-*/%&|?:'.includes(current)) {
			output += highlightToken('source-token-operator', current);
			index += 1;
			continue;
		}

		output += escapeHighlightHtml(current);
		index += 1;
	}

	return output;
}
