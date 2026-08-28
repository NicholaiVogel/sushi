import { useEffect, useId, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const COLOR_PRESETS = [
	'#dce5df',
	'#ffffff',
	'#b8c0c6',
	'#88c0d0',
	'#c7a6ff',
	'#f0a3c7',
	'#f3c969',
	'#ff7a68',
	'#01bcc3',
];

export interface ColorPickerProps {
	value: string;
	defaultValue: string;
	label: string;
	variant?: 'popover' | 'inline';
	disabled?: boolean;
	onChange: (value: string) => void;
}

function normalizeHex(value: string): string | undefined {
	const normalized = value.trim();
	if (/^#[0-9a-f]{3}$/i.test(normalized)) {
		return `#${normalized.slice(1).split('').map((digit) => `${digit}${digit}`).join('')}`.toLowerCase();
	}
	if (HEX_COLOR_PATTERN.test(normalized)) return normalized.toLowerCase();
	return undefined;
}

function pickerHex(value: string, fallback: string): string {
	return normalizeHex(value) ?? normalizeHex(fallback) ?? '#dce5df';
}

export function ColorPicker({ value, defaultValue, label, variant = 'popover', disabled = false, onChange }: ColorPickerProps) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(() => pickerHex(value, defaultValue));
	const rootRef = useRef<HTMLDivElement | null>(null);
	const inputId = useId();

	useEffect(() => {
		setDraft(pickerHex(value, defaultValue));
	}, [defaultValue, value]);

	useEffect(() => {
		if (variant !== 'popover' || !open) return undefined;
		const handlePointerDown = (event: PointerEvent) => {
			if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
		};
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		window.addEventListener('pointerdown', handlePointerDown);
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('pointerdown', handlePointerDown);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [open, variant]);

	const commitDraft = (candidate: string): boolean => {
		if (disabled) return false;
		const next = normalizeHex(candidate);
		if (!next) return false;
		setDraft(next);
		onChange(next);
		return true;
	};

	const handleHexChange = (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value);

	const handleHexBlur = () => {
		if (!commitDraft(draft)) setDraft(pickerHex(value, defaultValue));
	};

	const handleHexKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			if (commitDraft(draft) && variant === 'popover') setOpen(false);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			setDraft(pickerHex(value, defaultValue));
			if (variant === 'popover') setOpen(false);
		}
	};

	const handlePickerChange = (event: ChangeEvent<HTMLInputElement>) => {
		const next = pickerHex(event.target.value, defaultValue);
		setDraft(next);
		onChange(next);
	};

	const handleRootPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => event.stopPropagation();

	return (
		<div className={`track-color-picker${variant === 'inline' ? ' track-color-picker-inline' : ''}`} ref={rootRef} onClick={(event) => event.stopPropagation()} onPointerDown={handleRootPointerDown}>
			{variant === 'popover' ? <button
				className="track-color-picker-trigger"
				type="button"
				disabled={disabled}
				onClick={() => setOpen((current) => !current)}
				aria-label={`Set color for ${label}`}
				aria-expanded={open}
				aria-haspopup="dialog"
				title={disabled ? `${label} color is controlled by a dynamic source expression` : `Set color for ${label}`}
				style={{ '--picker-color': value } as CSSProperties}
			>
				<span className="track-color-picker-swatch" aria-hidden="true" />
			</button> : null}
			{(variant === 'inline' || (open && !disabled)) ? (
				<div className="track-color-picker-popover" role={variant === 'popover' ? 'dialog' : 'group'} aria-label={`${label} color settings`}>
					<div className="track-color-picker-heading">
						<strong>Track color</strong>
						<span>{label}</span>
					</div>
					<label className="track-color-picker-hex">
						<span>HEX</span>
						<input id={inputId} type="text" value={draft} maxLength={7} spellCheck={false} disabled={disabled} onChange={handleHexChange} onBlur={handleHexBlur} onKeyDown={handleHexKeyDown} aria-label={`Hex color for ${label}`} />
					</label>
					<label className="track-color-picker-native">
						<input type="color" value={pickerHex(value, defaultValue)} disabled={disabled} onChange={handlePickerChange} aria-label={`Open native color picker for ${label}`} />
						<span>Open color picker</span>
					</label>
					<div className="track-color-picker-presets" role="group" aria-label="Color presets">
						{COLOR_PRESETS.map((preset) => (
							<button
								className={`track-color-picker-preset${pickerHex(value, defaultValue) === preset ? ' track-color-picker-preset-active' : ''}`}
								type="button"
								key={preset}
								disabled={disabled}
								style={{ '--picker-color': preset } as CSSProperties}
								onClick={() => { commitDraft(preset); if (variant === 'popover') setOpen(false); }}
								aria-label={`Use ${preset}`}
								aria-pressed={pickerHex(value, defaultValue) === preset}
								title={preset}
							>
								<span aria-hidden="true" />
							</button>
						))}
					</div>
					<span className="track-color-picker-note">Source · .color()</span>
				</div>
			) : null}
		</div>
	);
}
