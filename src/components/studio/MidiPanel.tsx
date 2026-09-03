import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { SourceBlockSummary } from '../../lib/project/model';
import { midiToNoteName } from '../../lib/project/note-grid';
import { COMPUTER_KEYBOARD_INPUT_ID } from '../../lib/midi/service';
import { MIDI_CHANNELS, MIDI_QUANTIZE_GRIDS, type MidiChannel, type MidiClockMode, type MidiRecordMode, type MidiQuantizeGrid, type MidiRecordingOptions, type MidiRuntimeState } from '../../lib/midi/types';

export interface MidiPanelProps {
	state: MidiRuntimeState;
	tracks: readonly SourceBlockSummary[];
	selectedTrackId: string | null;
	trackColor?: string;
	isBusy: boolean;
	onClose: () => void;
	onConnect: (sysex: boolean) => void;
	onDisconnect: () => void;
	onRefresh: () => void;
	onSelectInput: (id: string | null) => void;
	onSelectOutput: (id: string | null) => void;
	onSetInputChannel: (channel: MidiChannel) => void;
	onSetOutputChannel: (channel: number) => void;
	onSetMonitor: (enabled: boolean) => void;
	onBeginControlLearn: () => void;
	onSetClockMode: (mode: MidiClockMode) => void;
	onPanic: () => void;
	onTestNote: () => void;
	onRecordNow: (options: MidiRecordingOptions) => void;
	onStartRecording: () => void;
	onStopRecording: () => void;
	onCancelRecording: () => void;
	onRetryRecording: () => void;
	onAcceptTake: () => void;
}

const panelStyle = (color?: string): CSSProperties => color ? { '--midi-accent': color } as CSSProperties : {};

function statusLabel(state: MidiRuntimeState): string {
	if (!state.supported) return 'NOT SUPPORTED';
	if (!state.secureContext) return 'HTTPS / LOCALHOST REQUIRED';
	if (state.permission === 'denied') return 'PERMISSION DENIED';
	if (!state.enabled) return 'DISCONNECTED';
	return `${state.inputs.length} IN · ${state.outputs.length} OUT`;
}

function channelLabel(channel: MidiChannel): string {
	return channel === 'all' ? 'All channels' : `Channel ${channel}`;
}

