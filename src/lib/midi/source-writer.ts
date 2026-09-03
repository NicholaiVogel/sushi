import { getSourceBlockDetails, getSourceGlobals, replaceSourceTrackExpression, type SourceGlobals } from '../project/source-mapper';
import { midiToNoteName, parseNoteGrid, type NoteGridNote } from '../project/note-grid';
import { midiGridCycles, normalizeMidiNotes, quantizeMidiNotes } from './quantize';
import type { MidiQuantizeGrid, MidiRecordedAutomation, MidiRecordedNote, MidiRecordedTake } from './types';

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

export interface MidiSourceWriteError {
	ok: false;
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

function noteExpression(note: MidiRecordedNote, channel?: number): string {
	const calls = [`note(${quote(midiToNoteName(note.note))})`, `.velocity(${formatNumber(clamp(note.velocity, 0, 1))})`];
	if (channel !== undefined) calls.push(`.midichan(${channel})`);
	return calls.join('');
}

function automationExpression(event: MidiRecordedAutomation): string {
	const calls = ['note("~")'];
	if (event.channel !== undefined) calls.push(`.midichan(${event.channel})`);
	switch (event.kind) {
		case 'controlchange':
			if (event.data[1] !== undefined) calls.push(`.ccn(${event.data[1]}).ccv(${formatNumber(clamp((event.data[2] ?? 0) / 127, 0, 1))})`);
			break;
		case 'pitchbend': {
			const raw = ((event.data[2] ?? 64) << 7) | (event.data[1] ?? 0);
			calls.push(`.midibend(${formatNumber(clamp((raw - 8192) / 8192, -1, 1))})`);
			break;
		}
		case 'channelaftertouch':
		case 'keyaftertouch':
			calls.push(`.miditouch(${formatNumber(clamp((event.data[2] ?? event.data[1] ?? 0) / 127, 0, 1))})`);
			break;
		case 'programchange':
			calls.push(`.progNum(${Math.round(clamp(event.data[1] ?? 0, 0, 127))})`);
			break;
		case 'sysex': {
			const payload = event.data.slice(1, event.data[event.data.length - 1] === 0xf7 ? -1 : undefined);
			const manufacturer = payload.length > 3 && payload[0] === 0 && payload[1] !== undefined && payload[2] !== undefined
				? `[${payload.slice(0, 3).join(', ')}]`
				: String(payload.shift() ?? 0);
			calls.push(`.sysexid(${manufacturer}).sysexdata([${payload.join(', ')}])`);
			break;
		}
		case 'start':
		case 'continue':
		case 'stop':
		case 'clock':
			calls.push(`.midicmd(${quoteStringLiteral(event.kind)})`);
			break;
		default:
			break;
	}
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
	const velocities: number[][] = Array.from({ length: steps }, () => []);
	const noteChannel = channel ?? notes[0].channel;
	for (const note of notes) {
		const index = Math.round((note.startCycle - startCycle) / stepCycle);
		if (index < 0 || index >= steps) return undefined;
		if (Math.abs(note.startCycle - (startCycle + index * stepCycle)) > Math.max(spacing * 0.5, MIN_NOTE_CYCLES * 2)) return undefined;
		if (channel === undefined && note.channel !== noteChannel) return undefined;
		if (tokens[index]) tokens[index] += `,${midiToNoteName(note.note)}`;
		else tokens[index] = midiToNoteName(note.note);
		durations[index] = Math.max(durations[index], Math.min(endCycle - (startCycle + index * stepCycle), Math.max(MIN_NOTE_CYCLES, note.endCycle - note.startCycle)));
		velocities[index].push(clamp(note.velocity, 0, 1));
	}
	const safeTokens = tokens.map((token) => token || '~').join(' ');
	const allVelocities = velocities.flat();
	const velocity = allVelocities.length ? allVelocities.reduce((total, value) => total + value, 0) / allVelocities.length : 0.8;
	const durationValues = durations.map((duration) => formatNumber(duration / totalCycles)).join(' ');
	const durationCall = durations.some((duration) => Math.abs(duration - stepCycle) > 0.000001) ? `.dur(${quote(durationValues)})` : '';
	const pattern = `note(${quote(safeTokens)}).slow(${formatNumber(totalCycles)})${durationCall}.velocity(${formatNumber(clamp(velocity, 0, 1))}).midichan(${noteChannel})`;
	return `seqPLoop([${formatNumber(startCycle)}, ${formatNumber(endCycle)}, ${pattern}])${midiRoute(routeOptions, includeRoute)}`;
}

/** Serialize captured note and automation messages as native timed Strudel sections. */
export function serializeMidiNotes(
	notes: readonly MidiRecordedNote[],
	options: MidiSourceWriteOptions = {},
	automation: readonly MidiRecordedAutomation[] = [],
): { expression: string; startCycle: number; endCycle: number; notes: MidiRecordedNote[]; automation: MidiRecordedAutomation[] } {
	const startCycle = Math.max(0, Number.isFinite(options.startCycle) ? options.startCycle as number : [...notes, ...automation].length ? Math.min(...notes.map((note) => note.startCycle), ...automation.map((event) => event.cycle)) : 0);
	const inferredEnd = notes.length ? Math.max(...notes.map((note) => note.endCycle)) : startCycle + 1;
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
	const normalizedAutomation = automation
		.map((event) => ({ ...event, cycle: clamp(event.cycle, startCycle, Math.max(startCycle, endCycle - MIN_NOTE_CYCLES)) }))
		.sort((left, right) => left.cycle - right.cycle || left.id.localeCompare(right.id));
	const staticExpression = normalizedAutomation.length === 0
		? serializeStaticGrid(normalizedNotes, startCycle, endCycle, options.staticGrid, options.channel, options, options.includeRoute !== false)
		: undefined;
	const parts = [
		...normalizedNotes.map((note) => ({ cycle: note.startCycle, text: `[${formatNumber(note.startCycle)}, ${formatNumber(note.endCycle)}, ${noteExpression(note, options.channel === undefined ? note.channel : options.channel)}]` })),
		...normalizedAutomation.map((event) => {
			const eventEnd = Math.min(endCycle, event.cycle + MIN_NOTE_CYCLES);
			return { cycle: event.cycle, text: `[${formatNumber(event.cycle)}, ${formatNumber(eventEnd)}, ${automationExpression(event)}]` };
		}),
	].sort((left, right) => left.cycle - right.cycle || left.text.localeCompare(right.text)).map((part) => part.text);
	const body = staticExpression ?? (parts.length
		? `seqPLoop(${parts.join(', ')})${midiRoute(options, options.includeRoute !== false)}`
		: `seqPLoop([${formatNumber(startCycle)}, ${formatNumber(endCycle)}, note("~")])${midiRoute(options, options.includeRoute !== false)}`);
	return {
		expression: body,
		startCycle,
		endCycle,
		notes: normalizedNotes,
		automation: normalizedAutomation,
	};
}

function existingGridNotes(source: string, trackId: string, globals: SourceGlobals): MidiRecordedNote[] | undefined {
	const parsed = parseNoteGrid(source, trackId, globals);
	if (!parsed.ok) return undefined;
	const block = getSourceBlockDetails(source).find((candidate) => candidate.id === trackId);
	if (!block) return undefined;
	return parsed.grid.notes.map((note: NoteGridNote) => ({
		id: `existing-${note.id}`,
		note: note.midi,
		velocity: 0.9,
		channel: 1,
		startCycle: block.timing.startCycle + note.startCycle,
		endCycle: block.timing.startCycle + note.startCycle + Math.max(MIN_NOTE_CYCLES, note.durationCycles),
	}));
}

/**
 * Turn a reviewed MIDI take into one ordinary Sushi source transaction. In
 * overdub mode, static note-grid lanes are merged before serialization; source
 * that is procedural is replaced rather than guessed at or silently rewritten.
 */
export function writeMidiTakeToSource(
	source: string,
	take: MidiRecordedTake,
	globals = getSourceGlobals(source),
	options: MidiSourceWriteOptions = {},
): MidiSourceWriteResult | MidiSourceWriteError {
	const block = getSourceBlockDetails(source).find((candidate) => candidate.id === take.trackId);
	if (!block) return { ok: false, error: `The recorded track "${take.trackId}" no longer exists in the source.` };
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
	const startCycle = take.options.mode === 'overdub' ? Math.min(block.timing.startCycle, requestedStartCycle) : requestedStartCycle;
	const requestedEndCycle = Number.isFinite(options.endCycle) ? options.endCycle as number : Math.max(requestedStartCycle + 1, take.endedAtCycle);
	const endCycle = take.options.mode === 'overdub'
		? Math.max(startCycle + MIN_NOTE_CYCLES, block.timing.endCycle, requestedEndCycle)
		: Math.max(startCycle + MIN_NOTE_CYCLES, requestedEndCycle);
	let notes = normalizeMidiNotes(take.notes, startCycle, endCycle);
	if (take.options.quantize !== 'off') {
		notes = quantizeMidiNotes(notes, globals.quarterNotesPerCycle, take.options.quantize, take.options.quantizeStrength, take.options.swing, startCycle, endCycle);
	}

	if (take.options.mode === 'overdub') {
		const existing = existingGridNotes(source, take.trackId, globals);
		if (existing) notes = normalizeMidiNotes([...existing, ...notes], startCycle, endCycle);
	}

	const serialized = serializeMidiNotes(notes, {
		...routeOptions,
		startCycle,
		endCycle,
		...(take.options.quantize === 'off' ? {} : { staticGrid: { quarterNotesPerCycle: globals.quarterNotesPerCycle, grid: take.options.quantize } }),
	}, take.automation);
	const nextSource = replaceSourceTrackExpression(source, take.trackId, ({ label }) => ({ label, expression: serialized.expression }));
	if (nextSource === source) return { ok: false, error: 'The recorded track source could not be updated.' };
	return { ok: true, source: nextSource, notes: serialized.notes, automation: serialized.automation, startCycle: serialized.startCycle, endCycle: serialized.endCycle };
}
