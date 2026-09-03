import { describe, expect, test } from 'bun:test';
import { COMPUTER_KEYBOARD_INPUT_ID, MidiService } from './service';
import type { MidiModuleLoader } from './service';

function fakeMidi() {
	const inputListeners = new Map<string, (event: unknown) => void>();
	const outputMessages: number[][] = [];
	const webMidiListeners = new Map<string, (event: unknown) => void>();
	const input = {
		id: 'input-1', name: 'Test Keyboard', manufacturer: 'Sushi', type: 'input', state: 'connected', connection: 'open',
		addListener: (event: string, callback: (value: unknown) => void) => inputListeners.set(event, callback),
		removeListener: (event?: string) => { if (event) inputListeners.delete(event); },
	};
	const output = {
		id: 'output-1', name: 'Test Synth', manufacturer: 'Sushi', type: 'output', state: 'connected', connection: 'open',
		send: (data: number[]) => outputMessages.push([...data]),
		playNote: (note: number | string, options?: Record<string, unknown>) => outputMessages.push([Number(note), Number(options?.attack ?? 0), Number(options?.duration ?? 0)]),
		sendAllNotesOff: () => outputMessages.push([0xb0, 123, 0]),
		sendAllSoundOff: () => outputMessages.push([0xb0, 120, 0]),
		sendResetAllControllers: () => outputMessages.push([0xb0, 121, 0]),
		sendStop: () => outputMessages.push([0xfc]),
	};
	let enabled = false;
	const webMidi = {
		get enabled() { return enabled; },
		sysexEnabled: false,
		inputs: [input],
		outputs: [output],
		enable: async () => { enabled = true; },
		disable: async () => { enabled = false; },
		addListener: (event: string, callback: (value: unknown) => void) => webMidiListeners.set(event, callback),
		removeListener: (event?: string) => { if (event) webMidiListeners.delete(event); },
	};
	const loader: MidiModuleLoader = async () => ({ WebMidi: webMidi });
	return { loader, inputListeners, outputMessages, webMidiListeners, webMidi };
}

