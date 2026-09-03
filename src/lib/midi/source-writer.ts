import { getSourceBlockDetails, getSourceGlobals, type SourceBlockDetails } from '../project/source-mapper';
import { midiToNoteName } from '../project/note-grid';
import { midiGridCycles, normalizeMidiNotes, quantizeMidiNotes } from './quantize';
import type { MidiQuantizeGrid, MidiRecordedAutomation, MidiRecordedNote, MidiRecordedTake } from './types';

export const MIDI_GENERATED_REGION_START = '/* @sushi-midi-generated:start */';
export const MIDI_GENERATED_REGION_END = '/* @sushi-midi-generated:end */';

const NUMBER_PRECISION = 1_000_000;
const MIN_NOTE_CYCLES = 1 / 4096;

export interface MidiSourceWriteOptions {
	/** Local Strudel instrument used by a MIDI track after recording. */
	instrument?: string | null;
	outputName?: string | null;
	channel?: number;
	velocity?: number;
	gain?: number;
	noteOffsetMs?: number;
	midimap?: string;
	program?: number;
	startCycle?: number;
	endCycle?: number;
	includeRoute?: boolean;
	staticGrid?: { quarterNotesPerCycle: number; grid: MidiQuantizeGrid };
}

export interface MidiSourceWriteResult {
	ok: true;
	source: string;
	notes: MidiRecordedNote[];
	automation: MidiRecordedAutomation[];
	startCycle: number;
	endCycle: number;
}

export type MidiSourceWriteErrorCode = 'EMPTY_TAKE' | 'MISSING_TRACK' | 'UNOWNED_TRACK' | 'UNSUPPORTED_AUTOMATION' | 'UNSUPPORTED_OVERDUB' | 'INVALID_NOTE' | 'MISSING_GENERATED_REGION' | 'WRITE_FAILED';

export interface MidiSourceWriteError {
	ok: false;
	code: MidiSourceWriteErrorCode;
	error: string;
}

