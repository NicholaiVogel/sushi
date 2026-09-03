import type { MidiQuantizeGrid, MidiRecordedNote } from './types';

const MIN_NOTE_CYCLES = 1 / 4096;

/** Return the grid spacing in Strudel cycles for a musical grid. */
export function midiGridCycles(grid: MidiQuantizeGrid, quarterNotesPerCycle: number): number | undefined {
	if (!Number.isFinite(quarterNotesPerCycle) || quarterNotesPerCycle <= 0 || grid === 'off') return undefined;
	const quarter = 1 / quarterNotesPerCycle;
	switch (grid) {
		case '1/4': return quarter;
		case '1/8': return quarter / 2;
		case '1/16': return quarter / 4;
		case '1/32': return quarter / 8;
		case '1/8T': return quarter / 3;
		case '1/16T': return quarter / 6;
		case '1/32T': return quarter / 12;
		default: return undefined;
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function swingTarget(index: number, grid: number, swing: number): number {
	// Swing is expressed as the fraction of a grid cell by which every second
	// subdivision is delayed. Keeping the setting in [0, .5] prevents a target
	// from crossing the following grid line.
	return index * grid + (index % 2 === 1 ? clamp(swing, 0, 0.5) * grid : 0);
}

export function quantizeCycle(value: number, grid: MidiQuantizeGrid, quarterNotesPerCycle: number, strength = 1, swing = 0): number {
	if (!Number.isFinite(value)) return 0;
	const spacing = midiGridCycles(grid, quarterNotesPerCycle);
	if (!spacing) return Math.max(0, value);
	const normalizedStrength = clamp(Number.isFinite(strength) ? strength : 1, 0, 1);
	const lowerIndex = Math.floor(value / spacing);
	const upperIndex = lowerIndex + 1;
	const lower = swingTarget(lowerIndex, spacing, swing);
	const upper = swingTarget(upperIndex, spacing, swing);
	const target = Math.abs(value - lower) <= Math.abs(value - upper) ? lower : upper;
	return Math.max(0, value + (target - value) * normalizedStrength);
}

export function quantizeMidiNotes(
	notes: readonly MidiRecordedNote[],
	quarterNotesPerCycle: number,
	grid: MidiQuantizeGrid,
	strength = 1,
	swing = 0,
	startCycle = 0,
	endCycle = Number.POSITIVE_INFINITY,
): MidiRecordedNote[] {
	return notes
		.map((note) => {
			const startCycleValue = quantizeCycle(note.startCycle, grid, quarterNotesPerCycle, strength, swing);
			const endCycleValue = quantizeCycle(note.endCycle, grid, quarterNotesPerCycle, strength, swing);
			const start = clamp(startCycleValue, startCycle, endCycle);
			if (start >= endCycle) return undefined;
			const end = Math.min(endCycle, Math.max(start + MIN_NOTE_CYCLES, endCycleValue));
			return end > start ? { ...note, startCycle: start, endCycle: end } : undefined;
		})
		.filter((note): note is MidiRecordedNote => note !== undefined)
		.sort((left, right) => left.startCycle - right.startCycle || left.note - right.note || left.id.localeCompare(right.id));
}

export function normalizeMidiNotes(
	notes: readonly MidiRecordedNote[],
	startCycle = 0,
	endCycle = Number.POSITIVE_INFINITY,
): MidiRecordedNote[] {
	return notes
		.map((note) => {
			const start = clamp(note.startCycle, startCycle, endCycle);
			if (start >= endCycle) return undefined;
			const end = Math.min(endCycle, Math.max(start + MIN_NOTE_CYCLES, note.endCycle));
			return end > start ? { ...note, startCycle: start, endCycle: end } : undefined;
		})
		.filter((note): note is MidiRecordedNote => note !== undefined)
		.sort((left, right) => left.startCycle - right.startCycle || left.note - right.note || left.id.localeCompare(right.id));
}
