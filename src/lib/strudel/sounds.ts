import {
	STRUDEL_SOURCE_SOUNDS,
	STRUDEL_SOUND_SOURCE_VERSIONS,
	type StrudelSourceSound,
} from './strudel-sounds.generated';

/** The source families exposed by Strudel's sound registrations and maps. */
export type StrudelSoundType = 'synth' | 'sample' | 'soundfont' | 'noise' | 'wavetable' | 'input' | 'unknown';

/** Framework-independent metadata used by selectors, parsers, and editors. */
export interface StrudelSoundDefinition {
	id: string;
	label: string;
	type: StrudelSoundType;
	category: string;
	aliases: readonly string[];
	source: string;
	sourceVersion?: string;
}

export interface StrudelSoundQuery {
	query?: string;
	type?: StrudelSoundType;
	category?: string;
	limit?: number;
}

export type StrudelSoundArgumentKind = 'static' | 'dynamic';

/** A source argument retains its original expression even when it is unknown. */
export interface ParsedStrudelSoundArgument {
	expression: string;
	kind: StrudelSoundArgumentKind;
	value?: string;
	token?: string;
	definition?: StrudelSoundDefinition;
}

export const STRUDEL_SOUND_DEFINITIONS: readonly StrudelSoundDefinition[] = Object.freeze(
	STRUDEL_SOURCE_SOUNDS.map((sound) => normalizeGeneratedSound(sound)),
);

export const STRUDEL_SOUND_VERSIONS = STRUDEL_SOUND_SOURCE_VERSIONS;

const definitionsById = new Map<string, StrudelSoundDefinition>();
const definitionsByAlias = new Map<string, StrudelSoundDefinition>();
for (const definition of STRUDEL_SOUND_DEFINITIONS) {
	definitionsById.set(normalizeSoundId(definition.id), definition);
	for (const alias of definition.aliases) definitionsByAlias.set(normalizeSoundId(alias), definition);
}

const soundTokenPattern = /[A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z0-9_.-]+)?(?:[!*][A-Za-z0-9_.-]+)*/g;
const modifierPattern = /(?:[:][^!*<>\s]+|[!*][^:<>\s]+)+$/g;

function normalizeGeneratedSound(sound: StrudelSourceSound): StrudelSoundDefinition {
	const type: StrudelSoundType = sound.type === 'synth'
		|| sound.type === 'sample'
		|| sound.type === 'soundfont'
		|| sound.type === 'noise'
		|| sound.type === 'wavetable'
		|| sound.type === 'input'
		? sound.type
		: 'unknown';
	return Object.freeze({
		id: sound.id,
		label: sound.label,
		type,
		category: sound.category,
		aliases: Object.freeze([...sound.aliases]),
		source: sound.source,
		...(sound.sourceVersion ? { sourceVersion: sound.sourceVersion } : {}),
	});
}

export function normalizeSoundId(value: string): string {
	return value.trim().toLowerCase();
}

function unmodifiedSoundToken(token: string): string {
	return token.trim().replace(modifierPattern, '');
}

/**
 * Extract the first sound-like token from a Strudel sound expression. This is
 * intentionally permissive: a custom or future sound remains visible even if
 * it is not in Sushi's generated catalog.
 */
export function extractStrudelSoundToken(value: string | undefined): string | undefined {
	return extractStrudelSoundTokens(value)[0];
}

/** Extract every sound-like token from a static pattern value. */
export function extractStrudelSoundTokens(value: string | undefined): string[] {
	if (!value) return [];
	return [...value.matchAll(soundTokenPattern)].map(([token]) => token);
}

/** Remove Strudel's pattern qualifiers (`:2`, `!4`, `*16`) from a token. */
export function normalizeStrudelSoundToken(token: string): string {
	return normalizeSoundId(unmodifiedSoundToken(token));
}

function lookupToken(value: string | undefined): string | undefined {
	const token = extractStrudelSoundToken(value);
	if (!token) return undefined;
	return normalizeStrudelSoundToken(token);
}

/** Find a catalog entry by an id, alias, or a pattern-qualified sound token. */
export function getStrudelSoundDefinition(value: string | undefined): StrudelSoundDefinition | undefined {
	const token = lookupToken(value);
	if (!token) return undefined;
	return definitionsById.get(token) ?? definitionsByAlias.get(token);
}

function decodeStringLiteral(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed.length < 2) return undefined;
	const quote = trimmed[0];
	if (!['"', "'", '`'].includes(quote) || trimmed.at(-1) !== quote) return undefined;
	const contents = trimmed.slice(1, -1);
	if (quote === '"') {
		try {
			const decoded = JSON.parse(trimmed) as unknown;
			return typeof decoded === 'string' ? decoded : contents;
		} catch {
			// Fall through to the small escape set shared by JS string forms.
		}
	}
	return contents.replace(/\\([\\'"`])/g, '$1');
}

/** Parse the first `.s(...)`/`.sound(...)` argument without rejecting custom expressions. */
export function parseStrudelSoundArgument(argument: string | undefined): ParsedStrudelSoundArgument | undefined {
	if (argument === undefined) return undefined;
	const expression = argument.trim();
	if (!expression) return undefined;
	const value = decodeStringLiteral(expression);
	const token = extractStrudelSoundToken(value ?? expression);
	const definition = getStrudelSoundDefinition(token ?? value ?? expression);
	return {
		expression,
		kind: value === undefined ? 'dynamic' : 'static',
		...(value === undefined ? {} : { value }),
		...(token ? { token } : {}),
		...(definition ? { definition } : {}),
	};
}

function matchesDefinition(definition: StrudelSoundDefinition, query: string): { score: number; matched: boolean } {
	const fields = [definition.id, definition.label, definition.category, ...definition.aliases].map((field) => normalizeSoundId(field));
	let score = Number.POSITIVE_INFINITY;
	for (const [index, field] of fields.entries()) {
		if (field === query) score = Math.min(score, index === 0 ? 0 : 1);
		else if (field.startsWith(query)) score = Math.min(score, index === 0 ? 2 : 3);
		else if (field.includes(query)) score = Math.min(score, index === 0 ? 4 : 5);
	}
	return { score, matched: Number.isFinite(score) };
}

/** List catalog entries, optionally filtering by type, category, and search text. */
export function listStrudelSounds(options: StrudelSoundQuery = {}): StrudelSoundDefinition[] {
	const query = normalizeSoundId(options.query ?? '');
	const category = normalizeSoundId(options.category ?? '');
	const candidates = STRUDEL_SOUND_DEFINITIONS
		.filter((definition) => !options.type || definition.type === options.type)
		.filter((definition) => !category || normalizeSoundId(definition.category) === category)
		.map((definition) => ({ definition, match: query ? matchesDefinition(definition, query) : { score: 0, matched: true } }))
		.filter(({ match }) => match.matched)
		.sort((left, right) => left.match.score - right.match.score
			|| left.definition.category.localeCompare(right.definition.category)
			|| left.definition.label.localeCompare(right.definition.label)
			|| left.definition.id.localeCompare(right.definition.id))
		.map(({ definition }) => definition);
	const limit = options.limit === undefined ? candidates.length : Math.max(0, Math.floor(options.limit));
	return candidates.slice(0, limit);
}

/** Search is a named alias so callers do not need to construct query objects. */
export function searchStrudelSounds(query: string, options: Omit<StrudelSoundQuery, 'query'> = {}): StrudelSoundDefinition[] {
	return listStrudelSounds({ ...options, query });
}
