import type {
	MidiClockSnapshot,
	MidiMessageKind,
	MidiRecordedAutomation,
	MidiRecordedNote,
	MidiRecordedTake,
	MidiRecordingOptions,
	MidiRawMessage,
} from './types';

const MIN_NOTE_CYCLES = 1 / 4096;

type OpenNote = MidiRecordedNote;

function finite(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function noteKey(channel: number, note: number): string {
	return `${channel}:${note}`;
}

/**
 * Pair raw MIDI note messages against a transport-anchored musical clock.
 * This class deliberately has no browser or WebMidi dependency, which makes
 * timing, note-off, and automation behavior testable without hardware.
 */
export class MidiRecorder {
	private options: MidiRecordingOptions | null = null;
	private inputId: string | null = null;
	private startedAtCycle = 0;
	private endedAtCycle = 0;
	private clockSegments: MidiClockSnapshot[] = [];
	private openNotes = new Map<string, OpenNote>();
	private notes: MidiRecordedNote[] = [];
	private automation: MidiRecordedAutomation[] = [];
	private rawMessageCount = 0;
	private nextNoteId = 1;

	public get isRecording(): boolean {
		return this.options !== null;
	}

	public get activeNoteCount(): number {
		return this.openNotes.size;
	}

	public start(options: MidiRecordingOptions, clock: MidiClockSnapshot, inputId: string | null = options.inputId ?? null): void {
		this.options = options;
		this.inputId = inputId;
		this.startedAtCycle = Math.max(0, finite(clock.cycle, 0));
		this.endedAtCycle = this.startedAtCycle;
		this.clockSegments = [{ ...clock, cycle: this.startedAtCycle }];
		this.openNotes.clear();
		this.notes = [];
		this.automation = [];
		this.rawMessageCount = 0;
		this.nextNoteId = 1;
	}

	public syncClock(clock: MidiClockSnapshot): void {
		if (!this.options || !Number.isFinite(clock.timestampMs)) return;
		const previous = this.clockSegments[this.clockSegments.length - 1];
		if (previous && clock.timestampMs <= previous.timestampMs + 0.01) return;
		const cycle = Math.max(previous?.cycle ?? this.startedAtCycle, finite(clock.cycle, previous?.cycle ?? this.startedAtCycle));
		const cyclesPerSecond = clock.cyclesPerSecond > 0 && Number.isFinite(clock.cyclesPerSecond)
			? clock.cyclesPerSecond
			: previous?.cyclesPerSecond ?? 1;
		this.clockSegments.push({ timestampMs: clock.timestampMs, cycle, cyclesPerSecond });
	}

	public addMessage(message: MidiRawMessage, clock?: MidiClockSnapshot): void {
		if (!this.options || (this.inputId !== null && message.inputId !== this.inputId)) return;
		if (clock) this.syncClock(clock);
		const cycle = this.cycleAt(message.timestampMs);
		this.endedAtCycle = Math.max(this.endedAtCycle, cycle);
		this.rawMessageCount += 1;

		if (message.kind === 'noteon' && message.channel !== undefined && message.data1 !== undefined) {
			if (!this.acceptsChannel(message.channel)) return;
			const note = clamp(Math.round(message.data1), 0, 127);
			const velocity = clamp((message.data2 ?? 0) / 127, 0, 1);
			const key = noteKey(message.channel, note);
			const existing = this.openNotes.get(key);
			if (existing) {
				existing.endCycle = Math.max(existing.startCycle + MIN_NOTE_CYCLES, cycle);
				this.notes.push(existing);
			}
			this.openNotes.set(key, {
				id: `midi-note-${this.nextNoteId++}`,
				note,
				velocity,
				channel: message.channel,
				startCycle: Math.max(this.startedAtCycle, cycle),
				endCycle: Math.max(this.startedAtCycle + MIN_NOTE_CYCLES, cycle + MIN_NOTE_CYCLES),
			});
			return;
		}

		if (message.kind === 'noteoff' && message.channel !== undefined && message.data1 !== undefined) {
			if (!this.acceptsChannel(message.channel)) return;
			const key = noteKey(message.channel, clamp(Math.round(message.data1), 0, 127));
			const open = this.openNotes.get(key);
			if (!open) return;
			open.endCycle = Math.max(open.startCycle + MIN_NOTE_CYCLES, cycle);
			this.notes.push(open);
			this.openNotes.delete(key);
			return;
		}

		if (message.channel !== undefined && !this.acceptsChannel(message.channel)) return;
		if (this.options.captureAutomation && message.kind !== 'clock' && message.kind !== 'activesensing') {
			this.automation.push({
				id: `midi-automation-${this.automation.length + 1}`,
				kind: message.kind as Exclude<MidiMessageKind, 'noteon' | 'noteoff'>,
				...(message.channel === undefined ? {} : { channel: message.channel }),
				...(message.data2 === undefined ? {} : { value: message.data2 / 127 }),
				data: [...message.data],
				cycle,
			});
		}
	}

	public snapshotTake(clock?: MidiClockSnapshot): MidiRecordedTake | null {
		if (!this.options) return null;
		if (clock) this.syncClock(clock);
		const endedAtCycle = Math.max(this.endedAtCycle, clock?.cycle ?? this.endedAtCycle);
		const notes = [
			...this.notes.map((note) => ({ ...note })),
			...Array.from(this.openNotes.values(), (note) => ({
				...note,
				endCycle: Math.max(note.startCycle + MIN_NOTE_CYCLES, endedAtCycle),
			})),
		];
		return {
			trackId: this.options.trackId,
			inputId: this.inputId,
			startedAtCycle: this.startedAtCycle,
			endedAtCycle,
			notes,
			automation: this.automation.map((event) => ({ ...event, data: [...event.data] })),
			rawMessageCount: this.rawMessageCount,
			options: { ...this.options },
		};
	}

	public stop(clock: MidiClockSnapshot): MidiRecordedTake {
		if (clock) this.syncClock(clock);
		const endCycle = Math.max(this.startedAtCycle + MIN_NOTE_CYCLES, finite(clock.cycle, this.endedAtCycle));
		for (const note of this.openNotes.values()) {
			note.endCycle = Math.max(note.startCycle + MIN_NOTE_CYCLES, endCycle);
			this.notes.push(note);
		}
		this.openNotes.clear();
		this.endedAtCycle = endCycle;
		const options = this.options ?? {
			trackId: '', inputId: this.inputId ?? undefined, channel: 'all', mode: 'replace', quantize: 'off',
			quantizeStrength: 1, swing: 0, countInBars: 0, loop: false, captureAutomation: false,
		};
		const take: MidiRecordedTake = {
			trackId: options.trackId,
			inputId: this.inputId,
			startedAtCycle: this.startedAtCycle,
			endedAtCycle: endCycle,
			notes: this.notes.map((note) => ({ ...note })),
			automation: this.automation.map((event) => ({ ...event, data: [...event.data] })),
			rawMessageCount: this.rawMessageCount,
			options: { ...options },
		};
		this.options = null;
		return take;
	}

	public cancel(): void {
		this.options = null;
		this.inputId = null;
		this.clockSegments = [];
		this.openNotes.clear();
		this.notes = [];
		this.automation = [];
		this.rawMessageCount = 0;
	}

	public snapshot(clock?: MidiClockSnapshot): { startedAtCycle: number; currentCycle: number; noteCount: number; automationCount: number; activeNoteCount: number } {
		if (clock) this.syncClock(clock);
		return {
			startedAtCycle: this.startedAtCycle,
			currentCycle: Math.max(this.endedAtCycle, clock?.cycle ?? this.endedAtCycle),
			noteCount: this.notes.length + this.openNotes.size,
			automationCount: this.automation.length,
			activeNoteCount: this.openNotes.size,
		};
	}

	private acceptsChannel(channel: number): boolean {
		return this.options?.channel === 'all' || this.options?.channel === channel;
	}

	private cycleAt(timestampMs: number): number {
		const timestamp = finite(timestampMs, this.clockSegments[0]?.timestampMs ?? 0);
		let segment = this.clockSegments[0];
		for (const candidate of this.clockSegments) {
			if (candidate.timestampMs <= timestamp) segment = candidate;
			else break;
		}
		const deltaSeconds = Math.max(0, timestamp - segment.timestampMs) / 1000;
		return Math.max(this.startedAtCycle, segment.cycle + deltaSeconds * Math.max(0, segment.cyclesPerSecond));
	}
}

export function classifyMidiMessage(data: readonly number[]): { kind: MidiMessageKind; channel?: number; data1?: number; data2?: number } {
	const status = Number(data[0]) & 0xff;
	const command = status >> 4;
	const channel = (status & 0x0f) + 1;
	const data1 = data[1];
	const data2 = data[2];
	if (command === 8) return { kind: 'noteoff', channel, data1, data2 };
	if (command === 9) return { kind: data2 === 0 ? 'noteoff' : 'noteon', channel, data1, data2 };
	if (command === 10) return { kind: 'keyaftertouch', channel, data1, data2 };
	if (command === 11) return { kind: 'controlchange', channel, data1, data2 };
	if (command === 12) return { kind: 'programchange', channel, data1 };
	if (command === 13) return { kind: 'channelaftertouch', channel, data1 };
	if (command === 14) return { kind: 'pitchbend', channel, data1, data2 };
	switch (status) {
		case 0xf1: return { kind: 'timecode', data1, data2 };
		case 0xf2: return { kind: 'songposition', data1, data2 };
		case 0xf3: return { kind: 'songselect', data1, data2 };
		case 0xf6: return { kind: 'tunerequest' };
		case 0xf8: return { kind: 'clock' };
		case 0xfa: return { kind: 'start' };
		case 0xfb: return { kind: 'continue' };
		case 0xfc: return { kind: 'stop' };
		case 0xfe: return { kind: 'activesensing' };
		case 0xff: return { kind: 'reset' };
		case 0xf0: return { kind: 'sysex', data1, data2 };
		default: return { kind: 'unknown', data1, data2 };
	}
}

/** Convert DOMHighResTimeStamp/Event.timeStamp variants to performance.now space. */
export function normalizeMidiTimestamp(value: unknown, now = typeof performance !== 'undefined' ? performance.now() : Date.now()): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return now;
	if (value > 1_000_000_000 && typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)) return value - performance.timeOrigin;
	return Math.max(0, value);
}
