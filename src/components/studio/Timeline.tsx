import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { RuntimeState, SourceBlockSummary } from '../../lib/project/model';
import { EXTENDED_SONG_END_CYCLE } from '../../lib/project/model';
import { cyclesToSeconds, type SourceGlobals } from '../../lib/project/source-mapper';
import {
	formatClock,
	formatCycle,
	getTrackColor,
	getTrackTimingForTimeline,
	SONG_LENGTH_PRESETS,
	TIMELINE_ZOOM_BUTTON_STEP,
	TIMELINE_SNAP_CYCLE,
} from './helpers';
import type { HeaderPopover, TrackDetails } from './types';
import { TrackLane, type TimelineCell } from './TrackLane';
import type { StrudelVisualizer, VisualizerHap } from '../../lib/strudel/adapter';
import type { NoteGrid } from '../../lib/project/note-grid';

export interface TimelineProps {
	enableMidi: boolean;
	timelineViewportRef: RefObject<HTMLElement | null>;
	timelineShellRef: RefObject<HTMLElement | null>;
	timelineLengthRef: RefObject<HTMLDivElement | null>;
	timelineGridStyle: CSSProperties;
	timelineCells: TimelineCell[];
	timelineCellCount: number;
	timelineShowsQuarterBars: boolean;
	timelineVisibleCycles: number;
	timelineZoom: number;
	songEndCycle: number;
	songEndSeconds: number;
	cycleStep: number;
	draftBpm: number;
	blocks: SourceBlockSummary[];
	noteGrids: Map<string, NoteGrid>;
	draftTrackDetails: Map<string, TrackDetails>;
	validTrackDetails: Map<string, TrackDetails>;
	sourceGlobals: SourceGlobals;
	acceptedSourceRevision: number | null;
	runtime: RuntimeState;
	getVisualizerHaps: (trackId: string, visualizer: StrudelVisualizer, begin: number, end: number) => VisualizerHap[];
	getVisualizerScopeData: (trackId: string) => ArrayLike<number> | undefined;
	getVisualizerSpectrumData: (trackId: string) => ArrayLike<number> | undefined;
	isBusy: boolean;
	selectedTrackId: string | null;
	fxDrawerTrackId: string | null;
	renamingTrackId: string | null;
	renamingTrackValue: string;
	openPopover: HeaderPopover | null;
	onTogglePopover: (popover: HeaderPopover) => void;
	onAddAudioTrack: () => void;
	onAddMidiTrack?: () => void;
	onSetSongEndCycle: (value: number) => void;
	onAdjustZoom: (value: number) => void;
	onStartTimelineSeekDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	onTimelineSeekKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	onSelectTrack: (trackId: string) => void;
	onOpenTrackFxDrawer: (trackId: string) => void;
	onToggleTrackEffects: (trackId: string, enabled: boolean) => void;
	onOpenTrackContextMenu: (event: MouseEvent<HTMLElement>, trackId: string) => void;
	onOpenNoteEditor?: (trackId: string) => void;
	onTrackLaneKeyDown: (event: KeyboardEvent<HTMLDivElement>, trackId: string) => void;
	onStartRename: (trackId: string) => void;
	onRenameValueChange: (value: string) => void;
	onFinishRename: (trackId: string, name: string) => void;
	onCancelRename: () => void;
	onToggleTrackMode: (trackId: string, mode: 'mute' | 'solo', active: boolean) => void;
	onSetTrackGain: (trackId: string, value: number) => void;
	onSetTrackPan: (trackId: string, value: number) => void;
	onStartTimingDrag: (event: ReactPointerEvent<HTMLElement>, trackId: string, edge: 'start' | 'end' | 'move') => void;
	onSetTrackRange: (trackId: string, startCycle: number, endCycle: number) => void;
}

