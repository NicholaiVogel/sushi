import { describe, expect, test } from 'bun:test';
import { extendNoteGridSourceRange, midiToNoteName, parseNoteGrid, snapMidiToNoteGrid, trimNoteGridSourceRange, updateNoteGridSource } from './note-grid';
import { updateTrackRange } from './source-mapper';

const NOTE_SOURCE = `setcpm(120 / 4)
const key = "C:minor"
// @sushi-track {"id":"trk_notes","name":"Notes","type":"synth","schema":1}
$: note("c4 ~ eb4 g4").s("triangle")
`;

describe('note grid source mapping', () => {
	test('parses a flat note grid and derives cell durations', () => {
		const chord = parseNoteGrid(NOTE_SOURCE.replace('c4 ~', 'c4, e4 ~'), 'trk_notes');
		expect(chord.ok).toBe(true);
		if (chord.ok) expect(chord.grid.notes.filter((note) => note.slot === 0).map((note) => note.midi)).toEqual([60, 64]);

		const result = parseNoteGrid(NOTE_SOURCE, 'trk_notes');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.grid.steps).toBe(4);
		expect(result.grid.stepCycle).toBe(.25);
		expect(result.grid.sound).toBe('triangle');
		expect(result.grid.notes).toEqual([
			{ id: 'note-0', slot: 0, stackIndex: 0, startCycle: 0, durationCycles: .25, midi: 60, sourceValue: 'c4' },
			{ id: 'note-2', slot: 2, stackIndex: 0, startCycle: .5, durationCycles: .25, midi: 63, sourceValue: 'eb4' },
			{ id: 'note-3', slot: 3, stackIndex: 0, startCycle: .75, durationCycles: .25, midi: 67, sourceValue: 'g4' },
		]);
	});

	test('writes note placement, deletion, and a native duration control', () => {
		const placed = updateNoteGridSource(NOTE_SOURCE, 'trk_notes', { type: 'set', slot: 1, midi: 62 });
		expect(placed).toContain('note("c4 D4 eb4 g4")');
		const stackedPlacement = updateNoteGridSource(NOTE_SOURCE, 'trk_notes', { type: 'set', slot: 3, midi: 65, stackIndex: 1 });
		expect(stackedPlacement).toContain('note("c4 ~ eb4 g4,F4")');

		const resized = updateNoteGridSource(placed, 'trk_notes', { type: 'resize', slot: 1, durationCycles: .5 });
		expect(resized).toContain('.dur("0.25 0.5 0.25 0.25")');

		const trimmedFromFront = updateNoteGridSource(NOTE_SOURCE, 'trk_notes', { type: 'trim-start', slot: 0, startCycle: .1875 });
		expect(trimmedFromFront).toContain('note("[~ ~ ~ c4] ~ eb4 g4").s("triangle").dur("0.0625 0.25 0.25 0.25")');
		const trimmedGrid = parseNoteGrid(trimmedFromFront, 'trk_notes');
		expect(trimmedGrid.ok).toBe(true);
		if (trimmedGrid.ok) {
			expect(trimmedGrid.grid.notes[0]?.startCycle).toBe(.1875);
			expect(trimmedGrid.grid.notes[0]?.durationCycles).toBe(.0625);
		}
		const pitchedTrimmed = updateNoteGridSource(trimmedFromFront, 'trk_notes', { type: 'set', slot: 0, midi: 62 });
		expect(pitchedTrimmed).toContain('note("[~ ~ ~ D4] ~ eb4 g4")');
		expect(updateNoteGridSource(NOTE_SOURCE, 'trk_notes', { type: 'trim-start', slot: 0, startCycle: 0 })).toBe(NOTE_SOURCE);

		const moved = updateNoteGridSource(NOTE_SOURCE, 'trk_notes', { type: 'move', slot: 0, targetSlot: 1 });
		expect(moved).toContain('note("~ c4 eb4 g4")');
		const stacked = updateNoteGridSource(NOTE_SOURCE, 'trk_notes', { type: 'move', slot: 0, targetSlot: 2 });
		expect(stacked).toContain('note("~ ~ eb4,c4 g4")');
		const stackedAtLastSlot = updateNoteGridSource(NOTE_SOURCE, 'trk_notes', { type: 'move', slot: 0, targetSlot: 3 });
		expect(stackedAtLastSlot).toContain('note("~ ~ eb4 g4,c4")');
		const stackedGrid = parseNoteGrid(stacked, 'trk_notes');
		expect(stackedGrid.ok).toBe(true);
		if (stackedGrid.ok) {
			expect(stackedGrid.grid.notes.filter((note) => note.slot === 2).map((note) => note.midi)).toEqual([63, 60]);
		}
		const movedTrimmed = updateNoteGridSource(trimmedFromFront, 'trk_notes', { type: 'move', slot: 0, targetSlot: 1 });
		expect(movedTrimmed).toContain('note("~ [~ ~ ~ c4] eb4 g4")');
		const movedTrimmedGrid = parseNoteGrid(movedTrimmed, 'trk_notes');
		expect(movedTrimmedGrid.ok).toBe(true);
		if (movedTrimmedGrid.ok) expect(movedTrimmedGrid.grid.notes.find((note) => note.slot === 1)?.startCycle).toBe(.4375);

		const deleted = updateNoteGridSource(resized, 'trk_notes', { type: 'delete', slot: 2 });
		expect(deleted).toContain('note("c4 D4 ~ g4")');
		expect(parseNoteGrid(deleted, 'trk_notes').ok).toBe(true);
	});

	test('preserves native duration semantics inside and outside a seqPLoop', () => {
		const innerSource = NOTE_SOURCE.replace('note("c4 ~ eb4 g4")', 'seqPLoop([0, 4, note("c4 ~ eb4 g4").dur("0.25 0.5 0.25 0.25")])');
		const inner = parseNoteGrid(innerSource, 'trk_notes');
		expect(inner.ok).toBe(true);
		if (inner.ok) expect(inner.grid.notes[0]?.durationCycles).toBe(1);
		const innerResized = updateNoteGridSource(innerSource, 'trk_notes', { type: 'resize', slot: 0, durationCycles: 2 });
		expect(innerResized).toContain('.dur("0.5 0.5 0.25 0.25")');

		const outerSource = NOTE_SOURCE.replace('note("c4 ~ eb4 g4")', 'seqPLoop([0, 4, note("c4 ~ eb4 g4")]).s("triangle").dur("1 1 1 1")').replace('.s("triangle")', '');
		const outer = parseNoteGrid(outerSource, 'trk_notes');
		expect(outer.ok).toBe(true);
		if (outer.ok) expect(outer.grid.notes[0]?.durationCycles).toBe(1);
		const outerResized = updateNoteGridSource(outerSource, 'trk_notes', { type: 'resize', slot: 0, durationCycles: 2 });
		expect(outerResized).toContain('seqPLoop([0, 4, note("c4 ~ eb4 g4")]).dur("2 1 1 1").s("triangle")');
	});

	test('maps scale-degree grids and snaps chromatic placement to the scale', () => {
		const source = NOTE_SOURCE.replace('note("c4 ~ eb4 g4").s("triangle")', 'n("0 ~ 2 3").scale(key).octave(-1).s("sawtooth")');
		const result = parseNoteGrid(source, 'trk_notes');
		expect(result.ok).toBe(true);
		if (!result.ok || !result.grid.scale) return;
		expect(result.grid.notes[0]?.midi).toBe(36);
		expect(result.grid.notes[1]?.midi).toBe(39);
		const snapped = snapMidiToNoteGrid(result.grid, 40);
		expect(snapped).toBe(39);
		const updated = updateNoteGridSource(source, 'trk_notes', { type: 'set', slot: 1, midi: 40 });
		expect(updated).toContain('n("0 2 2 3")');
	});

	test('supports a static note grid inside a seqPLoop wrapper', () => {
		const groupedSource = NOTE_SOURCE.replace('note("c4 ~ eb4 g4")', 'note("[~ ~ c4 ~] ~ eb4 g4")');
		const grouped = parseNoteGrid(groupedSource, 'trk_notes');
		expect(grouped.ok).toBe(true);
		if (grouped.ok) {
			expect(grouped.grid.notes[0]?.startCycle).toBe(.125);
			expect(grouped.grid.notes[0]?.durationCycles).toBe(.0625);
		}

		const source = NOTE_SOURCE.replace('note("c4 ~ eb4 g4")', 'seqPLoop([0, 4, note("c4 ~ eb4 g4")])');
		const result = parseNoteGrid(source, 'trk_notes');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.grid.patternCycles).toBe(4);
			expect(result.grid.stepCycle).toBe(1);
			expect(result.grid.notes[0]?.durationCycles).toBe(1);
		}
		const resized = updateNoteGridSource(source, 'trk_notes', { type: 'resize', slot: 0, durationCycles: 2 });
		expect(resized).toContain('seqPLoop([0, 4, note("c4 ~ eb4 g4").dur("0.5 0.25 0.25 0.25")]).s("triangle")');
		const trimmed = updateNoteGridSource(source, 'trk_notes', { type: 'trim-start', slot: 0, startCycle: .5 });
		expect(trimmed).toContain('note("[~ ~ c4 ~] ~ eb4 g4").dur("0.125 0.25 0.25 0.25")');
		const trimmedResult = parseNoteGrid(trimmed, 'trk_notes');
		expect(trimmedResult.ok).toBe(true);
		if (trimmedResult.ok) {
			expect(trimmedResult.grid.notes[0]?.startCycle).toBe(.5);
			expect(trimmedResult.grid.notes[0]?.durationCycles).toBe(.5);
		}

		const extended6 = updateTrackRange(extendNoteGridSourceRange(source, 'trk_notes', 4, 6), 'trk_notes', 0, 6);
		expect(extended6).toContain('seqPLoop([0, 6, note("c4 ~ eb4 g4 ~ ~")])');
		const extended6Result = parseNoteGrid(extended6, 'trk_notes');
		expect(extended6Result.ok).toBe(true);
		if (extended6Result.ok) {
			expect(extended6Result.grid.notes.map((note) => note.startCycle)).toEqual([0, 2, 3]);
		}
		const extended8From6 = updateTrackRange(extendNoteGridSourceRange(extended6, 'trk_notes', 6, 8), 'trk_notes', 0, 8);
		expect(extended8From6).toContain('seqPLoop([0, 8, note("c4 ~ eb4 g4 ~ ~ ~ ~")])');
		const extended = updateTrackRange(extendNoteGridSourceRange(source, 'trk_notes', 4, 8), 'trk_notes', 0, 8);
		expect(extended).toContain('seqPLoop([0, 8, note("c4 ~ eb4 g4 ~ ~ ~ ~")])');
		const extendedResult = parseNoteGrid(extended, 'trk_notes');
		expect(extendedResult.ok).toBe(true);
		if (extendedResult.ok) {
			expect(extendedResult.grid.steps).toBe(8);
			expect(extendedResult.grid.notes.map((note) => note.slot)).toEqual([0, 2, 3]);
		}
		const shortened = updateTrackRange(trimNoteGridSourceRange(extended, 'trk_notes', 4), 'trk_notes', 0, 4);
		const shortenedResult = parseNoteGrid(shortened, 'trk_notes');
		expect(shortenedResult.ok).toBe(true);
		if (shortenedResult.ok) {
			expect(shortenedResult.grid.steps).toBe(4);
			expect(shortenedResult.grid.notes.map((note) => note.slot)).toEqual([0, 2, 3]);
			expect(shortenedResult.grid.notes.map((note) => note.startCycle)).toEqual([0, 2, 3]);
		}
		const movedRange = updateTrackRange(extended, 'trk_notes', 2, 10);
		const movedRangeResult = parseNoteGrid(movedRange, 'trk_notes');
		expect(movedRangeResult.ok).toBe(true);
		if (movedRangeResult.ok) {
			expect(movedRangeResult.grid.patternCycles).toBe(8);
			expect(movedRangeResult.grid.notes.map((note) => note.startCycle)).toEqual([0, 2, 3]);
		}

		const procedural = source.replace('note("c4 ~ eb4 g4")', 'note("<c4 eb4 g4>").fast(2)');
		const preservedProcedural = extendNoteGridSourceRange(procedural, 'trk_notes', 4, 8);
		expect(preservedProcedural).toContain('seqPLoop([0, 4, note("<c4 eb4 g4>").fast(2)], [4, 8, s("~")])');

		const extendedFull = extendNoteGridSourceRange(NOTE_SOURCE, 'trk_notes', 4, 8);
		const extendedFullResult = parseNoteGrid(extendedFull, 'trk_notes');
		expect(extendedFullResult.ok).toBe(true);
		if (extendedFullResult.ok) {
			expect(extendedFullResult.grid.steps).toBe(32);
			expect(extendedFullResult.grid.notes.every((note) => note.slot < 16)).toBe(true);
		}
	});

	test('keeps complex or procedural note patterns read-only', () => {
		expect(parseNoteGrid(NOTE_SOURCE.replace('c4 ~ eb4 g4', '<c4 eb4 g4>'), 'trk_notes')).toEqual({
			ok: false,
			reason: 'This note pattern uses unsupported nested or dynamic mini-notation; use static note values, rests, or comma-stacked notes.',
		});
		expect(parseNoteGrid(NOTE_SOURCE.replace('note("c4 ~ eb4 g4")', 'n("0 2 4 7").scale(key).fast(2)'), 'trk_notes').ok).toBe(false);
		expect(parseNoteGrid(NOTE_SOURCE.replace('note("c4 ~ eb4 g4")', 'arrange([4, note("c4 ~ eb4 g4")])'), 'trk_notes').ok).toBe(false);
	});

	test('formats MIDI notes for source output', () => {
		expect(midiToNoteName(0)).toBe('C-1');
		expect(midiToNoteName(60)).toBe('C4');
		expect(midiToNoteName(127)).toBe('G9');
	});
});
