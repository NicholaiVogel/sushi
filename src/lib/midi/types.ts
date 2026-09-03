export type MidiPortType = 'input' | 'output';
export type MidiPortConnection = 'open' | 'closed' | 'pending' | 'unknown';
export type MidiPortState = 'connected' | 'disconnected' | 'unknown';
export type MidiChannel = number | 'all';
export type MidiPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported' | 'error';
export type MidiRecordingStatus = 'idle' | 'armed' | 'count-in' | 'recording' | 'stopping' | 'review' | 'error';
export type MidiRecordMode = 'replace' | 'overdub';
export type MidiClockMode = 'off' | 'send' | 'receive';
export type MidiQuantizeGrid = 'off' | '1/4' | '1/8' | '1/16' | '1/32' | '1/8T' | '1/16T' | '1/32T';
export type MidiMessageKind =
	| 'noteon'
	| 'noteoff'
	| 'controlchange'
	| 'pitchbend'
	| 'channelaftertouch'
	| 'keyaftertouch'
	| 'programchange'
	| 'sysex'
	| 'clock'
	| 'start'
	| 'continue'
	| 'stop'
	| 'songposition'
	| 'songselect'
	| 'timecode'
	| 'tunerequest'
	| 'activesensing'
	| 'reset'
	| 'unknown';

export interface MidiPortSummary {
	id: string;
	name: string;
	manufacturer?: string;
	type: MidiPortType;
	state: MidiPortState;
	connection: MidiPortConnection;
}

export interface MidiLearnedControl {
	portId: string;
	portName: string;
	controller: number;
	value: number;
	channel?: number;
	timestampMs: number;
}

export interface MidiLiveNote {
	inputId: string;
	inputName: string;
	note: number;
	velocity: number;
	channel: number;
	on: boolean;
	timestampMs: number;
}

export interface MidiActivity {
	portId: string;
	portName: string;
	kind: MidiMessageKind;
	channel?: number;
	note?: number;
	/** First and second MIDI data bytes for CC/pitch/aftertouch inspection. */
	data1?: number;
	data2?: number;
	value?: number;
	timestampMs: number;
}

export interface MidiRuntimeError {
	code: string;
	message: string;
}

export interface MidiRuntimeState {
	supported: boolean;
	secureContext: boolean;
	permission: MidiPermissionState;
	enabled: boolean;
	sysexEnabled: boolean;
	inputs: MidiPortSummary[];
	outputs: MidiPortSummary[];
	selectedInputId: string | null;
	selectedOutputId: string | null;
	inputChannel: MidiChannel;
	outputChannel: number;
	monitor: boolean;
	clockMode: MidiClockMode;
	clockRunning: boolean;
	externalClockTicks: number;
	externalClockRunning: boolean;
	externalClockBpm?: number;
	recording: MidiRecordingState;
	lastActivity?: MidiActivity;
	learning: boolean;
	learnedControl?: MidiLearnedControl;
	lastError?: MidiRuntimeError;
}

export interface MidiRecordingOptions {
	trackId: string;
	inputId?: string;
	channel: MidiChannel;
	mode: MidiRecordMode;
	quantize: MidiQuantizeGrid;
	quantizeStrength: number;
	swing: number;
	countInBars: 0 | 1 | 2;
	loop: boolean;
	/** Optional source range used for automatic loop-record stop. */
	loopStartCycle?: number;
	loopEndCycle?: number;
	captureAutomation: boolean;
}

export interface MidiClockSnapshot {
	cycle: number;
	timestampMs: number;
	cyclesPerSecond: number;
}

export interface MidiExternalClockUpdate {
	action: 'clock' | 'start' | 'continue' | 'stop';
	tick?: number;
	bpm?: number;
}

export interface MidiRawMessage {
	inputId: string;
	inputName: string;
	timestampMs: number;
	data: number[];
	kind: MidiMessageKind;
	channel?: number;
	data1?: number;
	data2?: number;
}

export interface MidiRecordedNote {
	id: string;
	note: number;
	velocity: number;
	channel: number;
	startCycle: number;
	endCycle: number;
}

export interface MidiRecordedAutomation {
	id: string;
	kind: Exclude<MidiMessageKind, 'noteon' | 'noteoff'>;
	channel?: number;
	value?: number;
	data: number[];
	cycle: number;
}

export interface MidiRecordingState {
	status: MidiRecordingStatus;
	trackId: string | null;
	inputId: string | null;
	startedAtCycle: number | null;
	currentCycle: number | null;
	noteCount: number;
	automationCount: number;
	activeNoteCount: number;
	take: MidiRecordedTake | null;
	options: MidiRecordingOptions | null;
}

export interface MidiRecordedTake {
	/** True when an agent-facing snapshot intentionally omitted tail events. */
	truncated?: boolean;
	trackId: string;
	inputId: string | null;
	startedAtCycle: number;
	endedAtCycle: number;
	notes: MidiRecordedNote[];
	automation: MidiRecordedAutomation[];
	rawMessageCount: number;
	options: MidiRecordingOptions;
}

export interface MidiServiceSnapshot {
	state: MidiRuntimeState;
	midiModuleLoaded: boolean;
}

export interface MidiServiceListener {
	(state: MidiRuntimeState): void;
}

export type MidiLiveInputHandler = (event: MidiLiveNote) => void;

export interface MidiClock {
	(): MidiClockSnapshot;
}

export const MIDI_CHANNELS: readonly number[] = Array.from({ length: 16 }, (_, index) => index + 1);
export const MIDI_QUANTIZE_GRIDS: readonly MidiQuantizeGrid[] = ['off', '1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T', '1/32T'];

export function isMidiChannel(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 16;
}

export function normalizeMidiChannel(value: unknown, fallback: MidiChannel = 'all'): MidiChannel {
	return value === 'all' || isMidiChannel(value) ? value : fallback;
}

export function normalizeMidiQuantizeGrid(value: unknown, fallback: MidiQuantizeGrid = '1/16'): MidiQuantizeGrid {
	return typeof value === 'string' && (MIDI_QUANTIZE_GRIDS as readonly string[]).includes(value) ? value as MidiQuantizeGrid : fallback;
}
