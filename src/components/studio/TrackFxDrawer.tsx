import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { SourceBlockSummary } from '../../lib/project/model';
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
} from '../../lib/project/source-mapper';
import type { TrackDetails } from './types';

export type TrackFxDrawerMode = 'effects' | 'sounds' | 'midi';

export interface TrackFxDrawerProps {
	track: SourceBlockSummary;
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

interface EffectPickerPosition {
	left: number;
	width: number;
	maxHeight: number;
	top?: number;
	bottom?: number;
}

export function TrackFxDrawer({
	track,
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
	}, [track.id]);

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
				{mode === 'effects' ? (
					<>
						{sounds.length > 1 ? <div className="track-fx-layered-notice">
							<span><strong>{sounds.length} layered voices</strong><small>Sound calls inside this track’s callbacks</small></span>
							<button type="button" onClick={() => setMode('sounds')}>View sources</button>
						</div> : null}
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
								<h3 id="track-fx-chain-heading">Effect chain</h3>
								<span>{effectSummary(effects)}</span>
							</div>
							<div className="track-fx-drawer-add">
								<span className="track-fx-drawer-add-label">Add effect</span>
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
												} as CSSProperties}
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
							{effects.length ? (
								<div className="track-fx-drawer-effect-list">
									{effects.map((effect, index) => {
										const enabled = effectIsEnabled(effect);
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
													<strong>{effect.label}</strong>
													{effect.definition.source === 'fallback' ? <span className="track-fx-unknown-badge">UNMAPPED</span> : null}
													<code title={effect.expression}>{effect.expression}</code>
													<div className="track-fx-drawer-effect-actions" role="group" aria-label={`${effect.label} order and removal`}>
														<button type="button" onClick={() => onReorderEffect(track.id, effect.id, 'up')} disabled={isBusy || !trackDetails || index === 0} aria-label={`Move ${effect.label.toLowerCase()} up`} title="Move effect up">↑</button>
														<button type="button" onClick={() => onReorderEffect(track.id, effect.id, 'down')} disabled={isBusy || !trackDetails || index === effects.length - 1} aria-label={`Move ${effect.label.toLowerCase()} down`} title="Move effect down">↓</button>
														<button className="track-fx-remove" type="button" onClick={() => onRemoveEffect(track.id, effect.id)} disabled={isBusy || !trackDetails} aria-label={`Remove ${effect.label.toLowerCase()} from ${track.name}`} title={`Remove ${effect.label.toLowerCase()}`}>×</button>
													</div>
												</div>
												<div className="track-fx-drawer-effect-parameters">
													{effect.parameters.map((parameter) => {
															const parameterMode = effectMode(parameter);
															const parameterValue = parameter.value ?? (typeof parameter.defaultValue === 'number' ? parameter.defaultValue : 0);
															return (
															<div className="track-fx-drawer-effect-control" key={`${effect.id}-parameter-${parameter.index}`}>
																<span className="track-fx-parameter-label">{parameter.label}</span>
																{parameter.type === 'option' && parameter.options?.length ? (
																	<select
																		className="track-fx-mode"
																		value={parameter.expression.replace(/^['"`]|['"`]$/g, '')}
																		disabled={isBusy || !trackDetails || !enabled}
																		onChange={(event) => onSetEffect(track.id, effect.id, event.target.value, parameter.index)}
																		aria-label={`${track.name} ${effect.label.toLowerCase()} ${parameter.label.toLowerCase()}`}
																	>
																		{parameter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
																	</select>
																) : parameter.type === 'number' && parameter.min !== undefined && parameter.max !== undefined ? (
																	<>
																	<select
																		className="track-fx-mode"
																		value={parameterMode}
																		disabled={isBusy || !trackDetails}
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
																		<input
																			className="track-fx-range"
																			type="range"
																			min={parameter.min}
																			max={parameter.max}
																			step={parameter.step ?? 0.01}
																			value={parameterValue}
																			disabled={isBusy || !trackDetails || !enabled || parameterMode !== 'manual'}
																			onChange={(event) => onSetEffect(track.id, effect.id, Number(event.target.value), parameter.index)}
																			aria-label={`${track.name} ${effect.label.toLowerCase()} ${parameter.label.toLowerCase()}`}
																			title={`${parameter.label}: ${parameter.min}–${parameter.max}`}
																		/>
																		<output>{formatParameterValue(parameter)}</output>
																	</>
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
								</div>
							) : <p className="track-fx-drawer-empty-copy">No effects yet. Use Add effect above to build this track’s chain.</p>}
						</section>
					</>
				) : mode === 'sounds' ? (
					<section className="track-fx-drawer-section track-fx-drawer-sounds-section" aria-labelledby="track-fx-sounds-heading">
						<div className="track-fx-drawer-section-heading">
							<h3 id="track-fx-sounds-heading">Track sound</h3>
							<span>{sounds.length ? `${sounds.length} voice${sounds.length === 1 ? '' : 's'}` : 'no sound'}</span>
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
					<div className="track-sound-picker" ref={soundPickerRef}>
						{sounds.length > 1 ? (
							<div className="track-sound-voice-list" aria-label={`${track.name} sound sources`}>
								<div className="track-sound-voice-list-heading">
									<span>Sound sources</span>
									<strong>{sounds.length} voices</strong>
								</div>
								{sounds.map((voice) => (
									<div className={`track-sound-voice${soundPickerTargetId === voice.id ? ' track-sound-voice-selected' : ''}`} key={voice.id}>
										<div className="track-sound-voice-copy">
											<span className="track-sound-voice-label">{voice.label}</span>
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
											Change
										</button>
									</div>
								))}
							</div>
						) : null}
						<button
							className={`track-sound-picker-trigger${soundPickerOpen ? ' track-sound-picker-trigger-open' : ''}`}
							type="button"
							aria-haspopup="dialog"
							aria-expanded={soundPickerOpen}
							onClick={(event) => toggleSoundPicker(sound?.id ?? soundPickerTargetId, event.currentTarget)}
							disabled={isBusy || !trackDetails}
							aria-label={`Browse Strudel sounds for ${track.name}`}
						>
							<span>{sounds.length > 1 ? 'Add or replace a voice' : 'Browse sounds'}</span>
							<span aria-hidden="true">⌄</span>
						</button>
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
								} as CSSProperties}
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
						<p className="track-sound-note">Choosing a sound writes a literal source value. Custom and dynamic expressions remain intact until you choose a replacement.</p>
					</section>
				) : (
					<section className="track-fx-drawer-section track-fx-drawer-midi-placeholder" aria-labelledby="track-fx-midi-heading">
						<span className="track-fx-drawer-placeholder-icon" aria-hidden="true">♫</span>
						<h3 id="track-fx-midi-heading">MIDI controls</h3>
						<p>MIDI routing and performance controls will live here in a future update.</p>
					</section>
				)}
			</div>

			<footer className="track-fx-drawer-footer">
				<div className="track-fx-drawer-mode-switch" role="tablist" aria-label="Track control mode">
					<button type="button" role="tab" aria-selected={mode === 'effects'} className={mode === 'effects' ? 'track-fx-drawer-mode-active' : ''} onClick={() => setMode('effects')}>Effects</button>
					<button type="button" role="tab" aria-selected={mode === 'sounds'} className={mode === 'sounds' ? 'track-fx-drawer-mode-active' : ''} onClick={() => setMode('sounds')}>Sounds</button>
					<button type="button" role="tab" aria-selected={mode === 'midi'} className={mode === 'midi' ? 'track-fx-drawer-mode-active' : ''} onClick={() => setMode('midi')}>MIDI</button>
				</div>
				<span className="track-fx-drawer-footer-status">{mode === 'effects' ? 'SOURCE · EFFECTS' : mode === 'sounds' ? 'SOURCE · SOUNDS' : 'MIDI · RESERVED'}</span>
			</footer>
		</aside>
	);
}
