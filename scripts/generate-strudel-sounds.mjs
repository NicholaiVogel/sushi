import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');

function firstExisting(paths) {
	return paths.find((path) => existsSync(path));
}

function readText(paths) {
	const path = firstExisting(paths);
	return path ? { path, source: readFileSync(path, 'utf8') } : undefined;
}

function readPackageVersion(packageName) {
	const packagePath = resolve(projectRoot, 'node_modules', packageName, 'package.json');
	if (!existsSync(packagePath)) return undefined;
	return JSON.parse(readFileSync(packagePath, 'utf8')).version;
}

function stringLiterals(value) {
	return [...value.matchAll(/['"]([^'"\\]*(?:\\.[^'"\\]*)*)['"]/g)]
		.map((match) => match[1].replace(/\\(['"\\`])/g, '$1'));
}

function arrayAfter(source, declaration) {
	const match = source.match(new RegExp(`${declaration}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
	return match ? stringLiterals(match[1]) : [];
}

function registerSoundNames(source) {
	return [...source.matchAll(/registerSound\s*\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function labelFromIdentifier(identifier) {
	const isGeneralMidi = /^gm_/i.test(identifier);
	const words = identifier
		.replace(/^gm_/i, '')
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z])([0-9])/gi, '$1 $2')
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => {
			if (['bd', 'cp', 'cr', 'hh', 'ht', 'lt', 'mt', 'oh', 'rd', 'sd', 'tb'].includes(word.toLowerCase())) return word.toUpperCase();
			return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
		})
		.join(' ');
	return isGeneralMidi ? `GM ${words}` : words;
}

function categoryForSample(id, mapName) {
	if (mapName === 'piano.json') return 'piano';
	if (mapName === 'tidal-drum-machines.json') return 'drum-machine';
	if (mapName === 'uzu-drumkit.json') return 'drum-kit';
	if (mapName === 'mridangam.json') return 'world-percussion';
	if (mapName === 'vcsl.json') return 'acoustic-percussion';
	if (mapName === 'uzu-wavetables.json') return 'wavetable';
	return 'sample';
}

function sourceMapEntries(mapPath) {
	if (!mapPath) return [];
	try {
		const map = JSON.parse(readFileSync(mapPath, 'utf8'));
		return Object.keys(map)
			.filter((id) => id !== '_base' && id.trim())
			.map((id) => ({ id, label: labelFromIdentifier(id), map: mapPath.split('/').pop() }));
	} catch (error) {
		console.warn(`Could not read Strudel sample map ${mapPath}: ${error instanceof Error ? error.message : String(error)}`);
		return [];
	}
}

const synthSource = readText([
	resolve(projectRoot, 'node_modules/superdough/synth.mjs'),
	resolve(projectRoot, '../strudel/packages/superdough/synth.mjs'),
]);
const helpersSource = readText([
	resolve(projectRoot, 'node_modules/superdough/helpers.mjs'),
	resolve(projectRoot, '../strudel/packages/superdough/helpers.mjs'),
]);
const zzfxSource = readText([
	resolve(projectRoot, 'node_modules/superdough/zzfx.mjs'),
	resolve(projectRoot, '../strudel/packages/superdough/zzfx.mjs'),
]);
const soundfontSource = firstExisting([
	resolve(projectRoot, 'node_modules/@strudel/soundfonts/gm.mjs'),
	resolve(projectRoot, '../strudel/packages/soundfonts/gm.mjs'),
]);

const entries = new Map();
const add = (definition) => {
	const key = definition.id.toLowerCase();
	const existing = entries.get(key);
	if (!existing) {
		entries.set(key, definition);
		return;
	}
	const aliases = [...new Set([...(existing.aliases ?? []), ...(definition.aliases ?? [])])].filter((alias) => alias !== existing.id);
	entries.set(key, { ...existing, aliases: aliases.sort() });
};

if (synthSource) {
	const waveforms = arrayAfter(synthSource.source, 'const waveforms');
	const waveformAliases = [...synthSource.source.matchAll(/\[\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\]/g)]
		.map((match) => ({ alias: match[1], target: match[2] }));
	const aliasesByTarget = new Map();
	for (const { alias, target } of waveformAliases) {
		const aliases = aliasesByTarget.get(target) ?? [];
		aliases.push(alias);
		aliasesByTarget.set(target, aliases);
	}
	for (const id of waveforms) {
		add({
			id,
			label: labelFromIdentifier(id),
			type: 'synth',
			category: 'waveform',
			aliases: (aliasesByTarget.get(id) ?? []).sort(),
			source: 'superdough/synth.mjs',
		});
	}
	for (const id of registerSoundNames(synthSource.source)) {
		if (entries.has(id.toLowerCase())) continue;
		add({
			id,
			label: labelFromIdentifier(id),
			type: id === 'bus' ? 'input' : 'synth',
			category: id === 'bus' ? 'routing' : 'synth',
			aliases: [],
			source: 'superdough/synth.mjs',
		});
	}
}

if (helpersSource) {
	for (const id of arrayAfter(helpersSource.source, 'export const noises')) {
		add({
			id,
			label: `${labelFromIdentifier(id)} noise`,
			type: 'noise',
			category: 'noise',
			aliases: [],
			source: 'superdough/helpers.mjs',
		});
	}
}

if (zzfxSource) {
	const match = zzfxSource.source.match(/\[([^\]]+)\]\.forEach\(\(wave\)/);
	for (const id of (match ? stringLiterals(match[1]) : [])) {
		add({
			id,
			label: labelFromIdentifier(id),
			type: 'synth',
			category: 'zzfx',
			aliases: [],
			source: 'superdough/zzfx.mjs',
		});
	}
}

if (soundfontSource) {
	const source = readFileSync(soundfontSource, 'utf8');
	for (const [, id] of source.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\[/gm)) {
		add({
			id,
			label: labelFromIdentifier(id),
			type: 'soundfont',
			category: 'general-midi',
			aliases: [],
			source: '@strudel/soundfonts/gm.mjs',
		});
	}
}

// The local Strudel checkout includes the same public manifests used by the
// website's prebake. Prefer those manifests when present; the generated file
// remains checked in so a deployment does not need the sibling checkout.
const sourceRoot = process.env.STRUDEL_SOURCE_ROOT ?? resolve(projectRoot, '../strudel');
const publicRoot = resolve(sourceRoot, 'website/public');
for (const mapName of ['piano.json', 'tidal-drum-machines.json', 'uzu-drumkit.json', 'mridangam.json', 'vcsl.json', 'uzu-wavetables.json']) {
	const mapPath = firstExisting([
		resolve(publicRoot, mapName),
		resolve(projectRoot, 'public', mapName),
	]);
	for (const entry of sourceMapEntries(mapPath)) {
		add({
			id: entry.id,
			label: entry.label,
			type: entry.map === 'uzu-wavetables.json' ? 'wavetable' : 'sample',
			category: categoryForSample(entry.id, entry.map),
			aliases: [],
			source: `strudel sample map: ${entry.map}`,
		});
	}
}

const sourceVersions = {
	webaudio: readPackageVersion('@strudel/webaudio'),
	soundfonts: readPackageVersion('@strudel/soundfonts'),
	superdough: readPackageVersion('superdough'),
};
const versionLabel = Object.entries(sourceVersions)
	.filter(([, version]) => version)
	.map(([name, version]) => `${name}@${version}`)
	.join(', ');
const outputEntries = [...entries.values()]
	.map((entry) => ({ ...entry, sourceVersion: versionLabel || undefined }))
	.sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));

const outputPath = resolve(projectRoot, 'src/lib/strudel/strudel-sounds.generated.ts');
const output = `/**
 * Generated from Strudel's sound registrations and public sample manifests.
 * Run \`bun run sounds:generate\` after upgrading Strudel or its sample maps.
 */

export interface StrudelSourceSound {
	id: string;
	label: string;
	type: string;
	category: string;
	aliases: readonly string[];
	source: string;
	sourceVersion?: string;
}

export const STRUDEL_SOUND_SOURCE_VERSIONS = ${JSON.stringify(sourceVersions, null, '\t')} as const;

export const STRUDEL_SOURCE_SOUNDS: readonly StrudelSourceSound[] = ${JSON.stringify(outputEntries, null, '\t')} as const;
`;
writeFileSync(outputPath, output);
console.log(`Generated ${outputEntries.length} Strudel sounds from ${synthSource?.path ?? 'no synth source'}, ${soundfontSource ?? 'no soundfont source'}, and public sample manifests under ${publicRoot}`);
