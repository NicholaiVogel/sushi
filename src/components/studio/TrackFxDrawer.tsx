import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { SourceBlockSummary } from '../../lib/project/model';
import type { MidiRuntimeState } from '../../lib/midi/types';
import {
	listTrackEffectDefinitions,
	type TrackEffectDefinition,
	type TrackEffectGroup,
	type TrackEffectInput,
	type TrackEffectMethod,
	type TrackEffectParameter,
} from '../../lib/strudel/track-effects';
import { listStrudelSounds, searchStrudelSounds, type StrudelSoundType } from '../../lib/strudel/sounds';
import {
	type SourceEffect,
	type TrackMidiRouteUpdate,
} from '../../lib/project/source-mapper';
import type { TrackDetails } from './types';

export type TrackFxDrawerMode = 'effects' | 'sounds' | 'midi';

export function normalizeTrackFxDrawerMode(mode: TrackFxDrawerMode, experimentalMidi: boolean): TrackFxDrawerMode {
	return !experimentalMidi && mode === 'midi' ? 'effects' : mode;
}

export interface TrackFxDrawerProps {
	track: SourceBlockSummary;
	experimentalMidi: boolean;
	trackColor: string;
	trackDetails?: TrackDetails;
	isBusy: boolean;
	onClose: () => void;
	onSetSlider: (trackId: string, sliderId: string, value: number) => void;
	onSetEffect: (trackId: string, effectId: string, value: TrackEffectInput, parameterIndex?: number) => void;
	onToggleEffect: (trackId: string, effectId: string, enabled: boolean) => void;
	onAddEffect: (trackId: string, method: TrackEffectMethod) => void;
	onRemoveEffect: (trackId: string, effectId: string) => void;
	onReorderEffect: (trackId: string, effectId: string, direction: 'up' | 'down') => void;
	onSetSound: (trackId: string, value: string, soundId?: string) => void;
	midiState: MidiRuntimeState;
	onSetMidiRoute: (trackId: string, output: string | null, channel: number, enabled: boolean, settings?: Pick<TrackMidiRouteUpdate, 'velocity' | 'gain' | 'noteOffsetMs' | 'midimap' | 'program'>) => void;
	onSetMidiInstrument: (trackId: string, instrument: string | null) => void;
	onOpenMidiPanel: () => void;
	onTestMidi: () => void;
}

function formatValue(value: number): string {
	if (Math.abs(value) >= 100) return Math.round(value).toString();
	return Number(value.toFixed(3)).toString();
}

function formatParameterValue(parameter: TrackEffectParameter): string {
	if (parameter.kind === 'random') return 'RAND';
	if (parameter.kind === 'dynamic' || parameter.type !== 'number') return parameter.expression || 'SOURCE';
	return formatValue(parameter.value ?? (typeof parameter.defaultValue === 'number' ? parameter.defaultValue : 0));
}

function effectMode(parameter: TrackEffectParameter): 'manual' | 'random' | 'source' {
	if (parameter.kind === 'random') return 'random';
	if (parameter.kind === 'dynamic') return 'source';
	return 'manual';
}

function effectIsEnabled(effect: SourceEffect): boolean {
	return effect.enabled !== false;
}

function effectSummary(effects: SourceEffect[]): string {
	if (!effects.length) return 'EMPTY CHAIN';
	const enabled = effects.filter(effectIsEnabled).length;
	const bypassed = effects.length - enabled;
	return `${enabled} ACTIVE${bypassed ? ` · ${bypassed} BYPASSED` : ''}`;
}