export function Timeline({
	enableMidi,
	timelineViewportRef,
	timelineShellRef,
	timelineLengthRef,
	timelineGridStyle,
	timelineCells,
	timelineCellCount,
	timelineShowsQuarterBars,
	timelineVisibleCycles,
	timelineZoom,
	songEndCycle,
	songEndSeconds,
	cycleStep,
	draftBpm,
	blocks,
	noteGrids,
	draftTrackDetails,
	validTrackDetails,
	sourceGlobals,
	acceptedSourceRevision,
	runtime,
	getVisualizerHaps,
	getVisualizerScopeData,
	getVisualizerSpectrumData,
	isBusy,
	selectedTrackId,
	fxDrawerTrackId,
	renamingTrackId,
	renamingTrackValue,
	openPopover,
	onTogglePopover,
	onAddAudioTrack,
	onAddMidiTrack,
	onSetSongEndCycle,
	onAdjustZoom,
	onStartTimelineSeekDrag,
	onTimelineSeekKeyDown,
	onSelectTrack,
	onOpenTrackFxDrawer,
	onToggleTrackEffects,
	onOpenTrackContextMenu,
	onOpenNoteEditor,
	onTrackLaneKeyDown,
	onStartRename,
	onRenameValueChange,
	onFinishRename,
	onCancelRename,
	onToggleTrackMode,
	onSetTrackGain,
	onSetTrackPan,
	onStartTimingDrag,
	onSetTrackRange,
}: TimelineProps) {
	const [addTrackOpen, setAddTrackOpen] = useState(false);
	const addTrackMenuRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!addTrackOpen) return undefined;
		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (event.target instanceof Node && addTrackMenuRef.current?.contains(event.target)) return;
			setAddTrackOpen(false);
		};
		document.addEventListener('pointerdown', closeOnOutsidePointer);
		return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
	}, [addTrackOpen]);

	return (
		<section className={`timeline-shell ${timelineShowsQuarterBars ? '' : 'timeline-bars-only'}`} ref={(element) => { timelineViewportRef.current = element; timelineShellRef.current = element; }} aria-labelledby="timeline-heading">
			<div className="timeline-head" style={timelineGridStyle}>
				<div className="timeline-heading-cell">
					<div className="arrangement-toolbar">
						{enableMidi ? <div className="add-track-control" ref={addTrackMenuRef}>
							<button className="add-track-button" type="button" onClick={() => setAddTrackOpen((open) => !open)} disabled={isBusy} aria-label="Add track" aria-expanded={addTrackOpen} aria-haspopup="menu"><span aria-hidden="true">＋</span> Add track</button>
							{addTrackOpen ? <div className="add-track-menu" role="menu" aria-label="Choose track type">
								<button type="button" role="menuitem" className="add-track-option" onClick={() => { setAddTrackOpen(false); onAddAudioTrack(); }}>
									<strong><span aria-hidden="true">♫</span> Audio track</strong>
									<small>Start with an editable Strudel instrument lane.</small>
								</button>
								{onAddMidiTrack ? <button type="button" role="menuitem" className="add-track-option add-track-option-midi" onClick={() => { setAddTrackOpen(false); onAddMidiTrack(); }}>
									<strong><span aria-hidden="true">⌁</span> MIDI track</strong>
									<small>Record keys, pads, knobs, and live-play a chosen instrument.</small>
								</button> : null}
							</div> : null}
						</div> : <button className="add-track-button" type="button" onClick={onAddAudioTrack} disabled={isBusy} aria-label="Add track"><span aria-hidden="true">＋</span> Add track</button>}
					</div>
					<div className="timeline-duration">
						<div className="timeline-length-control-wrap" ref={timelineLengthRef}>
							<button className="timeline-length-trigger" type="button" onClick={() => onTogglePopover('length')} disabled={isBusy} aria-expanded={openPopover === 'length'} aria-haspopup="dialog" aria-label={`Song length, ${formatCycle(songEndCycle)} bars`} title="Choose song length">
								<strong>{formatCycle(songEndCycle)}</strong><span>BARS</span>
								<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 6 5 5 5-5" /></svg>
							</button>
							{openPopover === 'length' ? (
								<div className="timeline-length-popover" role="dialog" aria-label="Song length settings">
									<strong className="topbar-popover-title">Song length</strong>
									<label className="timeline-length-value">
										<span className="sr-only">Song length in bars</span>
									<input autoFocus type="number" min={cycleStep} max={EXTENDED_SONG_END_CYCLE} step={cycleStep} value={formatCycle(songEndCycle)} onChange={(event) => onSetSongEndCycle(Number(event.target.value))} aria-label="Song length in bars" />
										<span>BARS</span>
									</label>
									<div className="timeline-length-presets" role="group" aria-label="Song length presets">
										{SONG_LENGTH_PRESETS.map((preset) => <button className={songEndCycle === preset ? 'timeline-length-preset timeline-length-preset-active' : 'timeline-length-preset'} type="button" key={preset} onClick={() => onSetSongEndCycle(preset)} aria-pressed={songEndCycle === preset}>{preset}</button>)}
									</div>
									<span className="timeline-length-note">{formatCycle(songEndSeconds)}S AT {draftBpm} BPM</span>
								</div>
							) : null}
						</div>
						<span aria-hidden="true">·</span>
						<span>{formatCycle(songEndSeconds)}S</span>
					</div>
					<span className="sr-only" id="timeline-heading">{blocks.length.toString().padStart(2, '0')} source lanes</span>
				</div>
				<div className="timeline-ruler" style={{ '--timeline-cell-count': timelineCellCount } as CSSProperties} aria-label="Arrangement beats">
					{timelineCells.map((cell, index) => <span className={cell.isBarStart ? 'bar-number' : ''} key={index}>{cell.label}</span>)}
					<div className="timeline-ruler-controls" role="group" aria-label="Timeline zoom">
						<button className="timeline-ruler-zoom-button" type="button" onClick={() => onAdjustZoom(timelineZoom - TIMELINE_ZOOM_BUTTON_STEP)} disabled={isBusy || timelineZoom <= 0} aria-label="Zoom out timeline" title="Zoom out timeline">
							<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" /><path d="M7.5 10.5h6" /><path d="m15 15 5 5" /></svg>
						</button>
						<output aria-live="polite">{Math.round(timelineVisibleCycles)} BAR{Math.round(timelineVisibleCycles) === 1 ? '' : 'S'}</output>
						<button className="timeline-ruler-zoom-button" type="button" onClick={() => onAdjustZoom(timelineZoom + TIMELINE_ZOOM_BUTTON_STEP)} disabled={isBusy || timelineZoom >= 100} aria-label="Zoom in timeline" title="Zoom in timeline">
							<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" /><path d="M7.5 10.5h6" /><path d="M10.5 7.5v6" /><path d="m15 15 5 5" /></svg>
						</button>
					</div>
					<button className="timeline-seek-surface" type="button" onPointerDown={onStartTimelineSeekDrag} onKeyDown={onTimelineSeekKeyDown} disabled={isBusy} aria-label={`Seek playhead, cycle ${formatCycle(runtime.currentCycle)}, ${formatClock(cyclesToSeconds(runtime.currentCycle, sourceGlobals))}`} title="Click or drag to seek" />
					<i className="timeline-playhead" aria-hidden="true" />
				</div>
			</div>
			{blocks.map((block, index) => {
				const trackDetails = draftTrackDetails.get(block.id) ?? validTrackDetails.get(block.id);
				return <TrackLane
					block={block}
					enableMidi={enableMidi}
					index={index}
					trackColor={getTrackColor(trackDetails?.color)}
					trackDetails={trackDetails}
					noteGrid={noteGrids.get(block.id)}
					timing={getTrackTimingForTimeline(trackDetails, songEndCycle)}
					songEndCycle={songEndCycle}
					sourceGlobals={sourceGlobals}
					timelineGridStyle={timelineGridStyle}
					timelineCells={timelineCells}
					timelineCellCount={timelineCellCount}
					acceptedSourceRevision={acceptedSourceRevision}
					runtime={runtime}
					getVisualizerHaps={getVisualizerHaps}
					getVisualizerScopeData={getVisualizerScopeData}
					getVisualizerSpectrumData={getVisualizerSpectrumData}
					selected={selectedTrackId === block.id}
					fxDrawerOpen={fxDrawerTrackId === block.id}
					renaming={renamingTrackId === block.id}
					renamingValue={renamingTrackValue}
					onSelect={onSelectTrack}
					onOpenFxDrawer={onOpenTrackFxDrawer}
					onToggleEffects={onToggleTrackEffects}
					onContextMenu={onOpenTrackContextMenu}
					onOpenNoteEditor={onOpenNoteEditor}
					onLaneKeyDown={onTrackLaneKeyDown}
					onStartRename={onStartRename}
					onRenameValueChange={onRenameValueChange}
					onFinishRename={onFinishRename}
					onCancelRename={onCancelRename}
					onToggleMode={onToggleTrackMode}
					onSetGain={onSetTrackGain}
					onSetPan={onSetTrackPan}
					onStartTimingDrag={onStartTimingDrag}
					onSetTrackRange={onSetTrackRange}
					key={block.id}
				/>;
			})}
			{blocks.length ? (
				<div className="timeline-fill" style={timelineGridStyle} aria-hidden="true"><div className="timeline-fill-label" /><div className="lane-grid timeline-fill-grid"><div className="lane-grid-lines" style={{ '--timeline-cell-count': timelineCellCount } as CSSProperties}>{timelineCells.map((cell, index) => <span className={cell.isBarStart ? 'beat-start' : ''} key={index} />)}</div><span className="lane-playhead timeline-fill-playhead" /></div></div>
			) : (
				<div className="timeline-empty-state" style={timelineGridStyle}>
					<strong>NO TRACKS</strong>
					<span>Add a track or write a <code>$:</code> pattern to begin.</span>
				</div>
			)}
		</section>
	);
}
