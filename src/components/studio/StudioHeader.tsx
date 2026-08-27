import type { ChangeEvent, RefObject } from 'react';
import type { RuntimeState } from '../../lib/project/model';
import type { SourceGlobals } from '../../lib/project/source-mapper';
import { EDITOR_PRESETS, type EditorPreset } from '../../lib/project/presets';
import {
	formatClock,
	formatCycle,
	formatKeyDisplay,
	getKeyParts,
	KEY_ROOT_OPTIONS,
} from './helpers';
import type { HeaderPopover, PersistenceState } from './types';

export interface StudioHeaderProps {
	headerRef: RefObject<HTMLElement | null>;
	projectName: string;
	persistenceState: PersistenceState;
	saveStateLabel: string;
	isDirty: boolean;
	isBusy: boolean;
	canPlay: boolean;
	runtime: RuntimeState;
	sourceGlobals: SourceGlobals;
	draftGlobals: SourceGlobals;
	draftBpm: number;
	draftKey: ReturnType<typeof getKeyParts>;
	currentSeconds: number;
	songEndSeconds: number;
	openPopover: HeaderPopover | null;
	canUndo: boolean;
	canRedo: boolean;
	projectImportInputRef: RefObject<HTMLInputElement | null>;
	onTogglePopover: (popover: HeaderPopover) => void;
	onProjectNameChange: (name: string) => void;
	onPersistProject: () => void;
	onSetTempo: (bpm: number) => void;
	onSetQuarterNotesPerCycle: (value: number) => void;
	onSetKey: (key: string) => void;
	onRevertSource: () => void;
	onCommitSource: () => void;
	onUndoSource: () => void;
	onRedoSource: () => void;
	onExportProject: () => void;
	onImportProject: (event: ChangeEvent<HTMLInputElement>) => void;
	onPlay: () => void;
	onPause: () => void;
	onStop: () => void;
	onLoadPreset: (preset: EditorPreset) => void;
}