function formatNumber(value: number): string {
	return String(Math.round(value * NUMBER_PRECISION) / NUMBER_PRECISION);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function quote(value: string): string {
	return JSON.stringify(value);
}

/** Strudel treats double-quoted arguments as mini-notation patterns. */
function quoteStringLiteral(value: string): string {
	return `'${value
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n')
		.replace(/\t/g, '\\t')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029')}'`;
}

function noteExpression(note: MidiRecordedNote): string {
	const calls = [`note(${quote(midiToNoteName(note.note))})`, `.velocity(${formatNumber(note.velocity)})`, `.midichan(${note.channel})`];
	return calls.join('');
}


function midiRoute(options: Pick<MidiSourceWriteOptions, 'instrument' | 'outputName' | 'velocity' | 'gain' | 'noteOffsetMs' | 'midimap' | 'program'>, includeRoute: boolean): string {
	const instrument = options.instrument?.trim() ? `.s(${quote(options.instrument.trim())})` : '';
	if (!includeRoute) return instrument;
	const optionEntries = [
		...(options.velocity === undefined ? [] : [`velocity: ${formatNumber(clamp(options.velocity, 0, 1))}`]),
		...(options.gain === undefined ? [] : [`gain: ${formatNumber(clamp(options.gain, 0, 1))}`]),
		...(options.noteOffsetMs === undefined ? [] : [`noteOffsetMs: ${formatNumber(Math.max(0, options.noteOffsetMs))}`]),
		...(options.midimap?.trim() ? [`midimap: ${quoteStringLiteral(options.midimap.trim())}`] : []),
	].join(', ');
	const routeOptions = optionEntries ? `{ ${optionEntries} }` : '';
	const output = options.outputName?.trim() ? quoteStringLiteral(options.outputName.trim()) : '';
	const midi = output ? `.midi(${output}${routeOptions ? `, ${routeOptions}` : ''})` : routeOptions ? `.midi(${routeOptions})` : '.midi()';
	return `${instrument}${midi}${options.program === undefined ? '' : `.progNum(${Math.round(clamp(options.program, 0, 127))})`}`;
}

function serializeStaticGrid(
	notes: readonly MidiRecordedNote[],
	startCycle: number,
	endCycle: number,
	grid: { quarterNotesPerCycle: number; grid: MidiQuantizeGrid } | undefined,
	channel: number | undefined,
	routeOptions: MidiSourceWriteOptions,
	includeRoute: boolean,
): string | undefined {
	if (!grid || grid.grid === 'off' || notes.length === 0) return undefined;
	const spacing = midiGridCycles(grid.grid, grid.quarterNotesPerCycle);
	const totalCycles = endCycle - startCycle;
	if (!spacing || totalCycles <= 0) return undefined;
	// Keep the recorded span intact even when Stop lands between two grid
	// boundaries. The resulting grid is still editable, while its step size is
	// the closest practical representation of the selected quantize grid.
	const steps = Math.max(1, Math.round(totalCycles / spacing));
	if (steps > 1024) return undefined;
	const stepCycle = totalCycles / steps;
	const tokens = Array.from({ length: steps }, () => '');
	const durations = Array.from({ length: steps }, () => stepCycle);
	const noteDurations: number[][] = Array.from({ length: steps }, () => []);
	const velocities: number[][] = Array.from({ length: steps }, () => []);
	const noteChannel = notes[0]?.channel;
	if (noteChannel === undefined || notes.some((note) => note.channel !== noteChannel)) return undefined;
	if (channel !== undefined && notes.some((note) => note.channel !== channel)) return undefined;
	for (const note of notes) {
		const index = Math.round((note.startCycle - startCycle) / stepCycle);
		if (index < 0 || index >= steps) return undefined;
		if (Math.abs(note.startCycle - (startCycle + index * stepCycle)) > Math.max(spacing * 0.5, MIN_NOTE_CYCLES * 2)) return undefined;
		if (tokens[index]) tokens[index] += `,${midiToNoteName(note.note)}`;
		else tokens[index] = midiToNoteName(note.note);
		const duration = Math.min(endCycle - (startCycle + index * stepCycle), Math.max(MIN_NOTE_CYCLES, note.endCycle - note.startCycle));
		const existingDuration = noteDurations[index][0];
		if (existingDuration !== undefined && Math.abs(existingDuration - duration) > 0.000001) return undefined;
		noteDurations[index].push(duration);
		durations[index] = duration;
		velocities[index].push(note.velocity);
	}
	const safeTokens = tokens.map((token) => token || '~').join(' ');
	const allVelocities = velocities.flat();
	if (!allVelocities.length) return undefined;
	const velocity = allVelocities[0];
	if (allVelocities.some((value) => Math.abs(value - velocity) > 0.000001)) return undefined;
	const durationValues = durations.map((duration) => formatNumber(duration / totalCycles)).join(' ');
	const durationCall = durations.some((duration) => Math.abs(duration - stepCycle) > 0.000001) ? `.dur(${quote(durationValues)})` : '';
	const pattern = `note(${quote(safeTokens)}).slow(${formatNumber(totalCycles)})${durationCall}.velocity(${formatNumber(velocity)}).midichan(${noteChannel})`;
	return `seqPLoop([${formatNumber(startCycle)}, ${formatNumber(endCycle)}, ${pattern}])${midiRoute(routeOptions, includeRoute)}`;
}

function validRecordedNote(note: MidiRecordedNote): boolean {
	return Number.isInteger(note.note) && note.note >= 0 && note.note <= 127
		&& Number.isFinite(note.velocity) && note.velocity >= 0 && note.velocity <= 1
		&& Number.isFinite(note.channel) && Number.isInteger(note.channel) && note.channel >= 1 && note.channel <= 16
		&& Number.isFinite(note.startCycle) && Number.isFinite(note.endCycle) && note.endCycle > note.startCycle;
}

export type MidiSourceSerializationResult = {
	ok: true;
	expression: string;
	startCycle: number;
	endCycle: number;
	notes: MidiRecordedNote[];
	automation: MidiRecordedAutomation[];
} | MidiSourceWriteError;

/** Serialize captured notes as native timed Strudel sections. Automation is intentionally review-only until its event semantics are proven. */
export function serializeMidiNotes(
	notes: readonly MidiRecordedNote[],
	options: MidiSourceWriteOptions = {},
	automation: readonly MidiRecordedAutomation[] = [],
): MidiSourceSerializationResult {
	if (!notes.length) return { ok: false, code: 'EMPTY_TAKE', error: 'Nothing was recorded; the project source was not changed.' };
	if (automation.length) return { ok: false, code: 'UNSUPPORTED_AUTOMATION', error: 'MIDI automation capture is not supported for source commit yet; the project source was not changed.' };
	if (notes.some((note) => !validRecordedNote(note))) return { ok: false, code: 'INVALID_NOTE', error: 'The MIDI take contains a note with invalid pitch, velocity, channel, or timing data; the project source was not changed.' };

	const startCycle = Math.max(0, Number.isFinite(options.startCycle) ? options.startCycle as number : Math.min(...notes.map((note) => note.startCycle)));
	const inferredEnd = Math.max(...notes.map((note) => note.endCycle));
	const endCycle = Math.max(startCycle + MIN_NOTE_CYCLES, Number.isFinite(options.endCycle) ? options.endCycle as number : inferredEnd);
	const normalizedNotes = notes
		.map((note) => {
			const noteStart = clamp(note.startCycle, startCycle, endCycle);
			if (noteStart >= endCycle) return undefined;
			const noteEnd = Math.min(endCycle, Math.max(noteStart + MIN_NOTE_CYCLES, note.endCycle));
			return noteEnd > noteStart ? { ...note, startCycle: noteStart, endCycle: noteEnd } : undefined;
		})
		.filter((note): note is MidiRecordedNote => note !== undefined)
		.sort((left, right) => left.startCycle - right.startCycle || left.note - right.note || left.id.localeCompare(right.id));
	if (!normalizedNotes.length) return { ok: false, code: 'EMPTY_TAKE', error: 'Nothing was recorded in the selected source range; the project source was not changed.' };

	const staticExpression = options.staticGrid
		? serializeStaticGrid(normalizedNotes, startCycle, endCycle, options.staticGrid, options.channel, options, options.includeRoute !== false)
		: undefined;
	const parts = normalizedNotes
		.map((note) => `[${formatNumber(note.startCycle)}, ${formatNumber(note.endCycle)}, ${noteExpression(note)}]`)
		.join(', ');
	const body = staticExpression ?? `seqPLoop(${parts})${midiRoute(options, options.includeRoute !== false)}`;
	return {
		ok: true,
		expression: body,
		startCycle,
		endCycle,
		notes: normalizedNotes,
		automation: [],
	};
}

function replaceGeneratedMidiRegion(source: string, block: SourceBlockDetails, replacement: string): string | undefined {
	if (!block.expression || !block.expressionRange || block.generated !== 'midi-recording') return undefined;
	const blockText = source.slice(block.expressionRange.start, block.expressionRange.end);
	const start = blockText.indexOf(MIDI_GENERATED_REGION_START);
	const end = blockText.indexOf(MIDI_GENERATED_REGION_END, start + MIDI_GENERATED_REGION_START.length);
	if (start < 0 || end < 0 || end <= start) return undefined;
	if (blockText.indexOf(MIDI_GENERATED_REGION_START, start + MIDI_GENERATED_REGION_START.length) >= 0) return undefined;
	if (blockText.indexOf(MIDI_GENERATED_REGION_END, end + MIDI_GENERATED_REGION_END.length) >= 0) return undefined;

	const regionStart = block.expressionRange.start + start + MIDI_GENERATED_REGION_START.length;
	const regionEnd = block.expressionRange.start + end;
	const currentRegion = source.slice(regionStart, regionEnd);
	const leadingWhitespace = currentRegion.match(/^\s*/)?.[0] ?? '';
	const trailingWhitespace = currentRegion.match(/\s*$/)?.[0] ?? '';
	if (leadingWhitespace.length + trailingWhitespace.length > currentRegion.length) return undefined;
	return `${source.slice(0, regionStart)}${leadingWhitespace}${replacement}${trailingWhitespace}${source.slice(regionEnd)}`;
}

/** Turn a reviewed replace-mode MIDI take into a transaction for an explicitly owned generated region. */
export function writeMidiTakeToSource(
	source: string,
	take: MidiRecordedTake,
	globals = getSourceGlobals(source),
	options: MidiSourceWriteOptions = {},
): MidiSourceWriteResult | MidiSourceWriteError {
	if (!take.notes.length && !take.automation.length) return { ok: false, code: 'EMPTY_TAKE', error: 'Nothing was recorded; the project source was not changed.' };
	if (take.automation.length) return { ok: false, code: 'UNSUPPORTED_AUTOMATION', error: 'MIDI automation capture is not supported for source commit yet; the project source was not changed.' };
	if (take.options.mode === 'overdub') return { ok: false, code: 'UNSUPPORTED_OVERDUB', error: 'MIDI overdub cannot safely preserve the existing source notes yet; the project source was not changed.' };

	const block = getSourceBlockDetails(source).find((candidate) => candidate.id === take.trackId);
	if (!block) return { ok: false, code: 'MISSING_TRACK', error: `The recorded track "${take.trackId}" no longer exists in the source.` };
	if (block.type !== 'midi' || block.generated !== 'midi-recording') return {
		ok: false,
		code: 'UNOWNED_TRACK',
		error: 'The selected track is not an explicitly generated MIDI recording lane, so it cannot be safely rewritten; the project source was not changed.',
	};
	if (!replaceGeneratedMidiRegion(source, block, '')) return {
		ok: false,
		code: 'MISSING_GENERATED_REGION',
		error: 'The selected MIDI lane has no valid generated recording region, so it cannot be safely rewritten; the project source was not changed.',
	};

	const inheritedRoute = block.midi;
	const routeOptions: MidiSourceWriteOptions = {
		...options,
		...(options.instrument === undefined && typeof block.instrument === 'string' ? { instrument: block.instrument } : {}),
		...(options.outputName === undefined && typeof inheritedRoute?.output === 'string' ? { outputName: inheritedRoute.output } : {}),
		...(options.channel === undefined && inheritedRoute?.channel !== undefined ? { channel: inheritedRoute.channel } : {}),
		...(options.velocity === undefined && inheritedRoute?.velocity !== undefined ? { velocity: inheritedRoute.velocity } : {}),
		...(options.gain === undefined && inheritedRoute?.gain !== undefined ? { gain: inheritedRoute.gain } : {}),
		...(options.noteOffsetMs === undefined && inheritedRoute?.noteOffsetMs !== undefined ? { noteOffsetMs: inheritedRoute.noteOffsetMs } : {}),
		...(options.midimap === undefined && inheritedRoute?.midimap !== undefined ? { midimap: inheritedRoute.midimap } : {}),
		...(options.program === undefined && inheritedRoute?.program !== undefined ? { program: inheritedRoute.program } : {}),
	};
	const requestedStartCycle = Number.isFinite(options.startCycle) ? options.startCycle as number : Math.max(0, take.startedAtCycle);
	const startCycle = requestedStartCycle;
	const requestedEndCycle = Number.isFinite(options.endCycle) ? options.endCycle as number : Math.max(requestedStartCycle + 1, take.endedAtCycle);
	const endCycle = Math.max(startCycle + MIN_NOTE_CYCLES, requestedEndCycle);
	let notes = normalizeMidiNotes(take.notes, startCycle, endCycle);
	if (take.options.quantize !== 'off') {
		notes = quantizeMidiNotes(notes, globals.quarterNotesPerCycle, take.options.quantize, take.options.quantizeStrength, take.options.swing, startCycle, endCycle);
	}
	if (!notes.length) return { ok: false, code: 'EMPTY_TAKE', error: 'Nothing was recorded in the selected source range; the project source was not changed.' };

	const serialized = serializeMidiNotes(notes, {
		...routeOptions,
		startCycle,
		endCycle,
		...(take.options.quantize === 'off' ? {} : { staticGrid: { quarterNotesPerCycle: globals.quarterNotesPerCycle, grid: take.options.quantize } }),
	});
	if (!serialized.ok) return serialized;
	const nextSource = replaceGeneratedMidiRegion(source, block, serialized.expression);
	if (nextSource === undefined || nextSource === source) return { ok: false, code: 'WRITE_FAILED', error: 'The generated MIDI recording region could not be updated; the project source was not changed.' };
	return { ok: true, source: nextSource, notes: serialized.notes, automation: serialized.automation, startCycle: serialized.startCycle, endCycle: serialized.endCycle };
}
