import { useState } from 'react';
import {
	SOURCE_EFFECT_DEFINITIONS,
	type SourceSlider,
	type SourceEffect,
	type SourceEffectMethod,
} from '../../lib/project/source-mapper';

export interface TrackFxControlsProps {
	trackId: string;
	trackName: string;
	sliders: SourceSlider[];
	effects: SourceEffect[];
	expanded: boolean;
	disabled?: boolean;
	onSetSlider: (trackId: string, sliderId: string, value: number) => void;
	onSetEffect: (trackId: string, effectId: string, value: number | 'rand') => void;
	onAddEffect: (trackId: string, method: SourceEffectMethod) => void;
	onRemoveEffect: (trackId: string, effectId: string) => void;
	onToggleExpanded: () => void;
}

function formatSliderDisplayValue(value: number): string {
	if (Math.abs(value) >= 100) return Math.round(value).toString();
	return Number(value.toFixed(3)).toString();
}

function formatEffectValue(effect: SourceEffect): string {
	if (effect.kind === 'random') return 'RAND';
	if (effect.kind === 'dynamic') return effect.expression;
	if (Math.abs(effect.value ?? 0) >= 100) return Math.round(effect.value ?? 0).toString();
	return Number((effect.value ?? effect.defaultValue).toFixed(3)).toString();
}

function effectMode(effect: SourceEffect): 'manual' | 'random' | 'source' {
	if (effect.kind === 'random') return 'random';
	if (effect.kind === 'dynamic') return 'source';
	return 'manual';
}

export function TrackFxControls({
	trackId,
	trackName,
	sliders,
	effects,
	expanded,
	disabled = false,
	onSetSlider,
	onSetEffect,
	onAddEffect,
	onRemoveEffect,
	onToggleExpanded,
}: TrackFxControlsProps) {
	const [addSelection, setAddSelection] = useState('');
	const presentMethods = new Set(effects.map((effect) => effect.method));
	const controlCount = sliders.length + effects.length;
	const panelId = `track-fx-panel-${trackId}`;

	return (
		<div className={`track-fx-controls ${expanded ? 'track-fx-controls-expanded' : ''}`} role="group" aria-label={`${trackName} effects`}>
			<button
				className="track-fx-toggle"
				type="button"
				onClick={onToggleExpanded}
				aria-expanded={expanded}
				aria-controls={panelId}
				title={expanded ? `Collapse ${trackName} effects` : `Expand ${trackName} effects`}
			>
				<span className="track-fx-toggle-label">FX</span>
				<span className="track-fx-toggle-summary">{controlCount ? `${controlCount} CONTROL${controlCount === 1 ? '' : 'S'}` : 'NO CONTROLS'}</span>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
			</button>
			<div className="track-fx-panel" id={panelId} hidden={!expanded}>
				{sliders.map((slider) => (
					<div className="track-fx-row track-fx-slider-row" key={slider.id}>
						<span className="track-fx-label" title={slider.label}>{slider.label}</span>
						<span className="track-fx-mode-placeholder" aria-hidden="true" />
						<input
							className="track-fx-range"
							type="range"
							min={slider.min}
							max={slider.max}
							step={slider.step ?? (slider.max - slider.min) / 1000}
							value={slider.value}
							disabled={disabled}
							onChange={(event) => onSetSlider(trackId, slider.id, Number(event.target.value))}
							aria-label={`${trackName} ${slider.label.toLowerCase()}`}
							title={`${slider.label}: ${slider.min}–${slider.max}`}
						/>
						<output className="track-fx-value">{formatSliderDisplayValue(slider.value)}</output>
						<span className="track-fx-remove-placeholder" aria-hidden="true" />
					</div>
				))}
				{effects.map((effect) => {
					const mode = effectMode(effect);
					const sliderValue = effect.value ?? effect.defaultValue;
					return (
						<div className="track-fx-row" key={effect.id}>
							<span className="track-fx-label" title={effect.method}>{effect.label}</span>
							<select
								className="track-fx-mode"
								value={mode}
								disabled={disabled}
								onChange={(event) => {
									if (event.target.value === 'random') onSetEffect(trackId, effect.id, 'rand');
									if (event.target.value === 'manual') onSetEffect(trackId, effect.id, sliderValue);
								}}
								aria-label={`${trackName} ${effect.label.toLowerCase()} mode`}
							>
								{effect.kind === 'dynamic' ? <option value="source">SOURCE</option> : null}
								<option value="manual">MANUAL</option>
								{effect.supportsRandom ? <option value="random">RANDOM</option> : null}
							</select>
							<input
								className="track-fx-range"
								type="range"
								min={effect.min}
								max={effect.max}
								step={effect.step}
								value={sliderValue}
								disabled={disabled || mode !== 'manual'}
								onChange={(event) => onSetEffect(trackId, effect.id, Number(event.target.value))}
								aria-label={`${trackName} ${effect.label.toLowerCase()}`}
								title={`${effect.label}: ${effect.min}–${effect.max}`}
							/>
							<output className="track-fx-value">{formatEffectValue(effect)}</output>
							<button
								className="track-fx-remove"
								type="button"
								disabled={disabled}
								onClick={() => onRemoveEffect(trackId, effect.id)}
								aria-label={`Remove ${effect.label.toLowerCase()} from ${trackName}`}
								title={`Remove ${effect.label.toLowerCase()}`}
							>×</button>
						</div>
					);
				})}
				<label className="track-fx-add">
					<span>ADD FX</span>
					<select
						value={addSelection}
						disabled={disabled || presentMethods.size >= SOURCE_EFFECT_DEFINITIONS.length}
						onChange={(event) => {
							const method = event.target.value as SourceEffectMethod;
							if (!method) return;
							onAddEffect(trackId, method);
							setAddSelection('');
						}}
						aria-label={`Add effect to ${trackName}`}
					>
						<option value="">＋ Choose effect</option>
						{SOURCE_EFFECT_DEFINITIONS.map((definition) => (
							<option key={definition.method} value={definition.method} disabled={presentMethods.has(definition.method)}>
								{presentMethods.has(definition.method) ? `${definition.label} (ADDED)` : definition.label}
							</option>
						))}
					</select>
				</label>
			</div>
		</div>
	);
}
