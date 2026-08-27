import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react';
import type { RuntimeState, SourceBlockSummary } from '../../lib/project/model';
import { EXTENDED_SONG_END_CYCLE } from '../../lib/project/model';
import { cyclesToSeconds, type SourceGlobals } from '../../lib/project/source-mapper';
import {
	clamp,
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

export interface TimelineProps {
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
	draftTrackDetails: Map<string, TrackDetails>;
	validTrackDetails: Map<string, TrackDetails>;
	sourceGlobals: SourceGlobals;
	runtime: RuntimeState;
	isBusy: boolean;
	selectedTrackId: string | null;
	renamingTrackId: string | null;
	renamingTrackValue: string;
	openPopover: HeaderPopover | null;
	onTogglePopover: (popover: HeaderPopover) => void;
	onAddTrack: () => void;
	onSetSongEndCycle: (value: number) => void;
	onAdjustZoom: (value: number) => void;
	onStartTimelineSeekDrag: (event: PointerEvent<HTMLButtonElement>) => void;
	onTimelineSeekKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	onSelectTrack: (trackId: string) => void;
	onOpenTrackContextMenu: (event: MouseEvent<HTMLElement>, trackId: string) => void;
	onTrackLaneKeyDown: (event: KeyboardEvent<HTMLDivElement>, trackId: string) => void;
	onStartRename: (trackId: string) => void;
	onRenameValueChange: (value: string) => void;
	onFinishRename: (trackId: string, name: string) => void;
	onCancelRename: () => void;
	onToggleTrackMode: (trackId: string, mode: 'mute' | 'solo', active: boolean) => void;
	onSetTrackGain: (trackId: string, value: number) => void;
	onSetTrackPan: (trackId: string, value: number) => void;
	onStartTimingDrag: (event: PointerEvent<HTMLElement>, trackId: string, edge: 'start' | 'end' | 'move') => void;
	onSetTrackRange: (trackId: string, startCycle: number, endCycle: number) => void;
}

export function Timeline({
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
	draftTrackDetails,
	validTrackDetails,
	sourceGlobals,
	runtime,
	isBusy,
	selectedTrackId,
	renamingTrackId,
	renamingTrackValue,
	openPopover,
	onTogglePopover,
	onAddTrack,
	onSetSongEndCycle,
	onAdjustZoom,
	onStartTimelineSeekDrag,
	onTimelineSeekKeyDown,
	onSelectTrack,
	onOpenTrackContextMenu,
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
	return (
		<section className={`timeline-shell ${timelineShowsQuarterBars ? '' : 'timeline-bars-only'}`} ref={(element) => { timelineViewportRef.current = element; timelineShellRef.current = element; }} aria-labelledby="timeline-heading">
			<div className="timeline-head" style={timelineGridStyle}>
				<div className="timeline-heading-cell">
					<div className="arrangement-toolbar">
						<button className="add-track-button" type="button" onClick={onAddTrack} disabled={isBusy} aria-label="Add track"><span aria-hidden="true">＋</span> Add track</button>
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
					<i className="timeline-playhead" style={{ '--playhead-position': clamp(runtime.currentCycle / songEndCycle, 0, 1) } as CSSProperties} aria-hidden="true" />
				</div>
			</div>
			{blocks.map((block, index) => {
				const trackDetails = draftTrackDetails.get(block.id) ?? validTrackDetails.get(block.id);
				return <TrackLane
					block={block}
					index={index}
					trackColor={getTrackColor(index)}
					trackDetails={trackDetails}
					timing={getTrackTimingForTimeline(trackDetails, songEndCycle)}
					songEndCycle={songEndCycle}
					sourceGlobals={sourceGlobals}
					timelineGridStyle={timelineGridStyle}
					timelineCells={timelineCells}
					timelineCellCount={timelineCellCount}
					runtime={runtime}
					selected={selectedTrackId === block.id}
					renaming={renamingTrackId === block.id}
					renamingValue={renamingTrackValue}
					onSelect={onSelectTrack}
					onContextMenu={onOpenTrackContextMenu}
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
				<div className="timeline-fill" style={timelineGridStyle} aria-hidden="true"><div className="timeline-fill-label" /><div className="lane-grid timeline-fill-grid"><div className="lane-grid-lines" style={{ '--timeline-cell-count': timelineCellCount } as CSSProperties}>{timelineCells.map((cell, index) => <span className={cell.isBarStart ? 'beat-start' : ''} key={index} />)}</div><span className="lane-playhead timeline-fill-playhead" style={{ '--playhead-position': clamp(runtime.currentCycle / songEndCycle, 0, 1) } as CSSProperties} /></div></div>
			) : (
				<div className="timeline-empty-state" style={timelineGridStyle}>
					<strong>NO TRACKS</strong>
					<span>Add a track or write a <code>$:</code> pattern to begin.</span>
				</div>
			)}
		</section>
	);
}