describe('MidiService', () => {
	test('connects, enumerates ports, records notes, and sends panic/test output', async () => {
		const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
		const previousSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
		Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { requestMIDIAccess: () => Promise.resolve() } });
		Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
		const fake = fakeMidi();
		const service = new MidiService({ loadModule: fake.loader, now: () => 1_000 });
		try {
			const connected = await service.connect();
			expect(connected.enabled).toBe(true);
			expect(connected.inputs[0].name).toBe('Test Keyboard');
			expect(connected.outputs[0].name).toBe('Test Synth');
			expect(service.setSelectedInput('Test Keyboard').selectedInputId).toBe('input-1');
			expect(service.setSelectedOutput('Test Synth').selectedOutputId).toBe('output-1');
			const liveEvents: Array<{ note: number; velocity: number; on: boolean; channel: number }> = [];
			service.setLiveInputHandler((event) => liveEvents.push({ note: event.note, velocity: event.velocity, on: event.on, channel: event.channel }));
			fake.inputListeners.get('midimessage')?.({ message: { dataBytes: [0x90, 61, 96] }, timestamp: 850 });
			fake.inputListeners.get('midimessage')?.({ data: [0x80, 61, 64], timestamp: 900 });
			expect(liveEvents).toEqual([{ note: 61, velocity: 96 / 127, on: true, channel: 1 }, { note: 61, velocity: 64 / 127, on: false, channel: 1 }]);
			expect(service.getState().lastActivity?.note).toBe(61);
			const externalClockUpdates: Array<{ action: string; bpm?: number }> = [];
			service.setExternalClockHandler((update) => externalClockUpdates.push({ action: update.action, bpm: update.bpm }));
			service.setClockMode('receive');
			fake.inputListeners.get('midimessage')?.({ data: [0xfa], timestamp: 900 });
			fake.inputListeners.get('midimessage')?.({ data: [0xf8], timestamp: 1_000 });
			expect(service.getState().externalClockTicks).toBe(1);
			expect(service.getState().externalClockRunning).toBe(true);
			expect(service.getState().externalClockBpm).toBeUndefined();
			fake.inputListeners.get('midimessage')?.({ data: [0xf8], timestamp: 1_100 });
			expect(service.getState().externalClockTicks).toBe(2);
			expect(service.getState().externalClockBpm).toBe(25);
			fake.inputListeners.get('midimessage')?.({ data: [0xfc], timestamp: 1_200 });
			expect(externalClockUpdates).toEqual([{ action: 'start' }, { action: 'clock' }, { action: 'clock', bpm: 25 }, { action: 'stop' }]);
			service.armRecording({ trackId: 'track', countInBars: 0 });
			service.startRecording({ options: service.getState().recording.options!, clock: { cycle: 0, timestampMs: 1_000, cyclesPerSecond: 2 } });
			fake.inputListeners.get('midimessage')?.({ data: [0x90, 60, 100], timestamp: 1_000 });
			fake.inputListeners.get('midimessage')?.({ data: [0x80, 60, 64], timestamp: 1_500 });
			const take = service.stopRecording({ cycle: 1, timestampMs: 1_500, cyclesPerSecond: 2 });
			expect(take?.notes).toHaveLength(1);
			expect(take?.notes[0].endCycle).toBe(1);
			let loopCycle = 0;
			service.setClock(() => ({ cycle: loopCycle, timestampMs: 2_000 + loopCycle * 500, cyclesPerSecond: 2 }));
			service.armRecording({ trackId: 'track', countInBars: 0, loop: true, loopEndCycle: 1 });
			service.startRecording({ options: service.getState().recording.options!, clock: { cycle: 0, timestampMs: 2_000, cyclesPerSecond: 2 } });
			loopCycle = 1;
			service.update();
			expect(service.getState().recording.status).toBe('review');
			await service.testNote(60, 40, 0.5);
			service.setTempo(120);
			service.setClockMode('send');
			service.startTransportClock();
			service.stopTransportClock();
			service.panic();
			expect(fake.outputMessages.some((message) => message[0] === 60)).toBe(true);
			expect(fake.outputMessages.some((message) => message[0] === 0xfa)).toBe(true);
			expect(fake.outputMessages.some((message) => message[0] === 0xfc)).toBe(true);
			expect(fake.outputMessages.some((message) => message[1] === 123)).toBe(true);
			const disconnected = await service.disconnect();
			expect(disconnected.recording.status).toBe('review');
			expect(disconnected.recording.take).not.toBeNull();
		} finally {
			service.destroy();
			if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
			else Reflect.deleteProperty(globalThis, 'navigator');
			if (previousSecureContext) Object.defineProperty(globalThis, 'isSecureContext', previousSecureContext);
			else Reflect.deleteProperty(globalThis, 'isSecureContext');
		}
	});

	test('plays and records the computer keyboard without Web MIDI permission', () => {
		const service = new MidiService({ now: () => 1_000 });
		const liveEvents: Array<{ note: number; velocity: number; on: boolean; inputId: string }> = [];
		service.setClock(() => ({ cycle: 0, timestampMs: 1_000, cyclesPerSecond: 2 }));
		service.setLiveInputHandler((event) => liveEvents.push({ note: event.note, velocity: event.velocity, on: event.on, inputId: event.inputId }));
		try {
			const armed = service.armRecording({ trackId: 'keyboard-track', inputId: COMPUTER_KEYBOARD_INPUT_ID, countInBars: 0 });
			expect(armed.recording.status).toBe('armed');
			service.startRecording({ options: armed.recording.options!, clock: { cycle: 0, timestampMs: 1_000, cyclesPerSecond: 2 } });
			service.ingestKeyboardNote(60, 0.8, true, 1_000);
			service.ingestKeyboardNote(60, 0, false, 1_250);
			const take = service.stopRecording({ cycle: 0.5, timestampMs: 1_250, cyclesPerSecond: 2 });
			expect(liveEvents).toEqual([
				{ note: 60, velocity: Math.round(0.8 * 127) / 127, on: true, inputId: COMPUTER_KEYBOARD_INPUT_ID },
				{ note: 60, velocity: 0, on: false, inputId: COMPUTER_KEYBOARD_INPUT_ID },
			]);
			expect(take?.notes).toHaveLength(1);
			expect(take?.notes[0].note).toBe(60);
			expect(take?.notes[0].endCycle).toBe(0.5);
		} finally {
			service.destroy();
		}
	});

	test('panic and device disconnect never emit MIDI transport stop', async () => {
		const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
		const previousSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
		Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { requestMIDIAccess: () => Promise.resolve() } });
		Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
		const fake = fakeMidi();
		const service = new MidiService({ loadModule: fake.loader, now: () => 1_000 });
		try {
			await service.connect();
			service.setSelectedOutput('Test Synth');
			service.setClockMode('send');
			service.startTransportClock();
			fake.outputMessages.length = 0;
			service.panic();
			expect(fake.outputMessages.some((message) => message[0] === 0xfc)).toBe(false);

			service.startTransportClock();
			fake.outputMessages.length = 0;
			await service.disconnect();
			expect(fake.outputMessages.some((message) => message[0] === 0xfc)).toBe(false);

			await service.connect();
			service.setSelectedOutput('Test Synth');
			service.setClockMode('send');
			service.startTransportClock();
			fake.outputMessages.length = 0;
			fake.webMidiListeners.get('disconnected')?.({});
			expect(fake.outputMessages.some((message) => message[0] === 0xfc)).toBe(false);
			expect(service.getState().clockRunning).toBe(false);
		} finally {
			service.destroy();
			if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
			else Reflect.deleteProperty(globalThis, 'navigator');
			if (previousSecureContext) Object.defineProperty(globalThis, 'isSecureContext', previousSecureContext);
			else Reflect.deleteProperty(globalThis, 'isSecureContext');
		}
	});
});