export function MidiPanel({
	state,
	tracks,
	selectedTrackId,
	trackColor,
	isBusy,
	onClose,
	onConnect,
	onDisconnect,
	onRefresh,
	onSelectInput,
	onSelectOutput,
	onSetInputChannel,
	onSetOutputChannel,
	onSetMonitor,
	onBeginControlLearn,
	onSetClockMode,
	onPanic,
	onTestNote,
	onRecordNow,
	onStartRecording,
	onStopRecording,
	onCancelRecording,
	onRetryRecording,
	onAcceptTake,
}: MidiPanelProps) {
	const recordableTracks = tracks.filter((track) => track.type === 'midi');
	const initialTargetTrack = selectedTrackId && recordableTracks.some((track) => track.id === selectedTrackId) ? selectedTrackId : recordableTracks[0]?.id ?? '';
	const [targetTrackId, setTargetTrackId] = useState(initialTargetTrack);
	const [inputSource, setInputSource] = useState<'computer-keyboard' | 'midi'>('computer-keyboard');
	const inputSourceTouchedRef = useRef(false);
	const [recordMode, setRecordMode] = useState<MidiRecordMode>('replace');
	const [quantize, setQuantize] = useState<MidiQuantizeGrid>('1/16');
	const [quantizeStrength, setQuantizeStrength] = useState(1);
	const [swing, setSwing] = useState(0);
	const [countInBars, setCountInBars] = useState<0 | 1 | 2>(0);
	const [loop, setLoop] = useState(false);
	const [captureAutomation, setCaptureAutomation] = useState(true);

	useEffect(() => {
		if (targetTrackId && recordableTracks.some((track) => track.id === targetTrackId)) return;
		setTargetTrackId(selectedTrackId && recordableTracks.some((track) => track.id === selectedTrackId) ? selectedTrackId : recordableTracks[0]?.id ?? '');
	}, [recordableTracks, selectedTrackId, targetTrackId]);

	useEffect(() => {
		if (!state.enabled || !state.selectedInputId) {
			inputSourceTouchedRef.current = false;
			if (inputSource !== 'computer-keyboard') setInputSource('computer-keyboard');
			return;
		}
		if (!inputSourceTouchedRef.current) setInputSource('midi');
	}, [inputSource, state.enabled, state.selectedInputId]);

	const recording = state.recording;
	const previewTake = recording.take;
	const previewStart = previewTake?.startedAtCycle ?? 0;
	const previewEnd = previewTake ? Math.max(previewStart + 0.000001, previewTake.endedAtCycle) : previewStart + 1;
	const previewSpan = previewEnd - previewStart;
	const recordingInputId = inputSource === 'computer-keyboard' ? COMPUTER_KEYBOARD_INPUT_ID : state.selectedInputId ?? undefined;
	const canRecord = Boolean(targetTrackId) && Boolean(recordingInputId) && recording.status === 'idle' && (inputSource === 'computer-keyboard' || state.enabled);
	const options: MidiRecordingOptions = {
		trackId: targetTrackId,
		inputId: recordingInputId,
		channel: inputSource === 'computer-keyboard' ? 1 : state.inputChannel,
		mode: recordMode,
		quantize,
		quantizeStrength,
		swing,
		countInBars,
		loop,
		captureAutomation,
	};

	return (
		<aside className="midi-panel" style={panelStyle(trackColor)} role="dialog" aria-modal="false" aria-labelledby="midi-panel-title">
			<header className="midi-panel-header">
				<div>
					<span className="midi-panel-kicker">HARDWARE I/O</span>
					<h2 id="midi-panel-title">MIDI</h2>
				</div>
				<div className="midi-panel-header-actions">
					<span className={`midi-status-dot ${state.enabled ? 'midi-status-dot-live' : ''}`} aria-hidden="true" />
					<button className="midi-panel-close" type="button" onClick={onClose} aria-label="Close MIDI panel" title="Close MIDI panel">×</button>
				</div>
			</header>

			<div className="midi-panel-status-row">
				<strong>{statusLabel(state)}</strong>
				{state.enabled ? <button type="button" className="midi-secondary-button" onClick={onRefresh} disabled={isBusy}>Refresh</button> : null}
			</div>
			{state.lastError ? <p className="midi-panel-error" role="alert"><strong>{state.lastError.code}</strong> {state.lastError.message}</p> : null}
			{!state.supported ? <p className="midi-panel-note">This browser does not expose Web MIDI. Try a Chromium-based browser over HTTPS or localhost.</p> : null}
			{state.supported && !state.secureContext ? <p className="midi-panel-note">MIDI permissions are available only from HTTPS or localhost.</p> : null}

			<section className="midi-panel-section" aria-labelledby="midi-devices-heading">
				<div className="midi-panel-section-heading"><h3 id="midi-devices-heading">Devices</h3><span>{state.sysexEnabled ? 'SYSEX ON' : 'SYSEX OFF'}</span></div>
				{!state.enabled ? (
					<div className="midi-connect-row">
						<button className="midi-primary-button" type="button" onClick={() => onConnect(false)} disabled={isBusy || !state.supported || !state.secureContext}>Connect MIDI</button>
						<label className="midi-checkbox midi-advanced-checkbox"><input type="checkbox" checked={state.sysexEnabled} onChange={(event) => { if (event.target.checked) onConnect(true); }} disabled={isBusy || state.enabled || !state.supported || !state.secureContext} /><span>Enable SysEx on connect</span></label>
					</div>
				) : (
					<button className="midi-secondary-button" type="button" onClick={onDisconnect} disabled={isBusy || recording.status === 'recording'}>Disconnect</button>
				)}
				<div className="midi-device-grid">
					<label><span>Hardware input</span><select value={state.selectedInputId ?? ''} onChange={(event) => onSelectInput(event.target.value || null)} disabled={!state.enabled || recording.status !== 'idle'}><option value="">None</option>{state.inputs.map((port) => <option value={port.id} key={port.id}>{port.manufacturer ? `${port.manufacturer} · ` : ''}{port.name}{port.state === 'disconnected' ? ' · offline' : ''}</option>)}</select></label>
					<label><span>Output</span><select value={state.selectedOutputId ?? ''} onChange={(event) => onSelectOutput(event.target.value || null)} disabled={!state.enabled}><option value="">None</option>{state.outputs.map((port) => <option value={port.id} key={port.id}>{port.manufacturer ? `${port.manufacturer} · ` : ''}{port.name}{port.state === 'disconnected' ? ' · offline' : ''}</option>)}</select></label>
				</div>
				<div className="midi-device-grid">
					<label><span>Input channel</span><select value={String(state.inputChannel)} onChange={(event) => onSetInputChannel(event.target.value === 'all' ? 'all' : Number(event.target.value) as number)} disabled={!state.enabled || recording.status !== 'idle'}><option value="all">All channels</option>{MIDI_CHANNELS.map((channel) => <option value={channel} key={channel}>{channelLabel(channel)}</option>)}</select></label>
					<label><span>Output channel</span><select value={state.outputChannel} onChange={(event) => onSetOutputChannel(Number(event.target.value))} disabled={!state.enabled}>{MIDI_CHANNELS.map((channel) => <option value={channel} key={channel}>{channelLabel(channel)}</option>)}</select></label>
				</div>
				<div className="midi-learn-row"><button className="midi-secondary-button" type="button" onClick={onBeginControlLearn} disabled={!state.enabled}>{state.learning ? 'Move a CC now…' : 'Learn next CC'}</button>{state.learnedControl ? <span>CC {state.learnedControl.controller} · {Math.round(state.learnedControl.value * 127)}{state.learnedControl.channel ? ` · CH ${state.learnedControl.channel}` : ''}</span> : null}</div>
				<div className="midi-toggle-row">
					<label className="midi-checkbox"><input type="checkbox" checked={state.monitor} onChange={(event) => onSetMonitor(event.target.checked)} disabled={!state.enabled} /><span>Input monitor / thru</span></label>
					<label className="midi-inline-field"><span>Clock</span><select value={state.clockMode} onChange={(event) => onSetClockMode(event.target.value as MidiClockMode)} disabled={!state.enabled}><option value="off">Off</option><option value="send">Send</option><option value="receive">Receive</option></select></label>
				</div>
				{state.clockMode === 'send' && state.clockRunning ? <p className="midi-clock-note">Sending 24 PPQN at transport tempo.</p> : null}
				{state.clockMode === 'receive' && state.externalClockRunning ? <p className="midi-clock-note">External clock · {state.externalClockBpm ? `${state.externalClockBpm} BPM` : 'waiting for tempo'}</p> : null}
			</section>

			<section className="midi-panel-section midi-safety-section" aria-labelledby="midi-safety-heading">
				<div className="midi-panel-section-heading"><h3 id="midi-safety-heading">Safety</h3><span>HARDWARE</span></div>
				<div className="midi-safety-actions"><button className="midi-danger-button" type="button" onClick={onPanic} disabled={!state.enabled}>Panic / all notes off</button><button className="midi-secondary-button" type="button" onClick={onTestNote} disabled={!state.enabled || !state.selectedOutputId}>Test C4</button></div>
			</section>

			<section className="midi-panel-section midi-record-section" aria-labelledby="midi-record-heading">
				<div className="midi-panel-section-heading"><h3 id="midi-record-heading">Record</h3><span>{recording.status.toUpperCase()}</span></div>
				<label><span>Note source</span><select value={inputSource} onChange={(event) => { inputSourceTouchedRef.current = true; setInputSource(event.target.value as 'computer-keyboard' | 'midi'); }} disabled={recording.status !== 'idle'}><option value="computer-keyboard">Computer keyboard · A W S E D F…</option>{state.enabled && state.selectedInputId ? <option value="midi">MIDI hardware · {state.inputs.find((port) => port.id === state.selectedInputId)?.name ?? 'selected input'}</option> : null}</select></label>
				<label><span>Target MIDI track</span><select value={targetTrackId} onChange={(event) => setTargetTrackId(event.target.value)} disabled={recording.status !== 'idle' || !recordableTracks.length}><option value="">Choose a MIDI track</option>{recordableTracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}</select></label>
				<p className="midi-panel-note">{inputSource === 'computer-keyboard' ? <>Computer keys play immediately: <kbd>A</kbd> <kbd>W</kbd> <kbd>S</kbd> <kbd>E</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>T</kbd> <kbd>G</kbd> <kbd>Y</kbd> <kbd>H</kbd> <kbd>U</kbd> <kbd>J</kbd> <kbd>K</kbd>. Hold Shift for the next octave.</> : 'Recording from the selected MIDI hardware input.'}</p>
				<div className="midi-record-grid">
					<label><span>Mode</span><select value={recordMode} onChange={(event) => setRecordMode(event.target.value as MidiRecordMode)} disabled={recording.status !== 'idle'}><option value="replace">Replace source</option><option value="overdub">Overdub notes</option></select></label>
					<label><span>Quantize</span><select value={quantize} onChange={(event) => setQuantize(event.target.value as MidiQuantizeGrid)} disabled={recording.status !== 'idle'}>{MIDI_QUANTIZE_GRIDS.map((grid) => <option value={grid} key={grid}>{grid === 'off' ? 'Off' : grid.replace('T', ' triplet')}</option>)}</select></label>
				</div>
				<div className="midi-record-grid">
					<label><span>Count-in</span><select value={countInBars} onChange={(event) => setCountInBars(Number(event.target.value) as 0 | 1 | 2)} disabled={recording.status !== 'idle'}><option value="0">Off</option><option value="1">1 bar</option><option value="2">2 bars</option></select></label>
					<label><span>Input channel</span><span className="midi-readonly-value">{channelLabel(state.inputChannel)}</span></label>
				</div>
				<label className="midi-range-field"><span>Quantize strength <b>{Math.round(quantizeStrength * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value={quantizeStrength} onChange={(event) => setQuantizeStrength(Number(event.target.value))} disabled={recording.status !== 'idle' || quantize === 'off'} /></label>
				<label className="midi-range-field"><span>Swing <b>{Math.round(swing * 100)}%</b></span><input type="range" min="0" max="0.5" step="0.01" value={swing} onChange={(event) => setSwing(Number(event.target.value))} disabled={recording.status !== 'idle' || quantize === 'off'} /></label>
				<div className="midi-toggle-row midi-record-options"><label className="midi-checkbox"><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} disabled={recording.status !== 'idle'} /><span>Loop record</span></label><label className="midi-checkbox"><input type="checkbox" checked={captureAutomation} onChange={(event) => setCaptureAutomation(event.target.checked)} disabled={recording.status !== 'idle'} /><span>Capture CC / automation</span></label></div>
				<div className="midi-record-actions">
					{recording.status === 'idle' ? <button className="midi-primary-button midi-record-button" type="button" onClick={() => onRecordNow(options)} disabled={!canRecord}>Record now</button> : null}
					{recording.status === 'armed' ? <><button className="midi-primary-button midi-record-button" type="button" onClick={onStartRecording}>Start {countInBars ? `after ${countInBars} bar${countInBars === 1 ? '' : 's'}` : 'now'}</button><button className="midi-secondary-button" type="button" onClick={onCancelRecording}>Cancel</button></> : null}
					{recording.status === 'count-in' || recording.status === 'recording' ? <button className="midi-danger-button midi-stop-record-button" type="button" onClick={onStopRecording}>Stop & save</button> : null}
					{recording.status === 'review' ? <><button className="midi-primary-button" type="button" onClick={onAcceptTake}>Keep take ({recording.noteCount} notes)</button><button className="midi-secondary-button" type="button" onClick={onRetryRecording} disabled={!state.enabled}>Retry</button><button className="midi-secondary-button" type="button" onClick={onCancelRecording}>Cancel</button></> : null}
				</div>
				{recording.status !== 'idle' ? <p className="midi-record-summary">{recording.noteCount} notes · {recording.automationCount} automation · {recording.activeNoteCount} held · target {tracks.find((track) => track.id === recording.trackId)?.name ?? recording.trackId ?? '—'}</p> : null}
				{recording.take ? <div className="midi-take-preview" aria-label="MIDI take preview"><div className="midi-take-preview-heading"><span>{recording.status === 'recording' || recording.status === 'stopping' ? 'Live preview' : 'Review preview'}</span><strong>{recording.take.truncated ? 'FIRST 256' : recording.status === 'recording' ? 'UPDATING' : 'COMPLETE'}</strong></div><div className="midi-take-roll" role="img" aria-label={`${recording.take.notes.length} captured notes from cycle ${previewStart.toFixed(2)} to ${previewEnd.toFixed(2)}`}>{recording.take.notes.slice(0, 256).map((note) => <span className="midi-take-roll-note" key={note.id} title={`${midiToNoteName(note.note)} · ${note.startCycle.toFixed(2)}–${note.endCycle.toFixed(2)}`} style={{ left: `${Math.max(0, Math.min(100, ((note.startCycle - previewStart) / previewSpan) * 100))}%`, width: `${Math.max(0.35, Math.min(100, ((note.endCycle - note.startCycle) / previewSpan) * 100))}%`, top: `${Math.max(0, Math.min(94, ((127 - note.note) / 128) * 100))}%`, opacity: Math.max(0.25, Math.min(1, note.velocity)) }} />)}{!recording.take.notes.length ? <span className="midi-take-roll-empty">No note events captured.</span> : null}</div><div className="midi-take-note-list">{recording.take.notes.slice(0, 16).map((note) => <span key={note.id}>{midiToNoteName(note.note)} <small>{note.startCycle.toFixed(2)}–{note.endCycle.toFixed(2)}</small></span>)}{recording.take.notes.length > 16 ? <span className="midi-take-more">+{recording.take.notes.length - 16} more</span> : null}</div></div> : null}
			</section>

			{state.lastActivity ? <footer className="midi-panel-footer" aria-live="polite"><span className="midi-activity-led" aria-hidden="true" />{state.lastActivity.kind}{state.lastActivity.note === undefined ? '' : ` · ${midiToNoteName(state.lastActivity.note)}`}{state.lastActivity.kind === 'controlchange' && state.lastActivity.data1 !== undefined ? ` · CC ${state.lastActivity.data1}=${state.lastActivity.data2 ?? 0}` : ''}{state.lastActivity.channel === undefined ? '' : ` · CH ${state.lastActivity.channel}`}</footer> : null}
		</aside>
	);
}
