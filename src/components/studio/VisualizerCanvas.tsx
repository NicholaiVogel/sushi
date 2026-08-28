import { useEffect, useRef } from 'react';
import type { RuntimeState } from '../../lib/project/model';
import type { StrudelVisualizer, VisualizerHap } from '../../lib/strudel/adapter';

export interface VisualizerCanvasProps {
	trackId: string;
	trackName: string;
	visualizer: StrudelVisualizer;
	trackColor: string;
	runtime: RuntimeState;
	windowStartCycle: number;
	windowEndCycle: number;
	getVisualizerHaps: (
		trackId: string,
		visualizer: StrudelVisualizer,
		begin: number,
		end: number,
	) => VisualizerHap[];
	getVisualizerScopeData: (trackId: string) => ArrayLike<number> | undefined;
	getVisualizerSpectrumData: (trackId: string) => ArrayLike<number> | undefined;
}

type VisualizerFrameListener = (timestamp: number) => void;

// Strudel's Drawer owns one animation loop for the whole editor. Keep the
// same shape here instead of giving every scope canvas its own rAF callback.
// The listeners still draw independently, but the browser only has to schedule
// one frame callback for a large arrangement.
const visualizerFrameListeners = new Set<VisualizerFrameListener>();
let visualizerFrameHandle: number | undefined;

function runVisualizerFrames(timestamp: number): void {
	visualizerFrameHandle = undefined;
	for (const listener of visualizerFrameListeners) listener(timestamp);
	if (visualizerFrameListeners.size && typeof window !== 'undefined') {
		visualizerFrameHandle = window.requestAnimationFrame(runVisualizerFrames);
	}
}

function subscribeToVisualizerFrames(listener: VisualizerFrameListener): () => void {
	visualizerFrameListeners.add(listener);
	if (visualizerFrameHandle === undefined && typeof window !== 'undefined') {
		visualizerFrameHandle = window.requestAnimationFrame(runVisualizerFrames);
	}
	return () => {
		visualizerFrameListeners.delete(listener);
		if (!visualizerFrameListeners.size && visualizerFrameHandle !== undefined && typeof window !== 'undefined') {
			window.cancelAnimationFrame(visualizerFrameHandle);
			visualizerFrameHandle = undefined;
		}
	};
}

const DEFAULT_MIN_MIDI = 36;
const DEFAULT_MAX_MIDI = 84;
const NOTE_BASE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

function finiteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function noteToMidi(value: unknown, valueKey?: string): number | undefined {
	const numeric = finiteNumber(value);
	if (numeric !== undefined) {
		// Strudel's n() values are scale degrees. Keeping them around middle C
		// makes an untransformed n pattern useful in the piano roll too.
		return valueKey === 'n' && numeric < 24 ? numeric + 60 : numeric;
	}
	if (typeof value !== 'string') return undefined;
	const match = value.trim().match(/^([a-g])([#b]?)(-?\d+)$/i);
	if (!match) return undefined;
	const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
	return (Number(match[3]) + 1) * 12 + NOTE_BASE[match[1].toLowerCase()] + accidental;
}

function frequencyToMidi(value: unknown): number | undefined {
	const frequency = finiteNumber(value);
	if (frequency === undefined || frequency <= 0) return undefined;
	return 69 + 12 * Math.log2(frequency / 440);
}

function hashToMidi(value: string): number {
	let hash = 0;
	for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
	return 36 + Math.abs(hash % 37);
}

function valueMidi(value: Record<string, unknown>): number | undefined {
	const noteKey = value.note !== undefined ? 'note' : value.n !== undefined ? 'n' : value.freq !== undefined ? 'freq' : undefined;
	if (noteKey === 'freq') return frequencyToMidi(value.freq);
	const note = noteToMidi(value[noteKey ?? 'note'], noteKey);
	if (note !== undefined) return note;
	return typeof value.s === 'string' ? hashToMidi(value.s) : undefined;
}

function valueLabel(value: Record<string, unknown>): string | undefined {
	const label = value.note ?? value.n ?? value.s;
	return typeof label === 'string' || typeof label === 'number' ? String(label) : undefined;
}

function eventColor(value: Record<string, unknown>, fallback: string): string {
	return typeof value.color === 'string' && value.color.trim() ? value.color : fallback;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
	if (typeof ctx.roundRect === 'function') {
		ctx.beginPath();
		ctx.roundRect(x, y, width, height, radius);
		ctx.fill();
		return;
	}
	ctx.fillRect(x, y, width, height);
}

function drawPianoRoll(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	windowStart: number,
	windowEnd: number,
	haps: VisualizerHap[],
	trackColor: string,
): void {
	const range = Math.max(windowEnd - windowStart, 0.001);
	const events = haps
		.map((hap) => ({ ...hap, midi: valueMidi(hap.value) }))
		.filter((hap): hap is typeof hap & { midi: number } => hap.midi !== undefined);
	const minMidi = events.length ? Math.max(0, Math.floor(Math.min(...events.map((event) => event.midi)) - 3)) : DEFAULT_MIN_MIDI;
	const maxMidi = events.length ? Math.min(127, Math.ceil(Math.max(...events.map((event) => event.midi)) + 3)) : DEFAULT_MAX_MIDI;
	const midiRange = Math.max(maxMidi - minMidi, 12);

	ctx.strokeStyle = 'rgba(220, 229, 223, 0.11)';
	ctx.lineWidth = 1;
	for (let midi = minMidi; midi <= maxMidi; midi += 12) {
		const y = height - ((midi - minMidi) / midiRange) * height;
		ctx.beginPath();
		ctx.moveTo(0, Math.round(y) + 0.5);
		ctx.lineTo(width, Math.round(y) + 0.5);
		ctx.stroke();
	}

	for (const event of events) {
		const begin = Math.max(windowStart, event.begin);
		const end = Math.min(windowEnd, event.end);
		if (end <= begin) continue;
		const x = ((begin - windowStart) / range) * width;
		const eventWidth = Math.max(((end - begin) / range) * width, 2);
		const y = height - ((event.midi - minMidi + 1) / midiRange) * height;
		const noteHeight = Math.max(4, height / Math.min(midiRange, 64) - 1);
		ctx.globalAlpha = 0.82;
		ctx.fillStyle = eventColor(event.value, trackColor);
		drawRoundedRect(ctx, x, y - noteHeight, eventWidth, noteHeight, 2);
		if (eventWidth > 24) {
			const label = valueLabel(event.value);
			if (label) {
				ctx.globalAlpha = 0.72;
				ctx.fillStyle = '#0b1010';
				ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
				ctx.textBaseline = 'middle';
				ctx.fillText(label, x + 4, y - noteHeight / 2, Math.max(0, eventWidth - 8));
			}
		}
	}
}

function drawScope(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	windowStart: number,
	windowEnd: number,
	haps: VisualizerHap[],
	trackColor: string,
	samples: Float32Array,
	scopeData?: ArrayLike<number>,
): void {
	const range = Math.max(windowEnd - windowStart, 0.001);
	const center = height * 0.52;
	const amplitude = Math.max(8, height * 0.34);
	ctx.strokeStyle = 'rgba(220, 229, 223, 0.12)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(0, center + 0.5);
	ctx.lineTo(width, center + 0.5);
	ctx.stroke();

	const liveData = scopeData && scopeData.length > 1 && hasSignal(scopeData) ? scopeData : undefined;
	for (let index = 0; index < samples.length; index += 1) {
		if (liveData) {
			samples[index] = liveData[index % liveData.length] ?? 0;
			continue;
		}
		const cycle = windowStart + (index / (samples.length - 1)) * range;
		let sample = 0;
		for (const event of haps) {
			if (cycle < event.begin || cycle > event.end) continue;
			const midi = valueMidi(event.value) ?? 48;
			const normalized = Math.max(1, Math.min(18, (midi - 24) / 4));
			const phase = (cycle - event.begin) * normalized * Math.PI * 2;
			const progress = Math.min(1, Math.max(0, (cycle - event.begin) / Math.max(event.end - event.begin, 0.001)));
			const envelope = Math.sin(Math.PI * progress) * 0.85 + 0.15;
			sample += Math.sin(phase) * envelope * 0.45;
		}
		samples[index] = Math.max(-1, Math.min(1, sample));
	}

	ctx.globalAlpha = 0.82;
	ctx.strokeStyle = trackColor;
	ctx.shadowColor = trackColor;
	ctx.shadowBlur = 7;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	for (let index = 0; index < samples.length; index += 1) {
		const x = index / (samples.length - 1) * width;
		const y = center - samples[index] * amplitude;
		if (index === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.stroke();
	ctx.shadowBlur = 0;
}

function drawSpectrum(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	data: ArrayLike<number> | undefined,
	trackColor: string,
): void {
	const baseline = height - 1;
	ctx.strokeStyle = 'rgba(220, 229, 223, 0.12)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(0, baseline + 0.5);
	ctx.lineTo(width, baseline + 0.5);
	ctx.stroke();

	if (!data || data.length < 2) return;

	// `getFloatFrequencyData` returns dB values (normally -100..0). Draw a
	// compact, logarithmically sampled bar graph so a narrow clip does not spend
	// a frame painting hundreds of one-pixel bins.
	const barCount = Math.min(96, Math.max(12, Math.floor(width / 3)));
	const barWidth = width / barCount;
	ctx.fillStyle = trackColor;
	ctx.shadowColor = trackColor;
	ctx.shadowBlur = 6;
	for (let bar = 0; bar < barCount; bar += 1) {
		const start = Math.floor((bar / barCount) ** 2 * data.length);
		const end = Math.max(start + 1, Math.floor(((bar + 1) / barCount) ** 2 * data.length));
		let peak = -100;
		for (let index = start; index < Math.min(end, data.length); index += 1) {
			const value = Number(data[index]);
			if (Number.isFinite(value)) peak = Math.max(peak, value);
		}
		const normalized = Math.max(0, Math.min(1, (peak + 100) / 100));
		if (normalized <= 0) continue;
		ctx.globalAlpha = 0.2 + normalized * 0.72;
		const barHeight = Math.max(1, normalized * (height - 4));
		ctx.fillRect(bar * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
	}
	ctx.globalAlpha = 1;
	ctx.shadowBlur = 0;
}

function hasSignal(data: ArrayLike<number>): boolean {
	for (let index = 0; index < data.length; index += 1) {
		if (Math.abs(data[index] ?? 0) > 0.005) return true;
	}
	return false;
}

export function VisualizerCanvas({
	trackId,
	trackName,
	visualizer,
	trackColor,
	runtime,
	windowStartCycle,
	windowEndCycle,
	getVisualizerHaps,
	getVisualizerScopeData,
	getVisualizerSpectrumData,
}: VisualizerCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const runtimeRef = useRef(runtime);
	const drawRef = useRef<((analyzerData?: ArrayLike<number>) => void) | undefined>(undefined);
	const analyzerDataRef = useRef<ArrayLike<number> | undefined>(undefined);
	runtimeRef.current = runtime;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return undefined;
		let scopeSamples = new Float32Array(0);
		analyzerDataRef.current = undefined;
		const windowStart = Math.max(0, windowStartCycle);
		const windowEnd = Math.max(windowStart + 0.001, windowEndCycle);
		// Haps are derived from the accepted Strudel pattern. They are static for
		// this clip, so querying them once per source/range change keeps the audio
		// scheduler out of the visualizer's frame loop.
		const haps = getVisualizerHaps(trackId, visualizer, windowStart, windowEnd);

		const draw = (analyzerData = analyzerDataRef.current) => {
			const rect = canvas.getBoundingClientRect();
			const width = Math.max(1, Math.floor(rect.width));
			const height = Math.max(1, Math.floor(rect.height));
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const pixelWidth = Math.max(1, Math.floor(width * dpr));
			const pixelHeight = Math.max(1, Math.floor(height * dpr));
			const sampleCount = Math.max(2, Math.floor(width));
			if (scopeSamples.length !== sampleCount) scopeSamples = new Float32Array(sampleCount);
			if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
				canvas.width = pixelWidth;
				canvas.height = pixelHeight;
			}
			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, width, height);
			ctx.fillStyle = 'rgba(8, 12, 12, 0.22)';
			ctx.fillRect(0, 0, width, height);
			if (visualizer === 'pianoroll') drawPianoRoll(ctx, width, height, windowStart, windowEnd, haps, trackColor);
			else if (visualizer === 'scope') drawScope(ctx, width, height, windowStart, windowEnd, haps, trackColor, scopeSamples, analyzerData);
			else drawSpectrum(ctx, width, height, analyzerData, trackColor);
			ctx.globalAlpha = 1;
		};

		drawRef.current = draw;
		draw();
		const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : undefined;
		observer?.observe(canvas);
		return () => {
			observer?.disconnect();
			if (drawRef.current === draw) drawRef.current = undefined;
		};
	}, [getVisualizerHaps, trackColor, trackId, visualizer, windowEndCycle, windowStartCycle]);

	useEffect(() => {
		if (visualizer !== 'scope' && visualizer !== 'spectrum') return undefined;
		if (runtime.transport !== 'playing') {
			drawRef.current?.();
			return undefined;
		}

		let lastScopeDraw = -Infinity;
		return subscribeToVisualizerFrames((timestamp) => {
			if (runtimeRef.current.transport !== 'playing') return;
			// Analyzer data is useful at audio-monitoring rates, not at every display
			// refresh. Capping this work keeps a multi-scope arrangement cheap while
			// preserving a responsive waveform.
			if (timestamp - lastScopeDraw < 33) return;
			lastScopeDraw = timestamp;
			const analyzerData = visualizer === 'scope'
				? getVisualizerScopeData(trackId)
				: getVisualizerSpectrumData(trackId);
			analyzerDataRef.current = analyzerData;
			drawRef.current?.(analyzerData);
		});
	}, [getVisualizerScopeData, getVisualizerSpectrumData, runtime.transport, trackId, visualizer]);

	return (
		<canvas
			ref={canvasRef}
			className={`track-visualizer-canvas track-visualizer-${visualizer}`}
			role="img"
			aria-label={`${trackName} ${visualizer === 'pianoroll' ? 'piano roll' : visualizer} visualizer`}
		/>
	);
}
