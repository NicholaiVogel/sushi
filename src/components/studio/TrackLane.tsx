import { type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { RuntimeState, SourceBlockSummary } from '../../lib/project/model';
import { cyclesToSeconds, type SourceGlobals } from '../../lib/project/source-mapper';
import {
	clamp,
	formatCycle,
	getTrackLabel,
	shiftTrackRange,
	TIMELINE_SNAP_CYCLE,
	TRACK_NAME_MAX_LENGTH,
} from './helpers';
import type { TrackDetails } from './types';
import { VisualizerCanvas } from './VisualizerCanvas';
import type { StrudelVisualizer, VisualizerHap } from '../../lib/strudel/adapter';

export interface TimelineCell {
	isBarStart: boolean;
	label: string;
}

export interface TrackLaneProps {
	block: SourceBlockSummary;
	index: number;
	trackColor: string;
	trackDetails?: TrackDetails;
	timing: TrackDetails['timing'];
	songEndCycle: number;
	sourceGlobals: SourceGlobals;
	timelineGridStyle: CSSProperties;
	timelineCells: TimelineCell[];
	timelineCellCount: number;
	runtime: RuntimeState;
	getVisualizerHaps: (trackId: string, visualizer: StrudelVisualizer, begin: number, end: number) => VisualizerHap[];
	getVisualizerScopeData: (trackId: string) => ArrayLike<number> | undefined;
	getVisualizerSpectrumData: (trackId: string) => ArrayLike<number> | undefined;
	selected: boolean;
	renaming: boolean;
	renamingValue: string;
	fxDrawerOpen: boolean;
	onSelect: (trackId: string) => void;
	onContextMenu: (event: MouseEvent<HTMLElement>, trackId: string) => void;
	onLaneKeyDown: (event: KeyboardEvent<HTMLDivElement>, trackId: string) => void;
	onStartRename: (trackId: string) => void;
	onRenameValueChange: (value: string) => void;
	onFinishRename: (trackId: string, name: string) => void;
	onCancelRename: () => void;
	onToggleMode: (trackId: string, mode: 'mute' | 'solo', active: boolean) => void;
	onSetGain: (trackId: string, value: number) => void;
	onSetPan: (trackId: string, value: number) => void;
	onOpenFxDrawer: (trackId: string) => void;
	onToggleEffects: (trackId: string, enabled: boolean) => void;
	onStartTimingDrag: (event: PointerEvent<HTMLElement>, trackId: string, edge: 'start' | 'end' | 'move') => void;
	onSetTrackRange: (trackId: string, startCycle: number, endCycle: number) => void;
}

export function TrackLane({
	block,
	index,
	trackColor,
	trackDetails,
	timing,
	songEndCycle,
	sourceGlobals,
	timelineGridStyle,
	timelineCells,
	timelineCellCount,
	runtime,
	getVisualizerHaps,
	getVisualizerScopeData,
	getVisualizerSpectrumData,
	selected,
	renaming,
	renamingValue,
	fxDrawerOpen,
	onSelect,
	onContextMenu,
	onLaneKeyDown,
	onStartRename,
	onRenameValueChange,
	onFinishRename,
	onCancelRename,
	onToggleMode,
	onSetGain,
	onSetPan,
	onOpenFxDrawer,
	onToggleEffects,
	onStartTimingDrag,
	onSetTrackRange,
}: TrackLaneProps) {
	const gain = trackDetails?.gain ?? 1;
	const pan = trackDetails?.pan ?? 0.5;
	const effects = trackDetails?.effects ?? [];
	const hasEffects = effects.length > 0;
	const effectsEnabled = hasEffects && effects.every((effect) => effect.enabled !== false);
	const trackLaneHeight = 82;
	const clipStart = clamp(timing.startCycle / songEndCycle, 0, 1);
	const clipEnd = clamp(timing.endCycle / songEndCycle, clipStart + 0.01, 1);
	const timingLabel = `${formatCycle(timing.startCycle)}–${formatCycle(timing.endCycle)} cycles · ${formatCycle(cyclesToSeconds(timing.endCycle - timing.startCycle, sourceGlobals))}s`;

	return (
		<div
			className={`track-lane ${selected ? 'track-lane-selected' : ''}`}
			style={{ ...timelineGridStyle, '--track-lane-height': `${trackLaneHeight}px` } as CSSProperties}
			key={block.id}
			tabIndex={0}
			onClick={() => onSelect(block.id)}
			onFocus={(event) => {
				if (event.target instanceof HTMLElement && event.target.closest('.track-fx-button, .track-drawer-button')) return;
				onSelect(block.id);
			}}
			onContextMenu={(event) => onContextMenu(event, block.id)}
			onKeyDown={(event) => onLaneKeyDown(event, block.id)}
			aria-current={selected ? 'true' : undefined}
			aria-label={`Track ${(index + 1).toString()}: ${block.name}`}
		>
			<div className="track-header" style={{ '--track-color': trackColor } as CSSProperties}>
				<div className="track-header-top">
					<span className="track-instrument-icon" aria-hidden="true">♩</span>
					<div className="track-title-wrap">
						<div className="track-name-line">
							<span className="track-number">{(index + 1).toString().padStart(2, '0')}</span>
							{renaming ? (
								<input
									className="track-name-input"
									type="text"
									value={renamingValue}
									maxLength={TRACK_NAME_MAX_LENGTH}
									autoFocus
									onChange={(event) => onRenameValueChange(event.target.value)}
									onBlur={(event) => onFinishRename(block.id, event.currentTarget.value)}
									onClick={(event) => event.stopPropagation()}
									onKeyDown={(event) => {
										if (event.key === 'Enter') {
											event.preventDefault();
											event.stopPropagation();
											onFinishRename(block.id, event.currentTarget.value);
										} else if (event.key === 'Escape') {
											event.preventDefault();
											event.stopPropagation();
											onCancelRename();
										}
									}}
									aria-label={`Rename ${block.name}`}
								/>
							) : (
								<span className="track-name-edit" onDoubleClick={(event) => { event.stopPropagation(); onStartRename(block.id); }}>
									<strong title="Double-click to rename">{block.name}</strong>
									<button className="track-rename-button" type="button" onClick={(event) => { event.stopPropagation(); onStartRename(block.id); }} aria-label={`Rename ${block.name}`} title={`Rename ${block.name}`}>
										<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5 4 4M5 19l3.8-.8L19.2 7.8a1.7 1.7 0 0 0-2.4-2.4L6.4 15.8 5 19Z" /></svg>
									</button>
								</span>
							)}
						</div>
						<span className="track-type">{getTrackLabel(block.type)} <span aria-hidden="true">·</span> LINE {block.line}</span>
					</div>
					<div className="track-header-actions">
						<button
							className={`track-fx-button ${effectsEnabled ? 'track-fx-button-active' : ''}`}
							type="button"
							onClick={(event) => { event.stopPropagation(); onToggleEffects(block.id, !effectsEnabled); }}
							aria-pressed={effectsEnabled}
							disabled={!trackDetails || !hasEffects}
							aria-label={`${effectsEnabled ? 'Bypass' : 'Enable'} all effects for ${block.name}`}
							title={`${effectsEnabled ? 'Bypass' : 'Enable'} all effects for ${block.name}`}
						>fx</button>
						<button
							className={`track-drawer-button ${fxDrawerOpen ? 'track-drawer-button-active' : ''}`}
							type="button"
							onClick={(event) => { event.stopPropagation(); onOpenFxDrawer(block.id); }}
							aria-expanded={fxDrawerOpen}
							aria-controls="track-fx-drawer"
							disabled={!trackDetails}
							aria-label={`${fxDrawerOpen ? 'Close' : 'Open'} track controls for ${block.name}`}
							title={`${fxDrawerOpen ? 'Close' : 'Open'} track controls for ${block.name}`}
							>
							<span aria-hidden="true">⋮</span>
						</button>
						<div className="track-mode-controls" role="group" aria-label={`${block.name} source modes`}>
							<button className={`track-mode-button ${trackDetails?.muted ? 'track-mode-button-active' : ''}`} type="button" onClick={() => onToggleMode(block.id, 'mute', !trackDetails?.muted)} disabled={!trackDetails} aria-label={`Mute ${block.name}`} aria-pressed={trackDetails?.muted ?? false}>M</button>
							<button className={`track-mode-button ${trackDetails?.soloed ? 'track-mode-button-active' : ''}`} type="button" onClick={() => onToggleMode(block.id, 'solo', !trackDetails?.soloed)} disabled={!trackDetails} aria-label={`Solo ${block.name}`} aria-pressed={trackDetails?.soloed ?? false}>S</button>
						</div>
					</div>
				</div>
				<div className="track-mix-controls">
					<label className="track-volume">
						<span className="sr-only">{block.name} gain</span>
						<input className="track-volume-control" type="range" min="0" max="1" step="0.01" value={gain} onChange={(event) => onSetGain(block.id, Number(event.target.value))} disabled={!trackDetails?.gainEditable} aria-label={`${block.name} gain`} />
					</label>
					<div className="track-pan">
						<span aria-hidden="true">L</span>
						<span className="track-pan-control-wrap">
							<input className="track-pan-control" type="range" min="0" max="100" step="1" value={Math.round(clamp(pan, 0, 1) * 100)} onChange={(event) => onSetPan(block.id, Number(event.target.value) / 100)} disabled={!trackDetails?.panEditable} aria-label={`${block.name} pan`} />
							<span className="track-pan-center" aria-hidden="true" />
						</span>
						<span aria-hidden="true">R</span>
						<output className="track-pan-value" aria-label={`${block.name} pan value`}>{Math.round(clamp(pan, 0, 1) * 100)}</output>
					</div>
				</div>
			</div>
			<div className="lane-grid" style={{ ...timelineGridStyle, '--track-color': trackColor } as CSSProperties}>
				<div className="lane-grid-lines" style={{ '--timeline-cell-count': timelineCellCount } as CSSProperties} aria-hidden="true">{timelineCells.map((cell, cellIndex) => <span className={cell.isBarStart ? 'beat-start' : ''} key={cellIndex} />)}</div>
				<div
					className="pattern-region"
					style={{ '--track-color': trackColor, '--clip-start': clipStart, '--clip-end': clipEnd } as CSSProperties}
					onPointerDown={(event) => onStartTimingDrag(event, block.id, 'move')}
					onKeyDown={(event) => {
						if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
						event.preventDefault();
						const delta = event.key === 'ArrowLeft' ? -TIMELINE_SNAP_CYCLE : TIMELINE_SNAP_CYCLE;
						const range = shiftTrackRange(timing.startCycle, timing.endCycle, delta);
						onSetTrackRange(block.id, range.startCycle, range.endCycle);
					}}
					role="button"
					tabIndex={0}
					aria-label={`Move ${block.name} clip, currently ${timingLabel}`}
					title={`${block.name}: drag to move in quarter-cycle steps`}
				>
					{trackDetails?.visualizer ? <VisualizerCanvas
						trackId={block.id}
						trackName={block.name}
						visualizer={trackDetails.visualizer}
						trackColor={trackColor}
						runtime={runtime}
						windowStartCycle={timing.startCycle}
						windowEndCycle={timing.endCycle}
						getVisualizerHaps={getVisualizerHaps}
						getVisualizerScopeData={getVisualizerScopeData}
						getVisualizerSpectrumData={getVisualizerSpectrumData}
					/> : null}
					<button className="clip-handle clip-handle-start" type="button" onPointerDown={(event) => onStartTimingDrag(event, block.id, 'start')} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const delta = event.key === 'ArrowLeft' ? -TIMELINE_SNAP_CYCLE : TIMELINE_SNAP_CYCLE; onSetTrackRange(block.id, clamp(timing.startCycle + delta, 0, timing.endCycle - TIMELINE_SNAP_CYCLE), timing.endCycle); } }} aria-label={`Set ${block.name} start point, currently cycle ${formatCycle(timing.startCycle)}`} title={`In ${formatCycle(timing.startCycle)} cycles`} />
					<span>{block.name.toUpperCase()}</span><small>{timingLabel}</small>
					<button className="clip-handle clip-handle-end" type="button" onPointerDown={(event) => onStartTimingDrag(event, block.id, 'end')} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const delta = event.key === 'ArrowLeft' ? -TIMELINE_SNAP_CYCLE : TIMELINE_SNAP_CYCLE; onSetTrackRange(block.id, timing.startCycle, Math.max(timing.startCycle + TIMELINE_SNAP_CYCLE, timing.endCycle + delta)); } }} aria-label={`Set ${block.name} end point, currently cycle ${formatCycle(timing.endCycle)}`} title={`Out ${formatCycle(timing.endCycle)} cycles`} />
				</div>
				<span className={`lane-playhead ${runtime.transport === 'playing' ? 'lane-playhead-live' : ''}`} aria-hidden="true" />
			</div>
		</div>
	);
}
