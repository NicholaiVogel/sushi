import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { SourceBlockSummary } from '../../lib/project/model';
import { clamp, formatCycle } from './helpers';
import { midiToNoteName, snapMidiToNoteGrid, type NoteGrid, type NoteGridNote, type NoteGridResult } from '../../lib/project/note-grid';

export interface NoteEditorProps {
	track: SourceBlockSummary;
	trackColor: string;
	result: NoteGridResult;
	isBusy: boolean;
	onClose: () => void;
	onSetNote: (slot: number, midi: number, stackIndex?: number) => boolean;
	onMoveNote: (slot: number, targetSlot: number, midi?: number, stackIndex?: number) => boolean;
	onDeleteNote: (slot: number, stackIndex?: number) => void;
	onResizeNote: (slot: number, durationCycles: number, stackIndex?: number) => void;
	onTrimStartNote: (slot: number, startCycle: number, stackIndex?: number) => boolean;
	onPreviewNote: (midi: number, sound: string) => void;
}

interface NoteContextMenu {
	note: NoteGridNote;
	x: number;
	y: number;
}

type NoteResizeEdge = 'start' | 'end';

interface NoteResizeDrag {
	edge: NoteResizeEdge;
	slot: number;
	currentSlot: number;
	startCycle: number;
	currentStartCycle: number;
	stackIndex: number;
	stepCycle: number;
	patternCycles: number;
	resolution: number;
	maxDuration: number;
	minStartCycle: number;
	maxStartCycle: number;
	canvas: HTMLDivElement;
}

interface NotePitchDrag {
	startSlot: number;
	currentSlot: number;
	currentStackIndex: number;
	startMidi: number;
	currentMidi: number;
	grabOffsetCycle: number;
	startX: number;
	stackCounts: Map<number, number>;
	startY: number;
	sound: string;
	grid: NoteGrid;
	moved: boolean;
}

const NOTE_ROW_HEIGHT = 22;
const NOTE_VIEW_ROWS = 49;
const NOTE_VIEW_CENTER_MIDI = 60;
const NOTE_GRID_PIXELS_PER_CYCLE = 128;
const NOTE_GRID_MIN_WIDTH = 720;
const MIN_OCTAVE_OFFSET = -3;
const MAX_OCTAVE_OFFSET = 3;

function noteRowStyle(grid: NoteGrid, note: NoteGridNote, viewTopMidi: number, trackColor: string): CSSProperties {
	const row = viewTopMidi - note.midi;
	const width = Math.max(0.015, Math.min(note.durationCycles, grid.patternCycles - note.startCycle) / grid.patternCycles * 100);
	return {
		'--note-row': row,
		'--note-start': `${note.startCycle / grid.patternCycles * 100}%`,
		'--note-width': `${width}%`,
		'--track-color': trackColor,
		'--note-step-width': `${100 / grid.steps}%`,
	} as CSSProperties;
}

function isEditableTarget(target: EventTarget | null): boolean {
	return target instanceof HTMLButtonElement
		|| target instanceof HTMLInputElement
		|| target instanceof HTMLTextAreaElement
		|| target instanceof HTMLSelectElement
		|| (target instanceof HTMLElement && target.isContentEditable);
}

