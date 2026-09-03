import { MidiRecorder, classifyMidiMessage, normalizeMidiTimestamp } from './recorder';
import {
	MIDI_CHANNELS,
	type MidiActivity,
	type MidiChannel,
	type MidiClock,
	type MidiClockSnapshot,
	type MidiExternalClockUpdate,
	type MidiMessageKind,
	type MidiPortConnection,
	type MidiPortState,
	type MidiPortSummary,
	type MidiRawMessage,
	type MidiRecordedTake,
	type MidiRecordingOptions,
	type MidiRecordingStatus,
	type MidiRuntimeError,
	type MidiRuntimeState,
	type MidiLearnedControl,
	type MidiLiveInputHandler,
	type MidiServiceListener,
	type MidiServiceSnapshot,
	normalizeMidiChannel,
} from './types';

interface MidiInputLike {
	id?: string;
	name?: string;
	manufacturer?: string;
	type?: string;
	state?: string;
	connection?: string;
	addListener?: (event: string, callback: (event: unknown) => void) => unknown;
	removeListener?: (event?: string, callback?: (event: unknown) => void) => unknown;
}

interface MidiOutputLike {
	id?: string;
	name?: string;
	manufacturer?: string;
	type?: string;
	state?: string;
	connection?: string;
	send?: (data: number[], options?: unknown) => unknown;
	playNote?: (note: number | string, options?: Record<string, unknown>) => unknown;
	sendAllNotesOff?: (options?: Record<string, unknown>) => unknown;
	sendAllSoundOff?: (options?: Record<string, unknown>) => unknown;
	sendResetAllControllers?: (options?: Record<string, unknown>) => unknown;
}

interface WebMidiLike {
	/** One-shot permission gate installed by StrudelAdapter for native .midi(). */
	__sushiMidiAllowEnable?: boolean;
	enabled?: boolean;
	sysexEnabled?: boolean;
	inputs?: MidiInputLike[];
	outputs?: MidiOutputLike[];
	enable?: (options?: { sysex?: boolean }) => Promise<unknown>;
	disable?: () => Promise<unknown>;
	addListener?: (event: string, callback: (event: unknown) => void) => unknown;
	removeListener?: (event?: string, callback?: (event: unknown) => void) => unknown;
}

interface MidiModuleLike {
	WebMidi?: WebMidiLike;
}

/** Synthetic input used when the computer keyboard is acting as a piano. */
export const COMPUTER_KEYBOARD_INPUT_ID = 'computer-keyboard';
export const COMPUTER_KEYBOARD_INPUT_NAME = 'Computer keyboard';

export type MidiModuleLoader = () => Promise<MidiModuleLike>;

export interface MidiServiceOptions {
	loadModule?: MidiModuleLoader;
	now?: () => number;
}

export interface MidiConnectOptions {
	sysex?: boolean;
}

export interface MidiRecordingStart {
	options: MidiRecordingOptions;
	clock: MidiClockSnapshot;
}

const MIDI_EVENT_NAMES = ['connected', 'disconnected', 'portschanged', 'enabled'] as const;
const ALL_MIDI_CHANNELS = [...MIDI_CHANNELS];
const MIDI_PREFERENCES_KEY = 'sushi-midi-preferences';
interface MidiPreferences {
	inputId?: string;
	outputId?: string;
	inputName?: string;
	outputName?: string;
	inputChannel?: MidiChannel;
	outputChannel?: number;
	monitor?: boolean;
	clockMode?: MidiRuntimeState['clockMode'];
}