export function StudioHeader({
	headerRef,
	projectName,
	persistenceState,
	saveStateLabel,
	isDirty,
	isBusy,
	canPlay,
	runtime,
	sourceGlobals,
	draftGlobals,
	draftBpm,
	draftKey,
	currentSeconds,
	songEndSeconds,
	openPopover,
	canUndo,
	canRedo,
	projectImportInputRef,
	onTogglePopover,
	onProjectNameChange,
	onPersistProject,
	onSetTempo,
	onSetQuarterNotesPerCycle,
	onSetKey,
	onRevertSource,
	onCommitSource,
	onUndoSource,
	onRedoSource,
	onExportProject,
	onImportProject,
	onPlay,
	onPause,
	onStop,
	onLoadPreset,
}: StudioHeaderProps) {
	return (
		<header className="studio-topbar" ref={headerRef}>
			<div className="topbar-brand-group">
				<a className="wordmark" href="/" aria-label="Sushi home">
					<span className="wordmark-mark" aria-hidden="true">◒</span> sushi
				</a>
			</div>
			<div className="topbar-session">
				<div className="session-name-row">
					<label className="sr-only" htmlFor="project-name">Project name</label>
					<input id="project-name" className="project-name-input" value={projectName} onChange={(event) => onProjectNameChange(event.target.value)} onBlur={onPersistProject} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Project name" title="Rename project" />
					<div className="topbar-preset-control">
						<button className="topbar-preset-button" type="button" onClick={() => onTogglePopover('presets')} disabled={isBusy} aria-expanded={openPopover === 'presets'} aria-haspopup="dialog" aria-label="Load a preset" title="Load a preset">Presets</button>
						{openPopover === 'presets' ? (
							<div className="topbar-preset-popover" role="dialog" aria-label="Load a preset">
								<div className="preset-popover-heading">
									<strong className="topbar-popover-title">Load a preset</strong>
									<span>Replace the editor source. Undo restores the current source.</span>
								</div>
								<div className="preset-list">
									{EDITOR_PRESETS.map((preset) => (
										<button className="preset-option" type="button" key={preset.id} onClick={() => onLoadPreset(preset)} disabled={isBusy}>
											<span className="preset-option-heading"><strong>{preset.name}</strong><small>{preset.bpm} BPM · {preset.key}</small></span>
											<span className="preset-option-description">{preset.description}</span>
											<span className="preset-option-meta">{preset.lanes} SOURCE LANES</span>
										</button>
									))}
								</div>
							</div>
						) : null}
					</div>
					<span className={`save-state ${isDirty || persistenceState === 'loading' ? 'save-state-dirty' : ''}`} title={persistenceState === 'unavailable' ? 'IndexedDB is unavailable; this session will not persist after reload.' : 'Project state is saved locally'}><span className="save-dot" aria-hidden="true" />{saveStateLabel}</span>
				</div>
				<div className="topbar-transport" aria-label="Transport controls">
					<div className="topbar-transport-left">
						<div className="topbar-global-controls" aria-label="Tempo and key controls">
							<div className="topbar-global-control topbar-bpm-control">
								<button className="topbar-control-trigger" type="button" onClick={() => onTogglePopover('tempo')} disabled={isBusy} aria-expanded={openPopover === 'tempo'} aria-haspopup="dialog" aria-label={`Tempo, ${draftBpm} beats per minute`} title="Open tempo controls">
									<strong>{draftBpm}</strong><span>BPM</span>
								</button>
								{openPopover === 'tempo' ? <TempoPopover draftBpm={draftBpm} isBusy={isBusy} onSetTempo={onSetTempo} /> : null}
							</div>
							<label className="topbar-quarter-control" title="Set quarter notes per Strudel cycle">
								<span className="sr-only">Quarter notes per Strudel cycle</span>
								<input type="number" min="1" max="32" step="1" value={formatCycle(draftGlobals.quarterNotesPerCycle)} onChange={(event) => onSetQuarterNotesPerCycle(Number(event.target.value))} disabled={isBusy} aria-label="Quarter notes per Strudel cycle" />
								<span className="topbar-quarter-unit">Q/C</span>
							</label>
							<div className="topbar-global-control topbar-key-control">
								<button className="topbar-control-trigger" type="button" onClick={() => onTogglePopover('key')} disabled={isBusy} aria-expanded={openPopover === 'key'} aria-haspopup="dialog" aria-label={`Musical key, ${formatKeyDisplay(draftGlobals.key)}`} title="Open musical key controls">
									<strong>{formatKeyDisplay(draftGlobals.key)}</strong>
									<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 6 5 5 5-5" /></svg>
								</button>
								{openPopover === 'key' ? <KeyPopover draftKey={draftKey} onSetKey={onSetKey} /> : null}
							</div>
						</div>
						<div className="topbar-source-actions" aria-label="Source actions">
							<button className="transport-button source-action-button source-action-revert" type="button" onClick={onRevertSource} disabled={!isDirty || isBusy} aria-label="Revert source draft" title="Revert source draft">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H5v4" /><path d="M5.2 11A7.5 7.5 0 1 0 7.4 5.6L5 7" /></svg>
							</button>
							<button className="transport-button source-action-button source-action-commit" type="button" onClick={onCommitSource} disabled={!isDirty || isBusy} aria-label="Commit source" title="Commit source">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
							</button>
						</div>
					</div>
					<div className="transport-playback" aria-label="Playback controls">
						<button className="transport-button transport-stop" type="button" onClick={onStop} disabled={!canPlay || (runtime.transport === 'stopped' && runtime.currentCycle === 0)} aria-label="Stop playback" title="Stop and return to cycle zero">■</button>
						<button className="transport-button transport-play" type="button" onClick={onPlay} disabled={!canPlay} aria-label={runtime.transport === 'paused' ? 'Resume playback' : 'Play accepted source'} title={runtime.transport === 'paused' ? 'Resume playback' : 'Play accepted source'}>▶</button>
						<button className="transport-button transport-pause" type="button" onClick={onPause} disabled={!canPlay || runtime.transport !== 'playing'} aria-label="Pause playback" title="Pause at the current cycle">Ⅱ</button>
					</div>
					<div className="topbar-transport-right">
						<div className="topbar-source-actions-right" aria-label="Source history and project actions">
							<button className="transport-button source-action-button" type="button" onClick={onUndoSource} disabled={isBusy || isDirty || !canUndo} aria-label="Undo source edit" title="Undo source edit">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8 4 12l5 4" /><path d="M4 12h8a6 6 0 0 1 6 6" /></svg>
							</button>
							<button className="transport-button source-action-button" type="button" onClick={onRedoSource} disabled={isBusy || isDirty || !canRedo} aria-label="Redo source edit" title="Redo source edit">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 8 5 4-5 4" /><path d="M20 12h-8a6 6 0 0 0-6 6" /></svg>
							</button>
							<button className="transport-button source-action-button" type="button" onClick={onExportProject} disabled={isBusy} aria-label="Export Sushi project" title="Export project">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11" /><path d="m8 8 4-4 4 4" /><path d="M5 14v5h14v-5" /></svg>
							</button>
							<button className="transport-button source-action-button" type="button" onClick={() => projectImportInputRef.current?.click()} disabled={isBusy} aria-label="Import Sushi project" title="Import project">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V9" /><path d="m8 16 4 4 4-4" /><path d="M5 10V5h14v5" /></svg>
							</button>
							<input ref={projectImportInputRef} className="project-import-input" type="file" accept="application/json,.json" onChange={onImportProject} aria-label="Import Sushi project file" />
						</div>
						<div className="transport-status" aria-label="Playback status">
							<span className="transport-clock" aria-live="polite">{formatClock(currentSeconds)}</span>
							<span className="transport-cycle" aria-live="polite">CYCLE {formatCycle(runtime.currentCycle)}</span>
							<span className="transport-divider" aria-hidden="true" />
							<span className="transport-readout">{runtime.audioState === 'initializing' ? 'PREPARING' : runtime.transport.toUpperCase()}</span>
						</div>
					</div>
				</div>
			</div>
			<div className="topbar-right">
				<div className="topbar-metrics" aria-label="Project settings"><span>{formatCycle(sourceGlobals.quarterNotesPerCycle)} Q/C</span><span>{formatCycle(songEndSeconds)}s</span></div>
				<div className="topbar-help-control">
					<button className="topbar-help-button" type="button" onClick={() => onTogglePopover('help')} disabled={isBusy} aria-expanded={openPopover === 'help'} aria-haspopup="dialog" aria-label="Keyboard shortcuts" title="Show keyboard shortcuts">?</button>
					{openPopover === 'help' ? <HelpPopover /> : null}
				</div>
			</div>
		</header>
	);
}