export function NoteEditor({ track, trackColor, result, isBusy, onClose, onSetNote, onMoveNote, onDeleteNote, onResizeNote, onTrimStartNote, onPreviewNote }: NoteEditorProps) {
	const rootRef = useRef<HTMLElement | null>(null);
	const canvasRef = useRef<HTMLDivElement | null>(null);
	const contextMenuRef = useRef<HTMLDivElement | null>(null);
	const resizeRef = useRef<NoteResizeDrag | null>(null);
	const pitchDragRef = useRef<NotePitchDrag | null>(null);
	const onSetNoteRef = useRef(onSetNote);
	const onMoveNoteRef = useRef(onMoveNote);
	const onResizeNoteRef = useRef(onResizeNote);
	const onTrimStartNoteRef = useRef(onTrimStartNote);
	const onPreviewNoteRef = useRef(onPreviewNote);
	onSetNoteRef.current = onSetNote;
	onMoveNoteRef.current = onMoveNote;
	onResizeNoteRef.current = onResizeNote;
	onTrimStartNoteRef.current = onTrimStartNote;
	onPreviewNoteRef.current = onPreviewNote;
	const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
	const [octaveOffset, setOctaveOffset] = useState(0);
	const [contextMenu, setContextMenu] = useState<NoteContextMenu | null>(null);
	const grid = result.ok ? result.grid : undefined;
	// The drawer shows roughly nine rows at once. Keep the central octave in
	// view by default, then let the wheel move the window one octave at a time.
	const viewTopMidi = NOTE_VIEW_CENTER_MIDI + octaveOffset * 12 + 4;
	const visibleMidis = useMemo(() => Array.from({ length: NOTE_VIEW_ROWS }, (_, index) => viewTopMidi - index), [viewTopMidi]);
	const visibleNotes = useMemo(() => grid?.notes.filter((note) => note.midi >= visibleMidis[visibleMidis.length - 1] && note.midi <= visibleMidis[0]) ?? [], [grid, visibleMidis]);

	useEffect(() => {
		setSelectedNoteId(null);
		setContextMenu(null);
		setOctaveOffset(0);
	}, [track.id]);

	useEffect(() => {
		if (selectedNoteId && !grid?.notes.some((note) => note.id === selectedNoteId)) setSelectedNoteId(null);
	}, [grid, selectedNoteId]);

	const handleResizePointerMove = useCallback((event: PointerEvent) => {
		const resize = resizeRef.current;
		if (!resize) return;
		const rect = resize.canvas.getBoundingClientRect();
		if (!rect.width) return;
		const pointerCycle = clamp((event.clientX - rect.left) / rect.width * resize.patternCycles, 0, resize.patternCycles);
		if (resize.edge === 'start') {
			const targetStartCycle = clamp(Math.round(pointerCycle / resize.resolution) * resize.resolution, resize.minStartCycle, resize.maxStartCycle);
			if (Math.abs(targetStartCycle - resize.currentStartCycle) < 0.000001) return;
			if (onTrimStartNoteRef.current(resize.currentSlot, Number(targetStartCycle.toFixed(6)), resize.stackIndex)) {
				resize.currentStartCycle = targetStartCycle;
			}
			return;
		}
		const rawDuration = pointerCycle - resize.startCycle;
		const duration = clamp(Math.round(rawDuration / resize.resolution) * resize.resolution, resize.resolution, resize.maxDuration);
		onResizeNoteRef.current(resize.slot, Number(duration.toFixed(6)), resize.stackIndex);
	}, []);

	const stopResize = useCallback(() => {
		resizeRef.current = null;
		window.removeEventListener('pointermove', handleResizePointerMove);
		window.removeEventListener('pointerup', stopResize);
		window.removeEventListener('pointercancel', stopResize);
	}, [handleResizePointerMove]);

	const handlePitchDragMove = useCallback((event: PointerEvent) => {
		const drag = pitchDragRef.current;
		if (!drag) return;
		const rect = drag.grid.steps > 0 ? canvasRef.current?.getBoundingClientRect() : undefined;
		if (!rect?.width) return;
		const pointerCycle = clamp((event.clientX - rect.left) / rect.width * drag.grid.patternCycles, 0, drag.grid.patternCycles);
		// Resolve the destination from the note's actual grid position rather
		// than from the first pointer event. This stays correct after the note
		// timeline is horizontally scrolled and keeps the drop on the intended
		// late slot instead of snapping back to slot zero.
		const targetSlot = clamp(Math.round((pointerCycle - drag.grabOffsetCycle) / drag.grid.stepCycle), 0, drag.grid.steps - 1);
		const rowDelta = Math.round((drag.startY - event.clientY) / NOTE_ROW_HEIGHT);
		if (!drag.moved && Math.abs(event.clientY - drag.startY) < 3 && Math.abs(event.clientX - drag.startX) < 3) return;
		const midi = snapMidiToNoteGrid(drag.grid, clamp(drag.startMidi + rowDelta, 0, 127));
		if (targetSlot === drag.currentSlot && midi === drag.currentMidi) return;
		event.preventDefault();
		if (targetSlot !== drag.currentSlot) {
			const sourceCount = drag.stackCounts.get(drag.currentSlot) ?? 0;
			const targetStackIndex = drag.stackCounts.get(targetSlot) ?? 0;
			if (!onMoveNoteRef.current(drag.currentSlot, targetSlot, midi, drag.currentStackIndex)) return;
			drag.stackCounts.set(drag.currentSlot, Math.max(0, sourceCount - 1));
			drag.stackCounts.set(targetSlot, targetStackIndex + 1);
			drag.currentSlot = targetSlot;
			drag.currentStackIndex = targetStackIndex;
		} else if (midi !== drag.currentMidi && !onSetNoteRef.current(drag.currentSlot, midi, drag.currentStackIndex)) {
			return;
		}
		drag.currentMidi = midi;
		drag.moved = true;
		setSelectedNoteId(drag.currentStackIndex === 0 ? `note-${drag.currentSlot}` : `note-${drag.currentSlot}-${drag.currentStackIndex}`);
	}, []);

	const stopPitchDrag = useCallback(() => {
		const drag = pitchDragRef.current;
		pitchDragRef.current = null;
		window.removeEventListener('pointermove', handlePitchDragMove);
		window.removeEventListener('pointerup', stopPitchDrag);
		window.removeEventListener('pointercancel', stopPitchDrag);
		if (drag?.moved) onPreviewNoteRef.current(drag.currentMidi, drag.sound);
	}, [handlePitchDragMove]);

	useEffect(() => () => {
		stopResize();
		stopPitchDrag();
	}, [stopPitchDrag, stopResize]);

	const startPitchDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, note: NoteGridNote) => {
		if (!grid || isBusy || event.button !== 0 || !canvasRef.current) return;
		const rect = canvasRef.current.getBoundingClientRect();
		if (!rect.width) return;
		const pointerCycle = clamp((event.clientX - rect.left) / rect.width * grid.patternCycles, 0, grid.patternCycles);
		event.preventDefault();
		event.stopPropagation();
		setSelectedNoteId(note.id);
		event.currentTarget.focus();
		const stackCounts = new Map<number, number>();
		for (const candidate of grid.notes) stackCounts.set(candidate.slot, (stackCounts.get(candidate.slot) ?? 0) + 1);
		pitchDragRef.current = {
			startSlot: note.slot,
			currentSlot: note.slot,
			currentStackIndex: note.stackIndex,
			startMidi: note.midi,
			currentMidi: note.midi,
			grabOffsetCycle: pointerCycle - note.startCycle,
			startX: event.clientX,
			stackCounts,
			startY: event.clientY,
			sound: grid.sound,
			grid,
			moved: false,
		};
		window.addEventListener('pointermove', handlePitchDragMove);
		window.addEventListener('pointerup', stopPitchDrag);
		window.addEventListener('pointercancel', stopPitchDrag);
	}, [grid, handlePitchDragMove, isBusy, stopPitchDrag]);

	const startResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>, note: NoteGridNote, edge: NoteResizeEdge) => {
		if (!grid || isBusy || event.button !== 0 || !canvasRef.current) return;
		event.preventDefault();
		event.stopPropagation();
		setSelectedNoteId(note.id);
		const resolution = grid.stepCycle / 4;
		// Starts snap to quarter-subdivisions inside the authored grid cell. This
		// lets the front edge trim a one-step note without moving into another
		// source slot or overwriting a neighboring note.
		resizeRef.current = {
			edge,
			slot: note.slot,
			currentSlot: note.slot,
			startCycle: note.startCycle,
			currentStartCycle: note.startCycle,
			stackIndex: note.stackIndex,
			stepCycle: grid.stepCycle,
			patternCycles: grid.patternCycles,
			resolution,
			maxDuration: Math.max(resolution, grid.patternCycles - note.startCycle),
			minStartCycle: note.slot * grid.stepCycle,
			maxStartCycle: note.slot * grid.stepCycle + grid.stepCycle - resolution,
			canvas: canvasRef.current,
		};
		window.addEventListener('pointermove', handleResizePointerMove);
		window.addEventListener('pointerup', stopResize);
		window.addEventListener('pointercancel', stopResize);
	}, [grid, handleResizePointerMove, isBusy, stopResize]);

	const removeNote = useCallback((note: NoteGridNote) => {
		if (isBusy) return;
		setContextMenu(null);
		setSelectedNoteId(null);
		onDeleteNote(note.slot, note.stackIndex);
	}, [isBusy, onDeleteNote]);

	const handleCanvasPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		if (!grid || isBusy || event.button !== 0 || !canvasRef.current) return;
		const rect = canvasRef.current.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		const x = clamp((event.clientX - rect.left) / rect.width, 0, 0.999999);
		const localCycle = x * grid.patternCycles;
		const slot = Math.min(grid.steps - 1, Math.floor(localCycle / grid.stepCycle));
		const row = Math.min(NOTE_VIEW_ROWS - 1, Math.max(0, Math.floor((event.clientY - rect.top) / NOTE_ROW_HEIGHT)));
		const midi = snapMidiToNoteGrid(grid, viewTopMidi - row);
		const existing = grid.notes.find((note) => note.slot === slot && note.midi === midi);
		if (existing) {
			setSelectedNoteId(existing.id);
			return;
		}
		setContextMenu(null);
		const stackIndex = grid.notes.filter((note) => note.slot === slot).length;
		setSelectedNoteId(stackIndex === 0 ? `note-${slot}` : `note-${slot}-${stackIndex}`);
		onSetNote(slot, midi, stackIndex);
		onPreviewNote(midi, grid.sound);
	}, [grid, isBusy, onPreviewNote, onSetNote, viewTopMidi]);

	const handleCanvasContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		setContextMenu(null);
	}, []);

	const handleNoteContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>, note: NoteGridNote) => {
		event.preventDefault();
		event.stopPropagation();
		setSelectedNoteId(note.id);
		const width = 150;
		const height = 48;
		setContextMenu({
			note,
			x: Math.min(Math.max(8, event.clientX), Math.max(8, window.innerWidth - width - 8)),
			y: Math.min(Math.max(8, event.clientY), Math.max(8, window.innerHeight - height - 8)),
		});
	}, []);

	const handleRootKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
		if (isEditableTarget(event.target) || (event.key !== 'Backspace' && event.key !== 'Delete')) return;
		event.preventDefault();
		event.stopPropagation();
		if (!grid || isBusy) return;
		const selected = grid.notes.find((note) => note.id === selectedNoteId);
		if (selected) removeNote(selected);
	}, [grid, isBusy, removeNote, selectedNoteId]);

	useEffect(() => {
		rootRef.current?.focus();
	}, [track.id]);

	const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
		// Leave horizontal wheel/trackpad gestures (and shift-wheel) to the
		// native note-timeline scroller below the piano labels.
		if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
		event.preventDefault();
		if (Math.abs(event.deltaY) < 1) return;
		setOctaveOffset((current) => clamp(current + (event.deltaY > 0 ? -1 : 1), MIN_OCTAVE_OFFSET, MAX_OCTAVE_OFFSET));
	}, []);

	useEffect(() => {
		if (!contextMenu) return undefined;
		const handlePointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return;
			setContextMenu(null);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setContextMenu(null);
		};
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [contextMenu]);

	const adjustOctave = (delta: number) => setOctaveOffset((current) => clamp(current + delta, MIN_OCTAVE_OFFSET, MAX_OCTAVE_OFFSET));

	return (
		<section className="note-editor-drawer" ref={rootRef} role="dialog" aria-modal="false" aria-label={`Note editor for ${track.name}`} tabIndex={-1} onKeyDown={handleRootKeyDown}>
			<div className="note-editor-header">
				<div className="note-editor-title">
					<span className="note-editor-kicker">LIVE NOTE EDITOR</span>
					<strong style={{ '--track-color': trackColor } as CSSProperties}>{track.name}</strong>
					<span>{grid ? `${grid.sourceKind === 'n' ? 'SCALE' : 'CHROMATIC'} GRID · ${grid.steps} STEPS · ${formatCycle(grid.patternCycles)} CYCLES` : 'SOURCE GRID UNAVAILABLE'}</span>
				</div>
				<div className="note-editor-header-actions">
					{grid ? <span className="note-editor-status">{grid.notes.length}/{grid.steps} NOTES · OCT {octaveOffset >= 0 ? '+' : ''}{octaveOffset}</span> : null}
					<button className="note-editor-close" type="button" onClick={onClose} aria-label="Close note editor" title="Close note editor">×</button>
				</div>
			</div>

			{grid ? (
				<>
					<div className="note-editor-toolbar">
						<span>DRAG NOTES UP/DOWN/LEFT/RIGHT · DRAG EDGES TO TRIM · CLICK CELL TO PLACE/STACK · BACKSPACE TO DELETE</span>
						<div className="note-editor-octave-controls" role="group" aria-label="Note editor octave range">
							<button type="button" onClick={() => adjustOctave(-1)} disabled={octaveOffset <= MIN_OCTAVE_OFFSET} aria-label="Show lower octave" title="Show lower octave">↓</button>
							<output>OCT {octaveOffset >= 0 ? '+' : ''}{octaveOffset}</output>
							<button type="button" onClick={() => adjustOctave(1)} disabled={octaveOffset >= MAX_OCTAVE_OFFSET} aria-label="Show higher octave" title="Show higher octave">↑</button>
						</div>
					</div>
					<div className="note-editor-workspace" onWheel={handleWheel}>
						<div className="note-editor-piano-labels" aria-hidden="true">
							{visibleMidis.map((midi) => <span className={midiToNoteName(midi).includes('#') ? 'note-editor-black-key' : ''} key={midi}>{midiToNoteName(midi)}</span>)}
						</div>
						<div className="note-editor-roll-wrap" aria-label="Horizontal note timeline">
							<div className="note-editor-roll-track" style={{ '--note-grid-width': `${Math.max(NOTE_GRID_MIN_WIDTH, grid.patternCycles * NOTE_GRID_PIXELS_PER_CYCLE, grid.steps * 72)}px` } as CSSProperties}>
								<div
									className="note-editor-roll"
									ref={canvasRef}
									style={{ '--note-step-count': grid.steps, '--note-row-count': NOTE_VIEW_ROWS } as CSSProperties}
									onPointerDown={handleCanvasPointerDown}
									onContextMenu={handleCanvasContextMenu}
									aria-label="Note grid"
								>
									<div className="note-editor-horizontal-lines" aria-hidden="true">{visibleMidis.map((midi) => <span className={midiToNoteName(midi).includes('#') ? 'note-editor-black-row' : ''} key={midi} />)}</div>
									<div className="note-editor-vertical-lines" aria-hidden="true">{Array.from({ length: grid.steps }, (_, slot) => <span className={slot % 4 === 0 ? 'note-editor-bar-line' : ''} key={slot} />)}</div>
									{visibleNotes.map((note) => (
										<div
											className={`note-editor-note ${selectedNoteId === note.id ? 'note-editor-note-selected' : ''}`}
											style={noteRowStyle(grid, note, viewTopMidi, trackColor)}
											key={note.id}
											role="button"
											tabIndex={0}
											aria-label={`${midiToNoteName(note.midi)}, voice ${note.stackIndex + 1}, starts at ${formatCycle(note.startCycle)} cycles, duration ${formatCycle(note.durationCycles)} cycles`}
											onClick={(event) => { event.stopPropagation(); setSelectedNoteId(note.id); }}
											onPointerDown={(event) => startPitchDrag(event, note)}
											onContextMenu={(event) => handleNoteContextMenu(event, note)}
											onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedNoteId(note.id); } }}
										>
											<button className="note-editor-resize-handle note-editor-resize-handle-start" type="button" onPointerDown={(event) => startResize(event, note, 'start')} onClick={(event) => event.stopPropagation()} disabled={isBusy} aria-label={`Trim start of ${midiToNoteName(note.midi)} note`} title="Drag to trim the start of this note" />
											<span>{midiToNoteName(note.midi)}</span>
											<small>{formatCycle(note.durationCycles)}</small>
											<button className="note-editor-resize-handle note-editor-resize-handle-end" type="button" onPointerDown={(event) => startResize(event, note, 'end')} onClick={(event) => event.stopPropagation()} disabled={isBusy} aria-label={`Resize end of ${midiToNoteName(note.midi)} note`} title="Drag to resize the end of this note" />
										</div>
									))}
								</div>
								<div className="note-editor-step-labels" aria-hidden="true">{Array.from({ length: grid.steps }, (_, slot) => <span key={slot}>{slot + 1}</span>)}</div>
							</div>
						</div>
					</div>
				</>
			) : (
				<div className="note-editor-unavailable">
					<strong>THIS TRACK IS SOURCE-EDITABLE, NOT GRID-EDITABLE</strong>
					<p>{result.ok ? 'No notes were found in this source block.' : result.reason}</p>
					<span>Use one flat <code>note(...)</code> or <code>n(...).scale(...)</code> pattern to enable live editing.</span>
				</div>
			)}

			{contextMenu ? <div className="note-context-menu" ref={contextMenuRef} style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label={`Actions for ${midiToNoteName(contextMenu.note.midi)} note`}>
				<button className="note-context-delete" type="button" role="menuitem" onClick={() => removeNote(contextMenu.note)} disabled={isBusy}>Delete note <span aria-hidden="true">⌫</span></button>
			</div> : null}
		</section>
	);
}
