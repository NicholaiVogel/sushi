/**
 * Return one gutter entry for every logical source line.
 *
 * Keeping this separate from the rendered editor makes the line model easy to
 * test and ensures an empty source still has a visible first line.
 */
export function getSourceLineNumbers(source: string): number[] {
	return Array.from({ length: Math.max(1, source.split('\n').length) }, (_, index) => index + 1);
}