function groupLabel(group: TrackEffectDefinition['group']): string {
	return group.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function soundTypeLabel(type: StrudelSoundType): string {
	return type.replace(/[-_]+/g, ' ');
}

function soundCategoryLabel(category: string): string {
	return category.replace(/[-_]+/g, ' ');
}

function humanizeLabel(value: string): string {
	return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function sourceStringLiteral(value: string): string {
	return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

interface EffectPickerPosition {
	left: number;
	width: number;
	maxHeight: number;
	top?: number;
	bottom?: number;
}

function MidiTrackControls({
	track,
	trackDetails,
	midiState,
	isBusy,
	onSetMidiRoute,
	onSetMidiInstrument,
	onOpenMidiPanel,
	onTestMidi,
}: Pick<TrackFxDrawerProps, 'track' | 'trackDetails' | 'midiState' | 'isBusy' | 'onSetMidiRoute' | 'onSetMidiInstrument' | 'onOpenMidiPanel' | 'onTestMidi'>) {
	const route = trackDetails?.midi;
	const instrument = trackDetails?.instrument ?? 'sine';
	const synthInstruments = listStrudelSounds({ type: 'synth' });
	const soundfontInstruments = listStrudelSounds({ type: 'soundfont' });
	const knownInstrument = [...synthInstruments, ...soundfontInstruments].some((definition) => definition.id === instrument);
	const routeOutput = route?.output === undefined ? '' : String(route.output);
	const routeChannel = route?.channel ?? midiState.outputChannel;
	const outputOptions = [...midiState.outputs];
	if (routeOutput && !outputOptions.some((output) => output.name === routeOutput)) outputOptions.unshift({ id: `route-${routeOutput}`, name: routeOutput, type: 'output', state: 'disconnected', connection: 'unknown' });
	const enabled = route?.enabled === true;
	const routeVelocity = route?.velocity ?? 0.9;
	const routeGain = route?.gain ?? 1;
	const routeNoteOffset = route?.noteOffsetMs ?? 10;
	const routeProgram = route?.program === undefined ? '' : String(route.program);
	const routeSettings: Pick<TrackMidiRouteUpdate, 'velocity' | 'gain' | 'noteOffsetMs' | 'midimap' | 'program'> = {
		velocity: routeVelocity,
		gain: routeGain,
		noteOffsetMs: routeNoteOffset,
		...(route?.midimap === undefined ? {} : { midimap: route.midimap }),
		...(route?.program === undefined ? {} : { program: route.program }),
	};
	const setRoute = (settings: Partial<typeof routeSettings> = {}) => onSetMidiRoute(track.id, routeOutput || null, routeChannel, true, { ...routeSettings, ...settings });
	const midiOptionPreview = [
		`velocity: ${routeVelocity}`,
		`gain: ${routeGain}`,
		`noteOffsetMs: ${routeNoteOffset}`,
		...(route?.midimap ? [`midimap: ${sourceStringLiteral(route.midimap)}`] : []),
	].join(', ');
	const midiCallPreview = routeOutput
		? `.midi(${sourceStringLiteral(routeOutput)}, { ${midiOptionPreview} })`
		: `.midi({ ${midiOptionPreview} })`;
	return (
		<section className="track-fx-drawer-section track-fx-drawer-midi-controls" aria-labelledby="track-fx-midi-heading">
			<div className="track-fx-drawer-section-heading">
				<div className="track-fx-drawer-section-heading-main"><h3 id="track-fx-midi-heading">MIDI routing</h3><span>{enabled ? 'ACTIVE' : 'AUDIO ONLY'}</span></div>
				<span className="track-fx-midi-status-dot" aria-hidden="true" />
			</div>
			<p className="track-fx-midi-copy">Computer keys <code>A W S E D F T G Y H U J K</code> play immediately; hold Shift for the next octave. MIDI tracks use the shared Strudel synth. External output is optional and uses native <code>.midi()</code>.</p>
			{track.type === 'midi' ? <label className="track-fx-midi-field track-fx-midi-instrument-field"><span>Live instrument</span><select value={knownInstrument ? instrument : instrument ? '__custom__' : ''} onChange={(event) => onSetMidiInstrument(track.id, event.target.value === '__custom__' || !event.target.value ? null : event.target.value)} disabled={isBusy || !trackDetails}><option value="">Sine fallback</option>{!knownInstrument && instrument ? <option value="__custom__">Custom: {instrument}</option> : null}<optgroup label="Synth waveforms">{synthInstruments.map((definition) => <option value={definition.id} key={`synth-${definition.id}`}>{definition.label}</option>)}</optgroup><optgroup label="GM instruments">{soundfontInstruments.map((definition) => <option value={definition.id} key={`gm-${definition.id}`}>{definition.label}</option>)}</optgroup></select></label> : null}
			<label className="track-fx-midi-enable"><input type="checkbox" checked={enabled} onChange={(event) => onSetMidiRoute(track.id, routeOutput || null, routeChannel, event.target.checked, routeSettings)} disabled={isBusy || !trackDetails} /><span>Enable external MIDI output</span></label>
			<label className="track-fx-midi-field"><span>Output port</span><select value={routeOutput} onChange={(event) => onSetMidiRoute(track.id, event.target.value || null, routeChannel, true, routeSettings)} disabled={isBusy || !trackDetails || !enabled}><option value="">Default connected output</option>{outputOptions.map((output) => <option value={output.name} key={output.id}>{output.name}{output.state === 'disconnected' ? ' · offline' : ''}</option>)}</select></label>
			<label className="track-fx-midi-field"><span>Channel</span><select value={routeChannel} onChange={(event) => onSetMidiRoute(track.id, routeOutput || null, Number(event.target.value), true, routeSettings)} disabled={isBusy || !trackDetails || !enabled}>{Array.from({ length: 16 }, (_, index) => index + 1).map((channel) => <option value={channel} key={channel}>{channel}</option>)}</select></label>
			<div className="track-fx-midi-settings-grid">
				<label className="track-fx-midi-field"><span>Velocity default</span><input type="number" min="0" max="1" step="0.01" value={routeVelocity} onChange={(event) => setRoute({ velocity: Number(event.target.value) })} disabled={isBusy || !trackDetails || !enabled} /></label>
				<label className="track-fx-midi-field"><span>Gain multiplier</span><input type="number" min="0" max="1" step="0.01" value={routeGain} onChange={(event) => setRoute({ gain: Number(event.target.value) })} disabled={isBusy || !trackDetails || !enabled} /></label>
				<label className="track-fx-midi-field"><span>Note-off offset (ms)</span><input type="number" min="0" max="10000" step="1" value={routeNoteOffset} onChange={(event) => setRoute({ noteOffsetMs: Number(event.target.value) })} disabled={isBusy || !trackDetails || !enabled} /></label>
				<label className="track-fx-midi-field"><span>Program (0–127)</span><input type="number" min="0" max="127" step="1" placeholder="—" value={routeProgram} onChange={(event) => setRoute({ program: event.target.value === '' ? null : Number(event.target.value) })} disabled={isBusy || !trackDetails || !enabled} /></label>
			</div>
			<div className="track-fx-midi-route-preview"><span>Source route</span><code>{enabled ? `.midichan(${routeChannel})${midiCallPreview}${routeProgram === '' ? '' : `.progNum(${routeProgram})`}` : 'No external MIDI output'}</code></div>
			<div className="track-fx-midi-actions"><button className="track-fx-midi-connect" type="button" onClick={onOpenMidiPanel}>{midiState.enabled ? 'Open MIDI devices' : 'Connect MIDI'}</button>{enabled ? <button className="track-fx-midi-test" type="button" onClick={onTestMidi} disabled={!midiState.enabled || !midiState.selectedOutputId}>Test output</button> : null}</div>
		</section>
	);
}

export function TrackFxDrawer({
	track,
	experimentalMidi,
	trackColor,
	trackDetails,
	isBusy,
	onClose,
	onSetSlider,
	onSetEffect,
	onToggleEffect,
	onAddEffect,
	onRemoveEffect,
	onReorderEffect,
	onSetSound,
	midiState,
	onSetMidiRoute,
	onSetMidiInstrument,
	onOpenMidiPanel,
	onTestMidi,
}: TrackFxDrawerProps) {
	const [mode, setMode] = useState<TrackFxDrawerMode>('effects');
	const [addSelection, setAddSelection] = useState<TrackEffectMethod | ''>('');
	const [effectPickerOpen, setEffectPickerOpen] = useState(false);
	const [effectPickerPosition, setEffectPickerPosition] = useState<EffectPickerPosition | null>(null);
	const [effectQuery, setEffectQuery] = useState('');
	const [effectGroupFilter, setEffectGroupFilter] = useState<TrackEffectGroup | ''>('');
	const [soundQuery, setSoundQuery] = useState('');
	const [soundTypeFilter, setSoundTypeFilter] = useState<StrudelSoundType | ''>('');
	const [soundCategoryFilter, setSoundCategoryFilter] = useState('');
	const [soundPickerOpen, setSoundPickerOpen] = useState(false);
	const [soundPickerPosition, setSoundPickerPosition] = useState<EffectPickerPosition | null>(null);
	const [soundPickerTargetId, setSoundPickerTargetId] = useState('sound-0');
	const [drawerHeight, setDrawerHeight] = useState<number | undefined>();
	const visibleMode = normalizeTrackFxDrawerMode(mode, experimentalMidi);
	const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
	const sliders = trackDetails?.sliders ?? [];
	const effects = trackDetails?.effects ?? [];
	const sound = trackDetails?.sound;
	const sounds = trackDetails?.sounds ?? (sound ? [sound] : []);
	const targetSound = sounds.find((candidate) => candidate.id === soundPickerTargetId) ?? sound;
	const soundResults = searchStrudelSounds(soundQuery, {
		type: soundTypeFilter || undefined,
		category: soundCategoryFilter || undefined,
		limit: 96,
	});
	const soundResultTotal = listStrudelSounds({
		query: soundQuery,
		type: soundTypeFilter || undefined,
		category: soundCategoryFilter || undefined,
	}).length;
	const soundCatalog = listStrudelSounds();
	const soundTypeOptions = [...new Set(soundCatalog.map((definition) => definition.type))];
	const soundCategoryOptions = soundTypeFilter
		? [...new Set(listStrudelSounds({ type: soundTypeFilter }).map((definition) => definition.category))]
		: [];
	const presentMethods = new Set(effects.map((effect) => effect.method));
	const addableDefinitions = listTrackEffectDefinitions({ addable: true });
	const effectGroups = [...new Set(addableDefinitions.map((definition) => definition.group))];
	const normalizedEffectQuery = effectQuery.trim().toLowerCase();
	const filteredAddableDefinitions = addableDefinitions.filter((definition) =>
		(!effectGroupFilter || definition.group === effectGroupFilter)
		&& (!normalizedEffectQuery || `${definition.method} ${definition.label} ${definition.description}`.toLowerCase().includes(normalizedEffectQuery)),
	);
	const selectedAddDefinition = addableDefinitions.find((definition) => definition.method === addSelection);
	const effectPickerRef = useRef<HTMLDivElement>(null);
	const effectPickerPopoverRef = useRef<HTMLDivElement>(null);
	const soundPickerRef = useRef<HTMLDivElement>(null);
	const soundPickerPopoverRef = useRef<HTMLDivElement>(null);
	const soundPickerAnchorRef = useRef<HTMLElement | null>(null);
	const drawerId = 'track-fx-drawer';

	const updateEffectPickerPosition = useCallback(() => {
		const trigger = effectPickerRef.current?.querySelector('button');
		if (!(trigger instanceof HTMLElement)) return;
		const rect = trigger.getBoundingClientRect();
		const viewportPadding = 12;
		const gap = 8;
		const width = Math.min(420, Math.max(220, window.innerWidth - viewportPadding * 2));
		const desiredHeight = Math.min(360, Math.max(180, window.innerHeight - viewportPadding * 2));
		const roomAbove = Math.max(0, rect.top - gap - viewportPadding);
		const roomBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPadding);
		const opensAbove = roomAbove >= roomBelow;
		const availableHeight = opensAbove ? roomAbove : roomBelow;
		const maxHeight = Math.max(120, Math.min(desiredHeight, availableHeight || desiredHeight));
		const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
		const left = Math.min(Math.max(viewportPadding, rect.left), maxLeft);
		setEffectPickerPosition(opensAbove
			? { left, width, maxHeight, bottom: window.innerHeight - rect.top + gap }
			: { left, width, maxHeight, top: rect.bottom + gap });
	}, []);

	const toggleEffectPicker = useCallback(() => {
		if (effectPickerOpen) {
			setEffectPickerOpen(false);
			return;
		}
		setSoundPickerOpen(false);
		updateEffectPickerPosition();
		setEffectPickerOpen(true);
	}, [effectPickerOpen, updateEffectPickerPosition]);

	const updateSoundPickerPosition = useCallback(() => {
		const trigger = soundPickerAnchorRef.current ?? soundPickerRef.current?.querySelector('button');
		if (!(trigger instanceof HTMLElement)) return;
		const rect = trigger.getBoundingClientRect();
		const viewportPadding = 12;
		const gap = 8;
		const width = Math.min(540, Math.max(260, window.innerWidth - viewportPadding * 2));
		const desiredHeight = Math.min(430, Math.max(220, window.innerHeight - viewportPadding * 2));
		const roomAbove = Math.max(0, rect.top - gap - viewportPadding);
		const roomBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPadding);
		const opensAbove = roomAbove >= roomBelow;
		const availableHeight = opensAbove ? roomAbove : roomBelow;
		const maxHeight = Math.max(160, Math.min(desiredHeight, availableHeight || desiredHeight));
		const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
		const left = Math.min(Math.max(viewportPadding, rect.left), maxLeft);
		setSoundPickerPosition(opensAbove
			? { left, width, maxHeight, bottom: window.innerHeight - rect.top + gap }
			: { left, width, maxHeight, top: rect.bottom + gap });
	}, []);

	const openSoundPicker = useCallback((soundId = soundPickerTargetId, anchor?: HTMLElement) => {
		soundPickerAnchorRef.current = anchor ?? soundPickerRef.current?.querySelector('button') ?? null;
		setSoundPickerTargetId(soundId || 'sound-0');
		setEffectPickerOpen(false);
		updateSoundPickerPosition();
		setSoundPickerOpen(true);
	}, [soundPickerTargetId, updateSoundPickerPosition]);

	const toggleSoundPicker = useCallback((soundId = soundPickerTargetId, anchor?: HTMLElement) => {
		if (soundPickerOpen) {
			setSoundPickerOpen(false);
			return;
		}
		openSoundPicker(soundId, anchor);
	}, [openSoundPicker, soundPickerOpen, soundPickerTargetId]);

	useEffect(() => {
		setSoundQuery('');
		setSoundTypeFilter('');
		setSoundCategoryFilter('');
		setSoundPickerOpen(false);
		setSoundPickerTargetId('sound-0');
		soundPickerAnchorRef.current = null;
		setEffectPickerOpen(false);
		setEffectQuery('');
		setEffectGroupFilter('');
		setMode(track.type === 'midi' && experimentalMidi ? 'midi' : 'effects');
	}, [experimentalMidi, track.id, track.type]);

	useEffect(() => {
		if (mode !== 'sounds' || sounds.length <= 1) return;
		const voiceList = soundPickerRef.current?.querySelector<HTMLElement>('.track-sound-voice-list');
		voiceList?.scrollTo({ left: 0, behavior: 'auto' });
	}, [mode, sounds.length, track.id]);

	useEffect(() => {
		if (!effectPickerOpen && !soundPickerOpen) return undefined;
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (effectPickerOpen && (effectPickerRef.current?.contains(target) || effectPickerPopoverRef.current?.contains(target))) return;
			if (soundPickerOpen && (soundPickerRef.current?.contains(target) || soundPickerPopoverRef.current?.contains(target))) return;
			if (effectPickerOpen) setEffectPickerOpen(false);
			if (soundPickerOpen) setSoundPickerOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setEffectPickerOpen(false);
				setSoundPickerOpen(false);
			}
		};
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [effectPickerOpen, soundPickerOpen]);

	useEffect(() => {
		if (!effectPickerOpen) {
			setEffectPickerPosition(null);
			return undefined;
		}
		updateEffectPickerPosition();
		const handleViewportChange = () => updateEffectPickerPosition();
		window.addEventListener('resize', handleViewportChange);
		window.addEventListener('scroll', handleViewportChange, true);
		return () => {
			window.removeEventListener('resize', handleViewportChange);
			window.removeEventListener('scroll', handleViewportChange, true);
		};
	}, [effectPickerOpen, updateEffectPickerPosition]);

	useEffect(() => {
		if (!soundPickerOpen) {
			setSoundPickerPosition(null);
			return undefined;
		}
		updateSoundPickerPosition();
		const handleViewportChange = () => updateSoundPickerPosition();
		window.addEventListener('resize', handleViewportChange);
		window.addEventListener('scroll', handleViewportChange, true);
		return () => {
			window.removeEventListener('resize', handleViewportChange);
			window.removeEventListener('scroll', handleViewportChange, true);
		};
	}, [soundPickerOpen, updateSoundPickerPosition]);

	useEffect(() => {
		if (mode !== 'effects') setEffectPickerOpen(false);
		if (mode !== 'sounds') setSoundPickerOpen(false);
	}, [mode]);

	const clampDrawerHeight = useCallback((height: number) => {
		const maxHeight = Math.min(window.innerHeight * 0.9, 760);
		const minHeight = Math.min(220, maxHeight);
		setDrawerHeight(Math.max(minHeight, Math.min(maxHeight, height)));
	}, []);

	const handleResizeMove = useCallback((event: PointerEvent) => {
		const resize = resizeRef.current;
		if (!resize) return;
		clampDrawerHeight(resize.startHeight + resize.startY - event.clientY);
	}, [clampDrawerHeight]);

	const stopResize = useCallback(() => {
		resizeRef.current = null;
		window.removeEventListener('pointermove', handleResizeMove);
		window.removeEventListener('pointerup', stopResize);
		window.removeEventListener('pointercancel', stopResize);
	}, [handleResizeMove]);

	const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const drawer = event.currentTarget.closest('.track-fx-drawer');
		const startHeight = drawer instanceof HTMLElement ? drawer.getBoundingClientRect().height : 440;
		resizeRef.current = { startY: event.clientY, startHeight };
		window.addEventListener('pointermove', handleResizeMove);
		window.addEventListener('pointerup', stopResize);
		window.addEventListener('pointercancel', stopResize);
	}, [handleResizeMove, stopResize]);

	const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const drawer = event.currentTarget.closest('.track-fx-drawer');
		const currentHeight = drawer instanceof HTMLElement ? drawer.getBoundingClientRect().height : 440;
		if (event.key === 'Home') {
			clampDrawerHeight(220);
			return;
		}
		if (event.key === 'End') {
			clampDrawerHeight(window.innerHeight * 0.9);
			return;
		}
		clampDrawerHeight(currentHeight + (event.key === 'ArrowUp' ? 24 : -24));
	}, [clampDrawerHeight]);

	useEffect(() => stopResize, [stopResize]);

	const addEffect = () => {
		if (!addSelection) return;
		onAddEffect(track.id, addSelection);
		setAddSelection('');
		setEffectPickerOpen(false);
		setEffectQuery('');
	};

	return (
		<aside
			className="track-fx-drawer track-fx-drawer-open"
			id={drawerId}
			style={{ '--track-color': trackColor, ...(drawerHeight ? { '--track-fx-drawer-height': `${drawerHeight}px` } : {}) } as CSSProperties}
			role="dialog"
			aria-modal="false"
			aria-labelledby="track-fx-drawer-title"
		>
			<div
				className="track-fx-drawer-handle"
				role="separator"
				aria-orientation="horizontal"
				aria-label="Resize track controls drawer"
				tabIndex={0}
				onPointerDown={startResize}
				onKeyDown={handleResizeKeyDown}
			/>
			<header className="track-fx-drawer-header">
				<div className="track-fx-drawer-heading">
					<h2 id="track-fx-drawer-title">{track.name}</h2>
				</div>
				<button className="track-fx-drawer-close" type="button" onClick={onClose} aria-label="Close track effects drawer" title="Close effects drawer">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
				</button>
			</header>

			<div className="track-fx-drawer-body">
				{visibleMode === 'effects' ? (
					<>
						{sliders.length ? <section className="track-fx-drawer-section track-fx-drawer-source-section" aria-labelledby="track-fx-source-heading">
							<div className="track-fx-drawer-section-heading">
								<h3 id="track-fx-source-heading">Source controls</h3>
								<span>{sliders.length ? `${sliders.length} CONTROL${sliders.length === 1 ? '' : 'S'}` : 'NONE'}</span>
							</div>
							{sliders.length ? (
								<div className="track-fx-drawer-slider-list">
									{sliders.map((slider) => (
										<label className="track-fx-drawer-slider-row" key={slider.id}>
											<span>{slider.label}</span>
											<input
												className="track-fx-range"
												type="range"
												min={slider.min}
												max={slider.max}
												step={slider.step ?? (slider.max - slider.min) / 1000}
												value={slider.value}
												disabled={isBusy || !trackDetails}
												onChange={(event) => onSetSlider(track.id, slider.id, Number(event.target.value))}
												aria-label={`${track.name} ${slider.label.toLowerCase()}`}
												title={`${slider.label}: ${slider.min}–${slider.max}`}
											/>
											<output>{formatValue(slider.value)}</output>
										</label>
									))}
								</div>
							) : <p className="track-fx-drawer-empty-copy">No numeric source controls on this track.</p>}
						</section> : null}

						<section className={`track-fx-drawer-section track-fx-drawer-chain-section${sliders.length ? '' : ' track-fx-drawer-chain-section-full'}`} aria-labelledby="track-fx-chain-heading">
							<div className="track-fx-drawer-section-heading">
								<div className="track-fx-drawer-section-heading-main">
									<h3 id="track-fx-chain-heading">Effects</h3>
									{sounds.length > 1 ? <button className="track-fx-layered-control" type="button" onClick={() => setMode('sounds')} aria-label={`View ${sounds.length} layered sound sources`}>
										<span>{sounds.length} voices</span>
										<span>View sources</span>
									</button> : null}
								</div>
								<span>{effectSummary(effects)}</span>
							</div>
							<div className="track-fx-drawer-effect-list" aria-label={`${track.name} effects`}>
								{effects.map((effect, index) => {
									const enabled = effectIsEnabled(effect);
									const hasSourceParameter = effect.parameters.some((parameter) => parameter.kind === 'dynamic');
									return (
										<div className={`track-fx-drawer-effect ${enabled ? '' : 'track-fx-drawer-effect-bypassed'}`} key={effect.id}>
											<div className="track-fx-drawer-effect-heading">
												<button
													className="track-fx-bypass"
													type="button"
													role="switch"
													aria-checked={enabled}
													disabled={isBusy || !trackDetails}
													onClick={() => onToggleEffect(track.id, effect.id, !enabled)}
													aria-label={`${enabled ? 'Bypass' : 'Enable'} ${effect.label.toLowerCase()} on ${track.name}`}
													title={enabled ? `Bypass ${effect.label.toLowerCase()}` : `Enable ${effect.label.toLowerCase()}`}
												>
													<span aria-hidden="true" />
												</button>
													<div className="track-fx-drawer-effect-title">
														<strong>{effect.label}</strong>
														{effect.definition.source === 'fallback' ? <span className="track-fx-unknown-badge">UNMAPPED</span> : null}
														{effect.definition.source === 'fallback' && !hasSourceParameter ? <code title={effect.expression}>{effect.expression || `.${effect.method}()`}</code> : null}
												</div>
												<span className="track-fx-effect-info" title={effect.definition.description} aria-label={effect.definition.description}>i</span>
												<div className="track-fx-drawer-effect-actions" role="group" aria-label={`${effect.label} order and removal`}>
													<button type="button" onClick={() => onReorderEffect(track.id, effect.id, 'up')} disabled={isBusy || !trackDetails || index === 0} aria-label={`Move ${effect.label.toLowerCase()} up`} title="Move effect left">←</button>
													<button type="button" onClick={() => onReorderEffect(track.id, effect.id, 'down')} disabled={isBusy || !trackDetails || index === effects.length - 1} aria-label={`Move ${effect.label.toLowerCase()} down`} title="Move effect right">→</button>
													<button className="track-fx-remove" type="button" onClick={() => onRemoveEffect(track.id, effect.id)} disabled={isBusy || !trackDetails} aria-label={`Remove ${effect.label.toLowerCase()} from ${track.name}`} title={`Remove ${effect.label.toLowerCase()}`}>×</button>
												</div>
											</div>
											<div className="track-fx-drawer-effect-parameters">
												{effect.parameters.map((parameter) => {
													const parameterMode = effectMode(parameter);
													const parameterValue = parameter.value ?? (typeof parameter.defaultValue === 'number' ? parameter.defaultValue : 0);
													const numericParameter = parameter.type === 'number' && parameter.min !== undefined && parameter.max !== undefined;
													const sourceParameter = parameter.kind === 'dynamic';
													return (
														<div className={`track-fx-drawer-effect-control${sourceParameter ? ' track-fx-drawer-effect-control-source' : ''}${numericParameter ? ' track-fx-drawer-effect-control-numeric' : ''}`} key={`${effect.id}-parameter-${parameter.index}`}>
															<div className="track-fx-parameter-head">
																<span className="track-fx-parameter-label">{parameter.label}</span>
																{numericParameter ? (
																	<select
																		className="track-fx-mode"
																		value={parameterMode}
																		disabled={isBusy || !trackDetails || !enabled}
																		onChange={(event) => {
																			if (event.target.value === 'random') onSetEffect(track.id, effect.id, 'rand', parameter.index);
																			if (event.target.value === 'manual') onSetEffect(track.id, effect.id, parameterValue, parameter.index);
																		}}
																		aria-label={`${track.name} ${effect.label.toLowerCase()} ${parameter.label.toLowerCase()} mode`}
																	>
																		{parameterMode === 'source' ? <option value="source">SOURCE</option> : null}
																		<option value="manual">MANUAL</option>
																		{parameter.supportsRandom ? <option value="random">RANDOM</option> : null}
																	</select>
																) : null}
																{numericParameter && !sourceParameter ? <output>{formatParameterValue(parameter)}</output> : null}
															</div>
															{sourceParameter ? (
																<div className="track-fx-source-field">
																	<span className="track-fx-source-field-mark" aria-hidden="true">ƒx</span>
																	<input
																		className="track-fx-expression track-fx-source-expression"
																		type="text"
																		value={parameter.expression}
																		disabled={isBusy || !trackDetails || !enabled}
																		onChange={(event) => onSetEffect(track.id, effect.id, event.target.value, parameter.index)}
																		aria-label={`${track.name} ${effect.label.toLowerCase()} ${parameter.label.toLowerCase()} source expression`}
																		title="Strudel source expression"
																	/>
																</div>
															) : parameter.type === 'option' && parameter.options?.length ? (
																<select
																	className="track-fx-option"
																	value={parameter.expression.replace(/^['"`]|['"`]$/g, '')}
																	disabled={isBusy || !trackDetails || !enabled}
																	onChange={(event) => onSetEffect(track.id, effect.id, event.target.value, parameter.index)}
																	aria-label={`${track.name} ${effect.label.toLowerCase()} ${parameter.label.toLowerCase()}`}
																>
																	{parameter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
																</select>
															) : numericParameter ? (
																parameterMode === 'random' ? <span className="track-fx-random-value">RAND</span> : <input
																	className="track-fx-range"
																	type="range"
																	min={parameter.min}
																	max={parameter.max}
																	step={parameter.step ?? 0.01}
																	value={parameterValue}
																	disabled={isBusy || !trackDetails || !enabled}
																	onChange={(event) => onSetEffect(track.id, effect.id, Number(event.target.value), parameter.index)}
																	aria-label={`${track.name} ${effect.label.toLowerCase()} ${parameter.label.toLowerCase()}`}
																	title={`${parameter.label}: ${parameter.min}–${parameter.max}`}
																/>
															) : (
																<input
																	className="track-fx-expression"
																	type="text"
																	value={parameter.expression}
																	disabled={isBusy || !trackDetails || !enabled}
																	onChange={(event) => onSetEffect(track.id, effect.id, event.target.value, parameter.index)}
																	aria-label={`${track.name} ${effect.label.toLowerCase()} ${parameter.label.toLowerCase()}`}
																/>
															)}
														</div>
												);
											})}
										</div>
									</div>
									);
								})}
								<div className="track-fx-drawer-add track-fx-drawer-add-tile">
									<span className="track-fx-drawer-add-icon" aria-hidden="true">＋</span>
									<strong className="track-fx-drawer-add-label">Add effect</strong>
									<small>Browse the Strudel effect library</small>
									<div className="track-fx-drawer-add-controls">
										<div className="track-fx-effect-picker" ref={effectPickerRef}>
											<button
												id="track-fx-add-select"
												className={`track-fx-effect-picker-trigger${effectPickerOpen ? ' track-fx-effect-picker-trigger-open' : ''}`}
												type="button"
												aria-haspopup="dialog"
												aria-expanded={effectPickerOpen}
												disabled={isBusy || !trackDetails || addableDefinitions.every((definition) => presentMethods.has(definition.method))}
												onClick={toggleEffectPicker}
												aria-label={selectedAddDefinition ? `${selectedAddDefinition.label} selected for ${track.name}` : `Choose an effect to add to ${track.name}`}
											>
												<span>{selectedAddDefinition?.label ?? 'Choose effect…'}</span>
												<span aria-hidden="true">⌄</span>
											</button>
											{effectPickerOpen && effectPickerPosition && typeof document !== 'undefined' ? createPortal(
												<div
													ref={effectPickerPopoverRef}
													className="track-fx-effect-picker-popover"
													role="dialog"
													aria-label={`Choose an effect to add to ${track.name}`}
													style={{
														'--track-color': trackColor,
														left: effectPickerPosition.left,
														width: effectPickerPosition.width,
														maxHeight: effectPickerPosition.maxHeight,
														...(effectPickerPosition.top !== undefined ? { top: effectPickerPosition.top } : { bottom: effectPickerPosition.bottom ?? 12 }),
													} as CSSProperties & { '--track-color': string }}
												>
													<div className="track-fx-effect-picker-header">
														<strong>Effects</strong>
														<button type="button" aria-label="Close effect picker" onClick={() => setEffectPickerOpen(false)}>×</button>
													</div>
													<input
														className="track-fx-effect-picker-search"
														type="search"
														value={effectQuery}
														placeholder="Search effects…"
														onChange={(event) => setEffectQuery(event.target.value)}
														aria-label={`Search effects for ${track.name}`}
														autoFocus
													/>
													<div className="track-fx-effect-picker-browse">
														<div className="track-fx-effect-picker-groups-pane">
															<span className="track-fx-effect-picker-groups-heading">Browse by category</span>
															<div className="track-fx-effect-picker-groups" role="tablist" aria-label="Filter effects by category">
																<button type="button" role="tab" aria-selected={!effectGroupFilter} className={!effectGroupFilter ? 'track-fx-effect-picker-group-active' : ''} onClick={() => setEffectGroupFilter('')}>All effects</button>
																{effectGroups.map((group) => (
																	<button key={group} type="button" role="tab" aria-selected={effectGroupFilter === group} className={effectGroupFilter === group ? 'track-fx-effect-picker-group-active' : ''} onClick={() => setEffectGroupFilter(group)}>{groupLabel(group)}</button>
																))}
															</div>
														</div>
														<div className="track-fx-effect-picker-results" role="listbox" aria-label={`Available effects for ${track.name}`}>
															{filteredAddableDefinitions.length ? filteredAddableDefinitions.map((definition) => {
																const alreadyAdded = presentMethods.has(definition.method);
																return (
																	<button
																		className={`track-fx-effect-picker-option${addSelection === definition.method ? ' track-fx-effect-picker-option-selected' : ''}`}
																		type="button"
																		role="option"
																		aria-selected={addSelection === definition.method}
																		disabled={isBusy || !trackDetails || alreadyAdded}
																		onClick={() => {
																			setAddSelection(definition.method);
																			setEffectPickerOpen(false);
																			setEffectQuery('');
																		}}
																		aria-label={`${definition.label}${alreadyAdded ? ' already added' : ''}`}
																	>
																			<span>
																				<strong>{definition.label}</strong>
																				<code>.{definition.method}()</code>
																			</span>
																			<small>{definition.description}</small>
																			{alreadyAdded ? <em>ADDED</em> : null}
																		</button>
																	);
																}) : <p className="track-fx-effect-picker-empty">No effects match “{effectQuery}”.</p>}
														</div>
													</div>
												</div>,
												document.body,
											) : null}
										</div>
										<button type="button" onClick={addEffect} disabled={isBusy || !trackDetails || !addSelection} aria-label={`Add selected effect to ${track.name}`}>ADD</button>
									</div>
								</div>
							</div>
						</section>
					</>
				) : visibleMode === 'sounds' ? (
					<section className="track-fx-drawer-section track-fx-drawer-sounds-section" aria-labelledby="track-fx-sounds-heading">
						<div className="track-fx-drawer-section-heading">
							<div className="track-fx-drawer-section-heading-main">
								<h3 id="track-fx-sounds-heading">Sounds</h3>
								{sounds.length > 1 ? <span className="track-sound-voice-count">{sounds.length} voices</span> : null}
							</div>
							<span>{sounds.length === 1 ? 'CURRENT .SOUND()' : sounds.length ? 'LAYERED SOURCES' : 'NO SOUND'}</span>
						</div>
						{sounds.length <= 1 ? <div className="track-sound-current">
							<div>
								<span className="track-sound-current-kicker">CURRENT .SOUND()</span>
								<strong>{sound?.definition?.label ?? sound?.token ?? (sound ? 'Custom source expression' : 'No sound call')}</strong>
								<code>{sound?.expression ?? 'Select a sound to append .sound(...) to this track.'}</code>
							</div>
							{sound?.definition ? (
								<span className="track-sound-definition-meta">{soundTypeLabel(sound.definition.type)} · {sound.definition.category.replace(/[-_]+/g, ' ')}</span>
							) : sound ? <span className="track-fx-unknown-badge">UNMAPPED</span> : null}
						</div> : null}
						<div className={`track-sound-picker${sounds.length > 1 ? ' track-sound-picker-layered' : ''}`} ref={soundPickerRef}>
							{sounds.length > 1 ? (
								<div className="track-sound-voice-list" aria-label={`${track.name} sound sources`}>
									<div className="track-sound-voice-add">
										<span className="track-sound-voice-add-icon" aria-hidden="true">＋</span>
										<strong>Choose voice</strong>
										<small>Browse or replace a Strudel sound</small>
										<button
											className={`track-sound-picker-trigger${soundPickerOpen ? ' track-sound-picker-trigger-open' : ''}`}
											type="button"
											aria-haspopup="dialog"
											aria-expanded={soundPickerOpen}
											onClick={(event) => toggleSoundPicker(soundPickerTargetId, event.currentTarget)}
											disabled={isBusy || !trackDetails}
											aria-label={`Browse Strudel sounds for ${track.name}`}
										>
												<span>Add or replace a voice</span>
												<span aria-hidden="true">⌄</span>
											</button>
									</div>
									{sounds.map((voice, index) => (
										<article className={`track-sound-voice${soundPickerTargetId === voice.id ? ' track-sound-voice-selected' : ''}`} key={voice.id}>
											<div className="track-sound-voice-copy">
												<div className="track-sound-voice-topline">
													<span className="track-sound-voice-index">{String(index + 1).padStart(2, '0')}</span>
													<span className="track-sound-voice-label">{voice.label}</span>
												</div>
												<strong>{voice.definition?.label ?? voice.token ?? 'Custom source expression'}</strong>
												<code title={voice.expression}>{voice.expression}</code>
												<small>{voice.definition ? `${soundTypeLabel(voice.definition.type)} · ${soundCategoryLabel(voice.definition.category)}` : 'Custom source expression'}</small>
											</div>
											<button
												className="track-sound-voice-change"
												type="button"
												disabled={isBusy || !trackDetails}
												onClick={(event) => openSoundPicker(voice.id, event.currentTarget)}
												aria-label={`Change ${voice.label.toLowerCase()} for ${track.name}`}
											>
												Change sound
											</button>
										</article>
									))}
								</div>
							) : <button
								className={`track-sound-picker-trigger${soundPickerOpen ? ' track-sound-picker-trigger-open' : ''}`}
								type="button"
								aria-haspopup="dialog"
								aria-expanded={soundPickerOpen}
								onClick={(event) => toggleSoundPicker(sound?.id ?? soundPickerTargetId, event.currentTarget)}
								disabled={isBusy || !trackDetails}
								aria-label={`Browse Strudel sounds for ${track.name}`}
							>
								<span>{sounds.length ? 'Change sound' : 'Choose a sound'}</span>
								<span aria-hidden="true">⌄</span>
							</button>}
						{soundPickerOpen && soundPickerPosition && typeof document !== 'undefined' ? createPortal(
							<div
								ref={soundPickerPopoverRef}
								className="track-sound-picker-popover"
								role="dialog"
								aria-label={`Browse Strudel sounds for ${track.name}`}
								style={{
									'--track-color': trackColor,
									left: soundPickerPosition.left,
									width: soundPickerPosition.width,
									maxHeight: soundPickerPosition.maxHeight,
									...(soundPickerPosition.top !== undefined ? { top: soundPickerPosition.top } : { bottom: soundPickerPosition.bottom ?? 12 }),
								} as CSSProperties & { '--track-color': string }}
							>
								<div className="track-fx-effect-picker-header">
									<strong>Sounds{targetSound ? ` · ${targetSound.label}` : ''}</strong>
									<button type="button" aria-label="Close sound picker" onClick={() => setSoundPickerOpen(false)}>×</button>
								</div>
								<input
									className="track-fx-effect-picker-search"
									type="search"
									value={soundQuery}
									placeholder="Search sounds by name or id…"
									onChange={(event) => setSoundQuery(event.target.value)}
									aria-label={`Search sounds for ${track.name}`}
									autoFocus
								/>
								<div className="track-fx-effect-picker-browse track-sound-picker-browse">
									<div className="track-fx-effect-picker-groups-pane">
										<span className="track-fx-effect-picker-groups-heading">Browse by type</span>
										<div className="track-fx-effect-picker-groups track-sound-picker-types" role="tablist" aria-label="Filter sounds by type">
											<button type="button" role="tab" aria-selected={!soundTypeFilter} className={!soundTypeFilter ? 'track-fx-effect-picker-group-active' : ''} onClick={() => {
												setSoundTypeFilter('');
												setSoundCategoryFilter('');
												setSoundQuery('');
											}}>
												<span>All sounds</span>
												<small>{soundCatalog.length}</small>
											</button>
											{soundTypeOptions.map((type) => {
												const count = listStrudelSounds({ type }).length;
												const selected = soundTypeFilter === type;
												return (
													<button key={type} type="button" role="tab" aria-selected={selected} className={selected ? 'track-fx-effect-picker-group-active' : ''} onClick={() => {
														setSoundTypeFilter(type);
														setSoundCategoryFilter('');
														setSoundQuery('');
													}}>
														<span>{humanizeLabel(type)}</span>
														<small>{count}</small>
													</button>
												);
											})}
										</div>
									</div>
									<div className="track-sound-picker-content">
										<nav className="track-sound-breadcrumbs" aria-label="Sound library path">
											<button type="button" onClick={() => {
												setSoundTypeFilter('');
												setSoundCategoryFilter('');
												setSoundQuery('');
											}}>Sounds</button>
											{soundTypeFilter ? (
												<>
													<span aria-hidden="true">›</span>
													<button type="button" onClick={() => {
														setSoundCategoryFilter('');
														setSoundQuery('');
													}}>{humanizeLabel(soundTypeFilter)}</button>
												</>
											) : null}
											{soundCategoryFilter ? (
												<>
													<span aria-hidden="true">›</span>
													<span aria-current="page">{humanizeLabel(soundCategoryFilter)}</span>
												</>
											) : null}
										</nav>
										{!soundQuery.trim() && !soundTypeFilter ? (
											<div className="track-sound-browser-empty" aria-label="Sound types">
												<strong>Choose a sound type</strong>
												<p>Browse Strudel’s library by type, or search every sound above.</p>
											</div>
										) : !soundQuery.trim() && soundTypeFilter && !soundCategoryFilter ? (
											<div className="track-sound-browser-branch" aria-label={`${soundTypeLabel(soundTypeFilter)} sound categories`}>
												<div className="track-sound-browser-content-heading">
													<strong>{humanizeLabel(soundTypeFilter)} categories</strong>
													<span>{listStrudelSounds({ type: soundTypeFilter }).length} sounds</span>
												</div>
												<div className="track-sound-branch-grid">
													{soundCategoryOptions.map((category) => {
														const count = listStrudelSounds({ type: soundTypeFilter, category }).length;
														return (
															<button className="track-sound-branch" type="button" key={category} onClick={() => {
																setSoundCategoryFilter(category);
																setSoundQuery('');
															}} disabled={isBusy || !trackDetails}>
																<strong>{humanizeLabel(category)}</strong>
																<span>{count} sound{count === 1 ? '' : 's'}</span>
															</button>
														);
													})}
												</div>
											</div>
										) : (
											<>
												<div className="track-sound-results-heading">
													<span>{soundQuery.trim() ? 'Search results' : 'Sounds in this category'}</span>
													<strong>{soundResultTotal > soundResults.length ? `${soundResults.length} OF ${soundResultTotal}` : soundResultTotal}</strong>
												</div>
												<div className="track-sound-results" role="listbox" aria-label={`Strudel sounds for ${track.name}`}>
													{soundResults.length ? soundResults.map((definition) => {
														const selected = targetSound?.definition?.id === definition.id;
														return (
															<button
																className={`track-sound-option${selected ? ' track-sound-option-selected' : ''}`}
																key={definition.id}
																type="button"
																role="option"
																aria-selected={selected}
																disabled={isBusy || !trackDetails}
																		onClick={() => {
																			onSetSound(track.id, definition.id, soundPickerTargetId);
																	setSoundPickerOpen(false);
																	setSoundQuery('');
																}}
															>
																<strong>{definition.label}</strong>
																<span>{definition.id}</span>
																<small>{soundCategoryLabel(definition.category)}</small>
															</button>
														);
													}) : <p className="track-fx-drawer-empty-copy">No Strudel sounds match “{soundQuery}”.</p>}
												</div>
											</>
										)}
									</div>
								</div>
							</div>,
							document.body,
						) : null}
					</div>
						<p className="track-sound-note">Choosing a sound writes a literal <code>.sound(...)</code> value; custom expressions stay intact until replaced.</p>
					</section>
				) : (
					<MidiTrackControls
						track={track}
						trackDetails={trackDetails}
						midiState={midiState}
						isBusy={isBusy}
						onSetMidiRoute={onSetMidiRoute}
						onSetMidiInstrument={onSetMidiInstrument}
						onOpenMidiPanel={onOpenMidiPanel}
						onTestMidi={onTestMidi}
					/>
				)}
			</div>

			<footer className="track-fx-drawer-footer">
				<div className="track-fx-drawer-mode-switch" role="tablist" aria-label="Track control mode">
					<button type="button" role="tab" aria-selected={visibleMode === 'effects'} className={visibleMode === 'effects' ? 'track-fx-drawer-mode-active' : ''} onClick={() => setMode('effects')}>Effects</button>
					<button type="button" role="tab" aria-selected={visibleMode === 'sounds'} className={visibleMode === 'sounds' ? 'track-fx-drawer-mode-active' : ''} onClick={() => setMode('sounds')}>Sounds</button>
					{experimentalMidi ? <button type="button" role="tab" aria-selected={visibleMode === 'midi'} className={visibleMode === 'midi' ? 'track-fx-drawer-mode-active' : ''} onClick={() => setMode('midi')}>MIDI</button> : null}
				</div>
				<span className="track-fx-drawer-footer-status">{visibleMode === 'effects' ? 'SOURCE · EFFECTS' : visibleMode === 'sounds' ? 'SOURCE · SOUNDS' : 'SOURCE · MIDI'}</span>
			</footer>
		</aside>
	);
}
