import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const controlsPath = resolve(projectRoot, 'node_modules/@strudel/core/controls.mjs');
const outputPath = resolve(projectRoot, 'src/lib/strudel/strudel-controls.generated.ts');

const source = readFileSync(controlsPath, 'utf8');
const stringLiteral = /['"]([^'"\\]*(?:\\.[^'"\\]*)*)['"]/g;

function unescape(value) {
	return value.replace(/\\(['"\\])/g, '$1');
}

function cleanDocLine(line) {
	return line.replace(/^\s*\* ?/, '').trim();
}

function parseDocComment(comment) {
	const lines = comment.split('\n').map(cleanDocLine);
	const name = lines.find((line) => line.startsWith('@name '))?.slice(6).trim();
	if (!name) return undefined;

	const synonyms = lines
		.filter((line) => line.startsWith('@synonyms '))
		.flatMap((line) => line.slice(10).split(',').map((value) => value.trim()))
		.filter(Boolean);
	const parameters = [];
	for (const line of lines) {
		const match = line.match(/^@param\s+\{([^}]+)\}\s+([^\s]+)(?:\s+(.*))?$/);
		if (!match) continue;
		parameters.push({
			name: match[2].replace(/^\[|\]$/g, '').split('=')[0],
			type: match[1],
			description: (match[3] ?? '').trim(),
		});
	}
	const descriptionLines = [];
	for (const line of lines) {
		if (line.startsWith('@')) break;
		if (line && line !== '*') descriptionLines.push(line);
	}

	return {
		name,
		synonyms,
		description: descriptionLines.join(' ').replace(/\s+/g, ' ').trim(),
		parameters,
	};
}

function splitArguments(value) {
	const argumentsList = [];
	let argumentStart = 0;
	let depth = 0;
	let quote;
	let escaped = false;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (quote) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === quote) quote = undefined;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === '(' || character === '[' || character === '{') depth += 1;
		else if (character === ')' || character === ']' || character === '}') depth = Math.max(0, depth - 1);
		else if (character === ',' && depth === 0) {
			argumentsList.push(value.slice(argumentStart, index));
			argumentStart = index + 1;
		}
	}
	argumentsList.push(value.slice(argumentStart));
	return argumentsList;
}

function findRegisterControlCalls() {
	const calls = [];
	const callPattern = /registerControl\s*\(/g;
	let match;
	while ((match = callPattern.exec(source))) {
		const open = match.index + match[0].length - 1;
		let depth = 1;
		let quote;
		let escaped = false;
		let close = open + 1;
		for (; close < source.length; close += 1) {
			const character = source[close];
			if (quote) {
				if (escaped) escaped = false;
				else if (character === '\\') escaped = true;
				else if (character === quote) quote = undefined;
				continue;
			}
			if (character === '"' || character === "'") {
				quote = character;
				continue;
			}
			if (character === '(' || character === '[') depth += 1;
			if (character === ')' || character === ']') {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		if (depth !== 0) continue;
		const argumentSource = source.slice(open + 1, close);
		const argumentParts = splitArguments(argumentSource);
		const firstArgument = argumentParts[0]?.trim() ?? '';
		const firstString = firstArgument.match(/^['"]([^'"\\]*(?:\\.[^'"\\]*)*)['"]/);
		const names = firstArgument.startsWith('[')
			? [...firstArgument.matchAll(stringLiteral)].map((item) => unescape(item[1]))
			: firstString ? [unescape(firstString[1])] : [];
		const aliases = argumentParts.slice(1)
			.flatMap((part) => [...part.matchAll(stringLiteral)].map((item) => unescape(item[1])));
		if (!names.length) continue;
		const exportStart = source.lastIndexOf('export const {', match.index);
		const exportPrefix = exportStart === -1 ? '' : source.slice(exportStart, match.index);
		const exportBody = exportPrefix.match(/export\s+const\s*\{([\s\S]*)\}\s*=\s*$/);
		const exportedNames = exportBody
			? [...exportBody[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((item) => item[0])
			: [];
		const before = source.slice(0, match.index);
		const commentStart = before.lastIndexOf('/**');
		const commentEnd = commentStart === -1 ? -1 : before.indexOf('*/', commentStart);
		const bridge = commentEnd > commentStart ? before.slice(commentEnd + 2) : '';
		const comment = commentStart !== -1 && commentEnd > commentStart && !/\/\*|\/\//.test(bridge) && !/register(?:Multi)?Control\s*\(/.test(bridge)
			? before.slice(commentStart + 3, commentEnd)
			: '';
		calls.push({ names, aliases, exportedNames, doc: parseDocComment(comment) });
		callPattern.lastIndex = close + 1;
	}
	return calls;
}

const controls = new Map();
const aliasTargets = new Map();
for (const call of findRegisterControlCalls()) {
	const method = call.doc?.name && call.exportedNames.includes(call.doc.name) ? call.doc.name : call.names[0];
	const runtimeNames = new Set([...call.names, ...call.aliases, ...call.exportedNames]);
	const aliases = [...new Set([
		call.names[0],
		...call.aliases,
		...(call.doc?.synonyms ?? []).filter((alias) => runtimeNames.has(alias)),
	])]
		.filter((name) => name && name !== method);
	aliasTargets.set(method, method);
	for (const alias of aliases) aliasTargets.set(alias, method);
	const existing = controls.get(method);
	controls.set(method, {
		method,
		aliases: [...new Set([...(existing?.aliases ?? []), ...aliases])].sort(),
		description: call.doc?.description ?? existing?.description ?? '',
		parameters: call.doc?.parameters?.length ? call.doc.parameters : (existing?.parameters ?? []),
	});
}

const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'node_modules/@strudel/core/package.json'), 'utf8'));
const entries = [...controls.values()].sort((left, right) => left.method.localeCompare(right.method));
const output = `/**\n * Generated from @strudel/core/controls.mjs.\n * Run \`bun run effects:generate\` after upgrading Strudel.\n */\n\nexport interface StrudelSourceParameter {\n\tname: string;\n\ttype: string;\n\tdescription: string;\n}\n\nexport interface StrudelSourceControl {\n\tmethod: string;\n\taliases: readonly string[];\n\tdescription: string;\n\tparameters: readonly StrudelSourceParameter[];\n}\n\nexport const STRUDEL_SOURCE_VERSION = ${JSON.stringify(packageJson.version)};\n\nexport const STRUDEL_SOURCE_CONTROLS: readonly StrudelSourceControl[] = ${JSON.stringify(entries, null, '\t')} as const;\n\n/** Final alias targets after applying registerControl calls in source order. */\nexport const STRUDEL_SOURCE_ALIAS_TARGETS: Readonly<Record<string, string>> = ${JSON.stringify(Object.fromEntries([...aliasTargets.entries()].sort(([left], [right]) => left.localeCompare(right))), null, '\t')} as const;\n`;
writeFileSync(outputPath, output);
console.log(`Generated ${entries.length} Strudel controls from ${controlsPath}`);