function defaultSupported(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

function defaultSecureContext(): boolean {
	if (typeof globalThis.isSecureContext === 'boolean') return globalThis.isSecureContext;
	if (typeof location !== 'undefined') return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1';
	return false;
}

function normalizePortState(value: unknown): MidiPortState {
	return value === 'connected' || value === 'disconnected' ? value : 'unknown';
}

function normalizePortConnection(value: unknown): MidiPortConnection {
	return value === 'open' || value === 'closed' || value === 'pending' ? value : 'unknown';
}

function portId(port: { id?: string; name?: string }, index: number): string {
	return typeof port.id === 'string' && port.id ? port.id : `${port.name || 'midi-port'}-${index}`;
}

function portSummary(port: MidiInputLike | MidiOutputLike, type: 'input' | 'output', index: number): MidiPortSummary {
	return {
		id: portId(port, index),
		name: typeof port.name === 'string' && port.name.trim() ? port.name : `${type === 'input' ? 'MIDI input' : 'MIDI output'} ${index + 1}`,
		...(typeof port.manufacturer === 'string' && port.manufacturer.trim() ? { manufacturer: port.manufacturer } : {}),
		type,
		state: normalizePortState(port.state),
		connection: normalizePortConnection(port.connection),
	};
}

function errorCode(error: unknown): string {
	if (typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string') return (error as { code: string }).code;
	if (typeof error === 'object' && error !== null && typeof (error as { name?: unknown }).name === 'string') return (error as { name: string }).name.toUpperCase();
	return 'MIDI_ERROR';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function defaultRecordingOptions(trackId: string, inputId: string | null, channel: MidiChannel = 'all'): MidiRecordingOptions {
	return {
		trackId,
		...(inputId ? { inputId } : {}),
		channel,
		mode: 'replace',
		quantize: '1/16',
		quantizeStrength: 1,
		swing: 0,
		countInBars: 1,
		loop: false,
		captureAutomation: true,
	};
}

/**
 * Browser-only MIDI access and recording lifecycle. The class deliberately
 * exposes plain serializable state so Studio, WebMCP, and a CLI bridge share
 * exactly the same device/recording contract.
 */
export class MidiService {
	private readonly loadModule: MidiModuleLoader;
	private readonly now: () => number;
	private readonly listeners = new Set<MidiServiceListener>();
	private readonly recorder = new MidiRecorder();
	private readonly inputHandlers = new Map<string, { input: MidiInputLike; handler: (event: unknown) => void }>();
	private readonly webMidiHandlers = new Map<string, (event: unknown) => void>();
	private webMidi: WebMidiLike | undefined;
	private moduleLoaded = false;
	private connectPromise: Promise<MidiRuntimeState> | undefined;
	private clock: MidiClock | undefined;
	private clockTimer: ReturnType<typeof setInterval> | undefined;
	private externalClockWatchTimer: ReturnType<typeof setInterval> | undefined;
	private readonly testNoteTimers = new Set<ReturnType<typeof setTimeout>>();
	private tempoBpm = 120;
	private transportClockRunning = false;
	private lastExternalClockMs: number | undefined;
	private externalTransportHandler: ((action: 'start' | 'continue' | 'stop') => void) | undefined;
	private externalClockHandler: ((update: MidiExternalClockUpdate) => void) | undefined;
	private liveInputHandler: MidiLiveInputHandler | undefined;
	private preferences: MidiPreferences = {};
	private state: MidiRuntimeState;

	public constructor(options: MidiServiceOptions = {}) {
		this.loadModule = options.loadModule ?? (async () => await import('@strudel/midi') as unknown as MidiModuleLike);
		this.now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
		this.preferences = this.readPreferences();
		this.state = {

			supported: defaultSupported(),
			secureContext: defaultSecureContext(),
			permission: defaultSupported() ? 'unknown' : 'unsupported',
			enabled: false,
			sysexEnabled: false,
			inputs: [],
			outputs: [],
			selectedInputId: null,
			selectedOutputId: null,
			inputChannel: normalizeMidiChannel(this.preferences.inputChannel, 'all'),
			outputChannel: this.preferences.outputChannel && this.preferences.outputChannel >= 1 && this.preferences.outputChannel <= 16 ? this.preferences.outputChannel : 1,
			monitor: this.preferences.monitor === true,
			clockMode: this.preferences.clockMode === 'send' || this.preferences.clockMode === 'receive' ? this.preferences.clockMode : 'off',
			clockRunning: false,
			externalClockTicks: 0,
			externalClockRunning: false,
			learning: false,
			recording: this.idleRecording(),
		};
	}

	public getState(): MidiRuntimeState {
		return this.cloneState(this.state);
	}

	public getSnapshot(): MidiServiceSnapshot {
		return { state: this.getState(), midiModuleLoaded: this.moduleLoaded };
	}

	public subscribe(listener: MidiServiceListener): () => void {
		this.listeners.add(listener);
		listener(this.getState());
		return () => this.listeners.delete(listener);
	}

	public setClock(clock: MidiClock | undefined): void {
		this.clock = clock;
	}

	public setExternalTransportHandler(handler: ((action: 'start' | 'continue' | 'stop') => void) | undefined): void {
		this.externalTransportHandler = handler;
	}

	public setExternalClockHandler(handler: ((update: MidiExternalClockUpdate) => void) | undefined): void {
		this.externalClockHandler = handler;
	}

	public setLiveInputHandler(handler: MidiLiveInputHandler | undefined): void {
		this.liveInputHandler = handler;
	}

	public async connect(options: MidiConnectOptions = {}): Promise<MidiRuntimeState> {
		if (this.connectPromise) return this.connectPromise;
		this.connectPromise = this.connectNow(options).finally(() => {
			this.connectPromise = undefined;
		});
		return this.connectPromise;
	}

	private async connectNow(options: MidiConnectOptions): Promise<MidiRuntimeState> {
		this.patchState({ lastError: undefined });
		if (!this.state.supported) return this.fail('MIDI_UNSUPPORTED', 'This browser does not expose the Web MIDI API.');
		if (!this.state.secureContext) return this.fail('MIDI_INSECURE_CONTEXT', 'Web MIDI requires HTTPS or localhost.');
		try {
			const module = await this.loadModule();
			this.moduleLoaded = true;
			const webMidi = module.WebMidi;
			if (!webMidi) throw new Error('The Strudel MIDI runtime did not expose WebMidi.');
			this.webMidi = webMidi;
			if (!webMidi.enabled) {
				if (typeof webMidi.enable !== 'function') throw new Error('The WebMidi runtime cannot be enabled.');
				webMidi.__sushiMidiAllowEnable = true;
				try {
					await webMidi.enable({ sysex: options.sysex === true });
				} finally {
					webMidi.__sushiMidiAllowEnable = false;
				}
			}
			if (webMidi.enabled !== true) throw new Error('The WebMidi runtime did not become enabled.');
			this.attachWebMidiListeners();
			this.refreshPorts();
			this.patchState({
				enabled: true,
				sysexEnabled: webMidi.sysexEnabled === true,
				permission: 'granted',
				lastError: undefined,
			});
			if (this.state.clockMode === 'receive') this.scheduleExternalClockWatch();
			return this.getState();
		} catch (error) {
			const code = errorCode(error);
			const permission = code === 'NOTALLOWEDERROR' || code === 'SECURITYERROR' || /permission|denied|not allowed/i.test(errorMessage(error)) ? 'denied' : 'error';
			return this.fail(permission === 'denied' ? 'MIDI_PERMISSION_DENIED' : 'MIDI_ENABLE_FAILED', errorMessage(error), permission);
		}
	}

	public refreshPorts(): MidiRuntimeState {
		const inputs = (this.webMidi?.inputs ?? []).map((port, index) => portSummary(port, 'input', index));
		const outputs = (this.webMidi?.outputs ?? []).map((port, index) => portSummary(port, 'output', index));
		const preferredInput = inputs.find((port) => port.id === this.preferences.inputId)
			?? (this.preferences.inputName ? inputs.find((port) => port.name === this.preferences.inputName) : undefined);
		const preferredOutput = outputs.find((port) => port.id === this.preferences.outputId)
			?? (this.preferences.outputName ? outputs.find((port) => port.name === this.preferences.outputName) : undefined);
		const selectedInputId = inputs.some((port) => port.id === this.state.selectedInputId)
			? this.state.selectedInputId
			: this.state.selectedInputId === null ? preferredInput?.id ?? inputs[0]?.id ?? null : null;
		const selectedOutputId = outputs.some((port) => port.id === this.state.selectedOutputId)
			? this.state.selectedOutputId
			: this.state.selectedOutputId === null ? preferredOutput?.id ?? outputs[0]?.id ?? null : null;
		this.detachInputListeners();
		this.attachInputListeners();
		this.patchState({ inputs, outputs, selectedInputId, selectedOutputId });
		return this.getState();
	}

	public async disconnect(): Promise<MidiRuntimeState> {
		const preserveReview = this.state.recording.status === 'review' && this.state.recording.take !== null;
		if (!preserveReview) this.cancelRecording();
		this.stopTransportClock(false);
		this.stopExternalClockWatch();
		this.panic();
		this.detachInputListeners();
		this.detachWebMidiListeners();
		const webMidi = this.webMidi;
		this.webMidi = undefined;
		if (webMidi?.enabled && typeof webMidi.disable === 'function') {
			try { await webMidi.disable(); } catch { /* best-effort cleanup */ }
		}
		this.patchState({ enabled: false, sysexEnabled: false, permission: this.state.supported ? 'unknown' : 'unsupported', inputs: [], outputs: [], selectedInputId: null, selectedOutputId: null, recording: preserveReview ? this.state.recording : this.idleRecording(), lastError: undefined });
		return this.getState();
	}

	public setSelectedInput(id: string | null): MidiRuntimeState {
		const resolvedId = id === null ? null : this.resolvePortId(id, 'input');
		if (id !== null && !resolvedId) return this.fail('MIDI_INPUT_NOT_FOUND', `No connected MIDI input matches ${JSON.stringify(id)}.`);
		this.patchState({ selectedInputId: resolvedId, lastError: undefined });
		this.preferences.inputId = resolvedId ?? undefined;
		this.preferences.inputName = resolvedId === null ? undefined : this.state.inputs.find((port) => port.id === resolvedId)?.name;
		this.writePreferences();
		return this.getState();
	}

	public setSelectedOutput(id: string | null): MidiRuntimeState {
		const resolvedId = id === null ? null : this.resolvePortId(id, 'output');
		if (id !== null && !resolvedId) return this.fail('MIDI_OUTPUT_NOT_FOUND', `No connected MIDI output matches ${JSON.stringify(id)}.`);
		this.patchState({ selectedOutputId: resolvedId, lastError: undefined });
		this.preferences.outputId = resolvedId ?? undefined;
		this.preferences.outputName = resolvedId === null ? undefined : this.state.outputs.find((port) => port.id === resolvedId)?.name;
		this.writePreferences();
		return this.getState();
	}

	public setInputChannel(channel: MidiChannel): MidiRuntimeState {
		this.patchState({ inputChannel: normalizeMidiChannel(channel, 'all'), lastError: undefined });
		this.preferences.inputChannel = this.state.inputChannel;
		this.writePreferences();
		return this.getState();
	}

	public setOutputChannel(channel: number): MidiRuntimeState {
		if (!Number.isInteger(channel) || channel < 1 || channel > 16) return this.fail('MIDI_INVALID_CHANNEL', 'MIDI output channel must be an integer from 1 to 16.');
		this.patchState({ outputChannel: channel, lastError: undefined });
		this.preferences.outputChannel = channel;
		this.writePreferences();
		return this.getState();
	}

	public setMonitor(enabled: boolean): MidiRuntimeState {
		this.patchState({ monitor: Boolean(enabled), lastError: undefined });
		this.preferences.monitor = Boolean(enabled);
		this.writePreferences();
		return this.getState();
	}

	public beginControlLearn(): MidiRuntimeState {
		if (!this.state.enabled) return this.fail('MIDI_NOT_CONNECTED', 'Connect MIDI before learning a controller.');
		this.patchState({ learning: true, lastError: undefined });
		return this.getState();
	}

	public cancelControlLearn(): MidiRuntimeState {
		this.patchState({ learning: false });
		return this.getState();
	}

	public setClockMode(mode: MidiRuntimeState['clockMode']): MidiRuntimeState {
		if (mode !== 'off' && mode !== 'send' && mode !== 'receive') return this.fail('MIDI_INVALID_CLOCK_MODE', 'MIDI clock mode must be off, send, or receive.');
		this.patchState({ clockMode: mode, lastError: undefined, externalClockRunning: false, externalClockBpm: undefined });
		if (mode !== 'send') this.stopTransportClock();
		this.lastExternalClockMs = undefined;
		if (mode === 'receive') this.scheduleExternalClockWatch();
		else this.stopExternalClockWatch();
		if (mode === 'send' && this.transportClockRunning) this.scheduleTransportClockTicks();
		this.preferences.clockMode = mode;
		this.writePreferences();
		return this.getState();
	}

	public setTempo(bpm: number): MidiRuntimeState {
		if (!Number.isFinite(bpm) || bpm <= 0) return this.getState();
		this.tempoBpm = Math.min(300, bpm);
		if (this.transportClockRunning) this.scheduleTransportClockTicks();
		return this.getState();
	}

	/** Start MIDI clock output without creating a second musical scheduler. */
	public startTransportClock(): MidiRuntimeState {
		if (this.state.clockMode !== 'send' || !this.state.enabled) return this.getState();
		const output = this.selectedOutput();
		if (!output?.send) return this.fail('MIDI_OUTPUT_REQUIRED', 'Select a MIDI output before sending MIDI clock.');
		this.stopTransportClock(false);
		try {
			output.send([0xfa]);
			this.scheduleTransportClockTicks();
			this.transportClockRunning = true;
			this.patchState({ clockRunning: true, lastError: undefined });
		} catch (error) {
			return this.fail('MIDI_CLOCK_FAILED', errorMessage(error));
		}
		return this.getState();
	}

	public stopTransportClock(sendStop = true): MidiRuntimeState {
		if (this.clockTimer !== undefined) clearInterval(this.clockTimer);
		this.clockTimer = undefined;
		const wasRunning = this.transportClockRunning;
		this.transportClockRunning = false;
		if (sendStop && wasRunning) {
			try { this.selectedOutput()?.send?.([0xfc]); } catch (error) { this.patchState({ lastError: { code: 'MIDI_CLOCK_FAILED', message: errorMessage(error) } }); }
		}
		if (this.state.clockRunning) this.patchState({ clockRunning: false });
		return this.getState();
	}

	public armRecording(options: Partial<MidiRecordingOptions> & Pick<MidiRecordingOptions, 'trackId'>): MidiRuntimeState {
		if (this.state.recording.status === 'armed' || this.state.recording.status === 'count-in' || this.state.recording.status === 'recording' || this.state.recording.status === 'stopping') return this.fail('MIDI_RECORD_ALREADY_ACTIVE', 'Stop or cancel the current MIDI recording before arming another take.');
		if (!options.trackId.trim()) return this.fail('MIDI_RECORD_TRACK_REQUIRED', 'A target track is required before recording MIDI.');
		const requestedInputId = options.inputId ?? this.state.selectedInputId;
		const computerKeyboard = requestedInputId === COMPUTER_KEYBOARD_INPUT_ID;
		if (!this.state.enabled && !computerKeyboard) return this.fail('MIDI_NOT_CONNECTED', 'Connect MIDI or choose the computer keyboard before arming a recording.');
		const inputId = computerKeyboard
			? COMPUTER_KEYBOARD_INPUT_ID
			: requestedInputId === null || requestedInputId === undefined ? null : this.resolvePortId(requestedInputId, 'input');
		if (!inputId) return this.fail('MIDI_INPUT_REQUIRED', 'Select a MIDI input before arming a recording.');
		if (!computerKeyboard && !this.state.inputs.some((input) => input.id === inputId)) return this.fail('MIDI_INPUT_NOT_FOUND', `No connected MIDI input matches ${JSON.stringify(requestedInputId)}.`);
		const defaults = defaultRecordingOptions(options.trackId, inputId, this.state.inputChannel);
		const normalized: MidiRecordingOptions = {
			...defaults,
			...options,
			inputId,
			channel: normalizeMidiChannel(options.channel, defaults.channel),
			quantizeStrength: clamp(Number(options.quantizeStrength ?? defaults.quantizeStrength), 0, 1),
			swing: clamp(Number(options.swing ?? defaults.swing), 0, 0.5),
			countInBars: options.countInBars === 0 || options.countInBars === 2 ? options.countInBars : 1,
			loop: options.loop === true,
			captureAutomation: options.captureAutomation !== false,
		};
		this.patchState({ recording: { ...this.idleRecording(), status: 'armed', trackId: normalized.trackId, inputId, options: normalized }, lastError: undefined });
		return this.getState();
	}

	public setRecordingStatus(status: Extract<MidiRecordingStatus, 'armed' | 'count-in' | 'recording'>): MidiRuntimeState {
		if ((this.state.recording.status !== 'armed' && this.state.recording.status !== 'count-in') || !this.state.recording.options) return this.fail('MIDI_RECORD_NOT_ARMED', 'Arm a MIDI recording before changing its state.');
		this.patchState({ recording: { ...this.state.recording, status } });
		return this.getState();
	}

	public startRecording(start: MidiRecordingStart): MidiRuntimeState {
		const options = start.options ?? this.state.recording.options;
		if ((this.state.recording.status !== 'armed' && this.state.recording.status !== 'count-in') || !options) return this.fail('MIDI_RECORD_NOT_ARMED', 'Arm a MIDI recording before starting it.');
		const requestedInputId = options.inputId ?? this.state.selectedInputId;
		const computerKeyboard = requestedInputId === COMPUTER_KEYBOARD_INPUT_ID;
		if (!this.state.enabled && !computerKeyboard) return this.fail('MIDI_NOT_CONNECTED', 'Connect MIDI or choose the computer keyboard before recording.');
		const inputId = computerKeyboard
			? COMPUTER_KEYBOARD_INPUT_ID
			: requestedInputId === null || requestedInputId === undefined ? null : this.resolvePortId(requestedInputId, 'input');
		if (!inputId) return this.fail('MIDI_INPUT_REQUIRED', 'Select a MIDI input before recording.');
		if (!computerKeyboard && !this.state.inputs.some((input) => input.id === inputId)) return this.fail('MIDI_INPUT_NOT_FOUND', `No connected MIDI input matches ${JSON.stringify(requestedInputId)}.`);
		this.recorder.start({ ...options, inputId }, start.clock, inputId);
		this.patchState({ recording: { status: 'recording', trackId: options.trackId, inputId, startedAtCycle: Math.max(0, start.clock.cycle), currentCycle: Math.max(0, start.clock.cycle), noteCount: 0, automationCount: 0, activeNoteCount: 0, take: this.recorder.snapshotTake(start.clock), options: { ...options, inputId } }, lastError: undefined });
		return this.getState();
	}

	public syncRecordingClock(clock: MidiClockSnapshot): MidiRuntimeState {
		if (!this.recorder.isRecording) return this.getState();
		this.recorder.syncClock(clock);
		const snapshot = this.recorder.snapshot(clock);
		this.patchState({ recording: { ...this.state.recording, currentCycle: snapshot.currentCycle, noteCount: snapshot.noteCount, automationCount: snapshot.automationCount, activeNoteCount: snapshot.activeNoteCount, take: this.recorder.snapshotTake(clock) } });
		return this.getState();
	}

	public stopRecording(clock: MidiClockSnapshot): MidiRecordedTake | null {
		if (!this.recorder.isRecording) return this.state.recording.take;
		this.patchState({ recording: { ...this.state.recording, status: 'stopping' } });
		const take = this.recorder.stop(clock);
		this.patchState({ recording: { ...this.state.recording, status: 'review', currentCycle: take.endedAtCycle, noteCount: take.notes.length, automationCount: take.automation.length, activeNoteCount: 0, take } });
		return take;
	}

	public acceptRecording(): MidiRuntimeState {
		if (this.state.recording.status !== 'review') return this.fail('MIDI_RECORD_NOT_IN_REVIEW', 'There is no MIDI take waiting for review.');
		this.patchState({ recording: this.idleRecording(), lastError: undefined });
		return this.getState();
	}

	public cancelRecording(): MidiRuntimeState {
		this.recorder.cancel();
		this.patchState({ recording: this.idleRecording(), lastError: undefined });
		return this.getState();
	}

	public async testNote(note = 60, durationMs = 180, velocity = 0.75): Promise<MidiRuntimeState> {
		if (!this.state.enabled) return this.fail('MIDI_NOT_CONNECTED', 'Connect MIDI before sending a test note.');
		const output = this.selectedOutput();
		if (!output) return this.fail('MIDI_OUTPUT_REQUIRED', 'Select a MIDI output before sending a test note.');
		if (!Number.isInteger(note) || note < 0 || note > 127) return this.fail('MIDI_INVALID_NOTE', 'MIDI test note must be an integer from 0 to 127.');
		try {
			const safeDuration = Math.max(1, Math.round(durationMs));
			if (typeof output.playNote === 'function') output.playNote(note, { channels: this.state.outputChannel, duration: safeDuration, attack: clamp(velocity, 0, 1) });
			else {
				const status = 0x90 + this.state.outputChannel - 1;
				output.send?.([status, note, Math.round(clamp(velocity, 0, 1) * 127)]);
				const timer = setTimeout(() => {
					this.testNoteTimers.delete(timer);
					try { output.send?.([0x80 + this.state.outputChannel - 1, note, 0]); } catch { /* panic/disconnect owns recovery */ }
				}, safeDuration);
				this.testNoteTimers.add(timer);
			}
			this.patchState({ lastError: undefined });
		} catch (error) {
			this.fail('MIDI_TEST_FAILED', errorMessage(error));
		}
		return this.getState();
	}

	public panic(outputId?: string | null): MidiRuntimeState {
		this.patchState({ lastError: undefined });
		for (const timer of this.testNoteTimers) clearTimeout(timer);
		this.testNoteTimers.clear();
		const outputs = outputId === undefined || outputId === null
			? (this.webMidi?.outputs ?? [])
			: (this.webMidi?.outputs ?? []).filter((candidate, index) => portId(candidate, index) === outputId || candidate.name === outputId);
		for (const output of outputs) {
			try {
				const options = { channels: ALL_MIDI_CHANNELS };
				output.sendAllSoundOff?.(options);
				output.sendAllNotesOff?.(options);
				output.sendResetAllControllers?.(options);
				if (!output.sendAllNotesOff && output.send) {
					for (const channel of MIDI_CHANNELS) {
						output.send([0xb0 + channel - 1, 120, 0]);
						output.send([0xb0 + channel - 1, 123, 0]);
						output.send([0xb0 + channel - 1, 121, 0]);
					}
				}
			} catch (error) {
				this.patchState({ lastError: { code: 'MIDI_PANIC_FAILED', message: errorMessage(error) } });
			}
		}
		return this.getState();
	}

	public update(): MidiRuntimeState {
		if (this.recorder.isRecording && this.clock) {
			const snapshot = this.clock();
			this.syncRecordingClock(snapshot);
			const loopEnd = this.state.recording.options?.loopEndCycle;
			if (this.state.recording.options?.loop && loopEnd !== undefined && snapshot.cycle >= loopEnd) this.stopRecording({ ...snapshot, cycle: loopEnd });
		}
		return this.getState();
	}

	public destroy(): void {
		this.cancelRecording();
		this.stopTransportClock(false);
		this.stopExternalClockWatch();
		this.panic();
		this.detachInputListeners();
		this.detachWebMidiListeners();
		this.liveInputHandler = undefined;
		this.externalTransportHandler = undefined;
		this.externalClockHandler = undefined;
		const webMidi = this.webMidi;
		this.webMidi = undefined;
		if (webMidi?.enabled && typeof webMidi.disable === 'function') void webMidi.disable().catch(() => undefined);
		this.listeners.clear();
	}

	/**
	 * Feed a note from the laptop keyboard through the same live-input and
	 * recorder path as a Web MIDI message. This deliberately does not require
	 * Web MIDI permission: the browser keyboard is a local fallback input.
	 */
	public ingestKeyboardNote(note: number, velocity: number, on: boolean, timestampMs = this.now(), channel = 1): MidiRuntimeState {
		if (!Number.isInteger(note) || note < 0 || note > 127) return this.fail('MIDI_INVALID_NOTE', 'Keyboard notes must be integers from 0 to 127.');
		if (!Number.isInteger(channel) || channel < 1 || channel > 16) return this.fail('MIDI_INVALID_CHANNEL', 'Keyboard MIDI channel must be an integer from 1 to 16.');
		const safeVelocity = clamp(velocity, 0, 1);
		this.handleRawMessage({
			inputId: COMPUTER_KEYBOARD_INPUT_ID,
			inputName: COMPUTER_KEYBOARD_INPUT_NAME,
			timestampMs: Number.isFinite(timestampMs) ? timestampMs : this.now(),
			data: [on ? 0x90 + channel - 1 : 0x80 + channel - 1, note, on ? Math.round(safeVelocity * 127) : 0],
			kind: on ? 'noteon' : 'noteoff',
			channel,
			data1: note,
			data2: on ? Math.round(safeVelocity * 127) : 0,
		}, true);
		return this.getState();
	}

	private readPreferences(): MidiPreferences {
		if (typeof window === 'undefined') return {};
		try {
			const raw = window.localStorage.getItem(MIDI_PREFERENCES_KEY);
			if (!raw) return {};
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			return {
				...(typeof parsed.inputId === 'string' ? { inputId: parsed.inputId } : {}),
				...(typeof parsed.outputId === 'string' ? { outputId: parsed.outputId } : {}),
				...(typeof parsed.inputName === 'string' ? { inputName: parsed.inputName } : {}),
				...(typeof parsed.outputName === 'string' ? { outputName: parsed.outputName } : {}),
				...(parsed.inputChannel === 'all' || (typeof parsed.inputChannel === 'number' && parsed.inputChannel >= 1 && parsed.inputChannel <= 16) ? { inputChannel: parsed.inputChannel as MidiChannel } : {}),
				...(typeof parsed.outputChannel === 'number' && parsed.outputChannel >= 1 && parsed.outputChannel <= 16 ? { outputChannel: parsed.outputChannel } : {}),
				...(typeof parsed.monitor === 'boolean' ? { monitor: parsed.monitor } : {}),
				...(parsed.clockMode === 'off' || parsed.clockMode === 'send' || parsed.clockMode === 'receive' ? { clockMode: parsed.clockMode } : {}),
			};
		} catch {
			return {};
		}
	}

	private writePreferences(): void {
		if (typeof window === 'undefined') return;
		try { window.localStorage.setItem(MIDI_PREFERENCES_KEY, JSON.stringify(this.preferences)); } catch { /* storage is optional */ }
	}

	private attachWebMidiListeners(): void {
		const webMidi = this.webMidi;
		if (!webMidi?.addListener) return;
		this.detachWebMidiListeners();
		for (const eventName of MIDI_EVENT_NAMES) {
			const handler = () => {
				if (eventName === 'disconnected') {
					this.stopTransportClock(false);
					this.panic();
				}
				this.refreshPorts();
			};
			webMidi.addListener(eventName, handler);
			this.webMidiHandlers.set(eventName, handler);
		}
	}

	private detachWebMidiListeners(): void {
		const webMidi = this.webMidi;
		if (webMidi?.removeListener) {
			for (const [eventName, handler] of this.webMidiHandlers) webMidi.removeListener(eventName, handler);
		}
		this.webMidiHandlers.clear();
	}

	private attachInputListeners(): void {
		for (const [index, input] of (this.webMidi?.inputs ?? []).entries()) {
			const id = portId(input, index);
			if (!input.addListener) continue;
			const handler = (event: unknown) => this.handleInputMessage(id, input, event);
			input.addListener('midimessage', handler);
			this.inputHandlers.set(id, { input, handler });
		}
	}

	private detachInputListeners(): void {
		for (const { input, handler } of this.inputHandlers.values()) input.removeListener?.('midimessage', handler);
		this.inputHandlers.clear();
	}

	private handleInputMessage(inputId: string, input: MidiInputLike, event: unknown): void {
		const value = typeof event === 'object' && event !== null ? event as Record<string, unknown> : {};
		const message = value.message && typeof value.message === 'object' ? value.message as Record<string, unknown> : undefined;
		const raw = value.data ?? value.rawData ?? message?.data ?? message?.dataBytes;
		const data = Array.isArray(raw) || raw instanceof Uint8Array ? Array.from(raw as ArrayLike<number>, (byte) => Number(byte) & 0xff) : [];
		if (!data.length) return;
		const classified = classifyMidiMessage(data);
		const timestampMs = normalizeMidiTimestamp(value.timestamp ?? value.timeStamp, this.now());
		const rawMessage: MidiRawMessage = {
			inputId,
			inputName: typeof input.name === 'string' ? input.name : inputId,
			timestampMs,
			data,
			...classified,
		};
		this.handleRawMessage(rawMessage, this.state.selectedInputId === inputId);
	}

	private handleRawMessage(rawMessage: MidiRawMessage, isSelectedInput: boolean): void {
		const classified = rawMessage;
		const activity: MidiActivity = {
			portId: rawMessage.inputId,
			portName: rawMessage.inputName,
			kind: classified.kind,
			...(classified.channel === undefined ? {} : { channel: classified.channel }),
			...(classified.data1 === undefined ? {} : { data1: classified.data1, note: classified.kind === 'noteon' || classified.kind === 'noteoff' ? classified.data1 : undefined }),
			...(classified.data2 === undefined ? {} : { data2: classified.data2, value: classified.kind === 'controlchange' ? classified.data2 / 127 : classified.data2 }),
			timestampMs: rawMessage.timestampMs,
		};
		const externalClockPatch = isSelectedInput
			? this.externalClockUpdate(classified.kind, rawMessage.timestampMs)
			: {};
		const acceptsInputChannel = rawMessage.inputId === COMPUTER_KEYBOARD_INPUT_ID || this.state.inputChannel === 'all' || this.state.inputChannel === classified.channel;
		if (isSelectedInput && (classified.kind === 'noteon' || classified.kind === 'noteoff') && classified.data1 !== undefined && classified.channel !== undefined && acceptsInputChannel) {
			try {
				this.liveInputHandler?.({
					inputId: rawMessage.inputId,
					inputName: rawMessage.inputName,
					note: Math.max(0, Math.min(127, Math.round(classified.data1))),
					velocity: Math.max(0, Math.min(1, (classified.data2 ?? 0) / 127)),
					channel: classified.channel,
					on: classified.kind === 'noteon',
					timestampMs: rawMessage.timestampMs,
				});
			} catch { /* live monitoring must not interrupt recording or MIDI state */ }
		}
		const learnedControl: Partial<MidiRuntimeState> = this.state.learning && classified.kind === 'controlchange' && classified.data1 !== undefined
			? { learning: false, learnedControl: { portId: rawMessage.inputId, portName: rawMessage.inputName, controller: classified.data1, value: (classified.data2 ?? 0) / 127, ...(classified.channel === undefined ? {} : { channel: classified.channel }), timestampMs: rawMessage.timestampMs } as MidiLearnedControl }
			: {};
		this.patchState({ lastActivity: activity, lastError: undefined, ...externalClockPatch, ...learnedControl });
		if (this.state.monitor && isSelectedInput && rawMessage.inputId !== COMPUTER_KEYBOARD_INPUT_ID) {
			const output = this.selectedOutput();
			if (output && portId(output, 0) !== rawMessage.inputId) {
				try { output.send?.(rawMessage.data); } catch (error) { this.patchState({ lastError: { code: 'MIDI_MONITOR_FAILED', message: errorMessage(error) } }); }
			}
		}
		if (this.recorder.isRecording) {
			this.recorder.addMessage(rawMessage, this.clock?.());
			const snapshot = this.recorder.snapshot(this.clock?.());
			this.patchState({ recording: { ...this.state.recording, currentCycle: snapshot.currentCycle, noteCount: snapshot.noteCount, automationCount: snapshot.automationCount, activeNoteCount: snapshot.activeNoteCount, take: this.recorder.snapshotTake(this.clock?.()) } });
		}
	}

	private externalClockUpdate(kind: MidiMessageKind, timestampMs: number): Partial<MidiRuntimeState> {
		if (this.state.clockMode !== 'receive') return kind === 'clock' ? { externalClockTicks: this.state.externalClockTicks + 1 } : {};
		if (kind === 'clock') {
			const previous = this.lastExternalClockMs;
			this.lastExternalClockMs = timestampMs;
			const tick = this.state.externalClockTicks + 1;
			if (previous !== undefined && timestampMs > previous) {
				const bpm = 60_000 / ((timestampMs - previous) * 24);
				const normalizedBpm = Number.isFinite(bpm) && bpm > 0 && bpm <= 999 ? Math.round(bpm * 100) / 100 : undefined;
				if (normalizedBpm !== undefined) {
					try { this.externalClockHandler?.({ action: 'clock', tick, bpm: normalizedBpm }); } catch { /* transport bridges are optional */ }
					return { externalClockTicks: tick, externalClockBpm: normalizedBpm };
				}
			}
			try { this.externalClockHandler?.({ action: 'clock', tick }); } catch { /* transport bridges are optional */ }
			return { externalClockTicks: tick };
		}
		if (kind === 'start' || kind === 'continue') {
			try { this.externalTransportHandler?.(kind); } catch { /* transport bridges are optional */ }
			try { this.externalClockHandler?.({ action: kind }); } catch { /* transport bridges are optional */ }
			return { externalClockRunning: true };
		}
		if (kind === 'stop') {
			this.lastExternalClockMs = undefined;
			try { this.externalTransportHandler?.('stop'); } catch { /* transport bridges are optional */ }
			try { this.externalClockHandler?.({ action: 'stop' }); } catch { /* transport bridges are optional */ }
			return { externalClockRunning: false, externalClockBpm: undefined };
		}
		return {};
	}

	private scheduleExternalClockWatch(): void {
		this.stopExternalClockWatch();
		this.externalClockWatchTimer = setInterval(() => {
			if (this.state.clockMode !== 'receive' || !this.state.externalClockRunning || this.lastExternalClockMs === undefined) return;
			const beatIntervalMs = this.state.externalClockBpm ? 60_000 / (this.state.externalClockBpm * 24) : 100;
			if (this.now() - this.lastExternalClockMs < Math.max(750, beatIntervalMs * 8)) return;
			this.lastExternalClockMs = undefined;
			try { this.externalTransportHandler?.('stop'); } catch { /* transport bridges are optional */ }
			try { this.externalClockHandler?.({ action: 'stop' }); } catch { /* transport bridges are optional */ }
			this.patchState({ externalClockRunning: false, externalClockBpm: undefined });
		}, 250);
	}

	private stopExternalClockWatch(): void {
		if (this.externalClockWatchTimer !== undefined) clearInterval(this.externalClockWatchTimer);
		this.externalClockWatchTimer = undefined;
	}

	private scheduleTransportClockTicks(): void {
		if (this.clockTimer !== undefined) clearInterval(this.clockTimer);
		const intervalMs = Math.max(1, 60_000 / (Math.max(1, this.tempoBpm) * 24));
		this.clockTimer = setInterval(() => {
			try { this.selectedOutput()?.send?.([0xf8]); } catch (error) { this.patchState({ lastError: { code: 'MIDI_CLOCK_FAILED', message: errorMessage(error) } }); }
		}, intervalMs);
	}

	private resolvePortId(idOrName: string, type: 'input' | 'output'): string | null {
		const ports = type === 'input' ? this.state.inputs : this.state.outputs;
		const byId = ports.find((port) => port.id === idOrName);
		if (byId) return byId.id;
		const byName = ports.filter((port) => port.name === idOrName);
		return byName.length === 1 ? byName[0].id : null;
	}

	private selectedOutput(): MidiOutputLike | undefined {
		const outputs = this.webMidi?.outputs ?? [];
		return outputs.find((output, index) => portId(output, index) === this.state.selectedOutputId);
	}

	private idleRecording(): MidiRuntimeState['recording'] {
		return { status: 'idle', trackId: null, inputId: null, startedAtCycle: null, currentCycle: null, noteCount: 0, automationCount: 0, activeNoteCount: 0, take: null, options: null };
	}

	private fail(code: string, message: string, permission: MidiRuntimeState['permission'] = this.state.permission): MidiRuntimeState {
		const lastError: MidiRuntimeError = { code, message };
		this.patchState({ lastError, permission });
		return this.getState();
	}

	private patchState(patch: Partial<MidiRuntimeState>): void {
		this.state = { ...this.state, ...patch, recording: patch.recording ? this.cloneRecording(patch.recording) : this.state.recording };
		const next = this.getState();
		for (const listener of this.listeners) {
			try { listener(next); } catch { /* one consumer must not break MIDI input */ }
		}
	}

	private cloneRecording(recording: MidiRuntimeState['recording']): MidiRuntimeState['recording'] {
		return {
			...recording,
			options: recording.options ? { ...recording.options } : null,
			take: recording.take ? {
				...recording.take,
				notes: recording.take.notes.map((note) => ({ ...note })),
				automation: recording.take.automation.map((event) => ({ ...event, data: [...event.data] })),
				options: { ...recording.take.options },
			} : null,
		};
	}

	private cloneState(state: MidiRuntimeState): MidiRuntimeState {
		return {
			...state,
			inputs: state.inputs.map((port) => ({ ...port })),
			outputs: state.outputs.map((port) => ({ ...port })),
			lastActivity: state.lastActivity ? { ...state.lastActivity } : undefined,
			learnedControl: state.learnedControl ? { ...state.learnedControl } : undefined,
			lastError: state.lastError ? { ...state.lastError } : undefined,
			recording: this.cloneRecording(state.recording),
		};
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