function TempoPopover({ draftBpm, isBusy, onSetTempo }: { draftBpm: number; isBusy: boolean; onSetTempo: (bpm: number) => void }) {
	return (
		<div className="topbar-global-popover tempo-popover" role="dialog" aria-label="Tempo settings">
			<strong className="topbar-popover-title">Tempo</strong>
			<div className="tempo-stepper">
				<button className="tempo-step-button" type="button" onClick={() => onSetTempo(Math.max(0, draftBpm - 1))} disabled={isBusy || draftBpm <= 0} aria-label="Decrease tempo by 1 BPM" title="Decrease tempo by 1 BPM">−</button>
				<label className="tempo-value-field">
					<span className="sr-only">Tempo in beats per minute</span>
					<input autoFocus type="number" min="0" max="300" step="1" value={draftBpm} onChange={(event) => onSetTempo(Number(event.target.value))} disabled={isBusy} aria-label="Tempo in beats per minute" />
					<span>BPM</span>
				</label>
				<button className="tempo-step-button" type="button" onClick={() => onSetTempo(Math.min(300, draftBpm + 1))} disabled={isBusy || draftBpm >= 300} aria-label="Increase tempo by 1 BPM" title="Increase tempo by 1 BPM">+</button>
			</div>
			<span className="topbar-popover-note">SOURCE · setcpm</span>
		</div>
	);
}

function KeyPopover({ draftKey, onSetKey }: { draftKey: ReturnType<typeof getKeyParts>; onSetKey: (key: string) => void }) {
	return (
		<div className="topbar-global-popover key-popover" role="dialog" aria-label="Musical key settings">
			<strong className="topbar-popover-title">Musical key</strong>
			<div className="key-quality-toggle" role="group" aria-label="Key quality">
				{(['major', 'minor'] as const).map((mode) => (
					<button className={draftKey.mode === mode ? 'key-quality-button key-quality-button-active' : 'key-quality-button'} type="button" onClick={() => onSetKey(`${draftKey.root}:${mode}`)} aria-pressed={draftKey.mode === mode}>{mode === 'major' ? 'Major' : 'Minor'}</button>
				))}
			</div>
			<div className="key-root-grid" role="group" aria-label="Key root">
				<div className="key-root-row key-root-row-accidentals">
					{KEY_ROOT_OPTIONS.filter((root) => root.alternate).map((root) => (
						<button className={draftKey.root === root.value ? 'key-root-button key-root-button-active' : 'key-root-button'} type="button" onClick={() => onSetKey(`${root.value}:${draftKey.mode}`)} aria-pressed={draftKey.root === root.value} aria-label={`${root.value} or ${root.alternate}`} key={root.value}>
							<span>{root.label}</span><small>{root.alternate}</small>
						</button>
					))}
				</div>
				<div className="key-root-row key-root-row-naturals">
					{KEY_ROOT_OPTIONS.filter((root) => !root.alternate).map((root) => (
						<button className={draftKey.root === root.value ? 'key-root-button key-root-button-active' : 'key-root-button'} type="button" onClick={() => onSetKey(`${root.value}:${draftKey.mode}`)} aria-pressed={draftKey.root === root.value} aria-label={root.value} key={root.value}>
							<span>{root.label}</span>
						</button>
					))}
				</div>
			</div>
			<span className="topbar-popover-note">SOURCE · const key</span>
		</div>
	);
}

function HelpPopover() {
	return (
		<div className="topbar-help-popover" role="dialog" aria-label="Keyboard shortcuts">
			<strong className="topbar-popover-title">Keyboard shortcuts</strong>
			<div className="hotkey-list">
				<div className="hotkey-item"><kbd>⌘ / Ctrl + Enter</kbd><span>Validate source</span></div>
				<div className="hotkey-item"><kbd>Backspace / Delete</kbd><span>Delete selected track</span></div>
				<div className="hotkey-item"><kbd>Right-click</kbd><span>Track actions</span></div>
				<div className="hotkey-item"><kbd>← / →</kbd><span>Nudge a clip by ¼ bar</span></div>
			</div>
		</div>
	);
}
