/// <reference types="webmcp-types" />

import { describe, expect, test } from 'bun:test';
import {
	WEBMCP_TOOL_NAMES,
	applyTextEdits,
	createWebMcpTools,
	registerWebMcpTools,
	sourceDiff,
	getNativeModelContext,
	waitForNativeModelContext,
	type WebMcpController,
	type WebMcpStateSnapshot,
} from './tools';

const state: WebMcpStateSnapshot = {
	project: { id: 'prj_test', name: 'Test project' },
	source: { draft: 'alpha', lastValid: 'alpha', revision: 0, activeRevision: 0 },
	timeline: { bpm: 84, quarterNotesPerCycle: 4, key: 'E:minor', songEndCycle: 4 },
	tracks: [{
		id: 'trk_test',
		number: 1,
		name: 'Test',
		type: 'synth',
		line: 1,
		timing: { mode: 'full', startCycle: 0, endCycle: 4 },
		gain: { value: 0.5, editable: true },
		pan: { value: 0.5, editable: true },
		muted: false,
		soloed: false,
	}],
	diagnostics: [],
	runtime: { audioState: 'locked', transport: 'stopped', activeRevision: 0, currentCycle: 0 },
	phase: 'ready',
	persistenceState: 'ready',
	webmcp: { available: true },
	midi: {
		supported: false,
		secureContext: true,
		permission: 'unsupported',
		enabled: false,
		sysexEnabled: false,
		inputs: [],
		outputs: [],
		selectedInputId: null,
		selectedOutputId: null,
		inputChannel: 'all',
		outputChannel: 1,
		monitor: false,
		clockMode: 'off',
		clockRunning: false,
		externalClockTicks: 0,
		externalClockRunning: false,
		learning: false,
		recording: { status: 'idle', trackId: null, inputId: null, startedAtCycle: null, currentCycle: null, noteCount: 0, automationCount: 0, activeNoteCount: 0, take: null, options: null },
	},
};

function testController(): WebMcpController {
		const midi = {
			getState: () => state.midi,
			connect: async () => state.midi,
			disconnect: async () => state.midi,
			selectInput: () => state.midi,
			selectOutput: () => state.midi,
			setSettings: () => state.midi,
			learnControl: () => ({ ...state.midi, learning: true }),
			armRecording: () => ({ ...state.midi, recording: { ...state.midi.recording, status: 'armed' as const, trackId: 'trk_test', inputId: 'input', options: null } }),
			startRecording: async () => ({ ...state.midi, recording: { ...state.midi.recording, status: 'recording' as const, trackId: 'trk_test', inputId: 'input' } }),
			stopRecording: async () => ({ ...state.midi, recording: { ...state.midi.recording, status: 'review' as const, trackId: 'trk_test', inputId: 'input' } }),
			cancelRecording: () => state.midi,
			acceptTake: async (input: { transactionId: string }) => ({ ok: true, action: 'accept_midi_take', affectedEntityIds: ['source', 'midi'], message: 'accepted', state, revision: 1, activeRevision: 1, transactionId: input.transactionId }),
			panic: () => state.midi,
			testNote: async () => state.midi,
		};
	return {
		getState: () => state,
		loadTemplate: async (input) => ({ ok: true, action: 'load_editor_template', affectedEntityIds: ['source', 'project', 'timeline'], message: 'template loaded', state, revision: 1, activeRevision: 1, transactionId: input.transactionId }),
		writeSource: async () => ({ ok: true, action: 'write_strudel_source', affectedEntityIds: ['source'], message: 'accepted', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		patchSource: async () => ({ ok: true, action: 'patch_strudel_source', affectedEntityIds: ['source'], message: 'accepted', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		setTempo: async () => ({ ok: true, action: 'set_tempo', affectedEntityIds: ['source'], message: 'tempo set', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		setKey: async () => ({ ok: true, action: 'set_key', affectedEntityIds: ['source'], message: 'key set', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		deleteTrack: async () => ({ ok: true, action: 'delete_track', affectedEntityIds: ['source', 'trk_test'], message: 'deleted', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		renameTrack: async () => ({ ok: true, action: 'rename_track', affectedEntityIds: ['source', 'trk_test'], message: 'renamed', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		setTrackRange: async () => ({ ok: true, action: 'set_track_range', affectedEntityIds: ['source', 'trk_test'], message: 'ranged', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		extendTimeline: async () => ({ ok: true, action: 'extend_timeline', affectedEntityIds: ['timeline'], message: 'extended', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		validateSource: async (source) => ({ ok: true, action: 'validate_strudel_source', source: source ?? state.source.draft, diagnostics: [], message: 'valid', revision: state.source.revision, state }),
		controlPlayback: async ({ action }) => ({ ok: true, action: `control_playback:${action}`, affectedEntityIds: ['transport'], message: 'done', state, revision: state.source.revision, activeRevision: state.source.activeRevision }),
		undoSourceEdit: async () => ({ ok: true, action: 'undo_source_edit', affectedEntityIds: ['source'], message: 'undone', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		redoSourceEdit: async () => ({ ok: true, action: 'redo_source_edit', affectedEntityIds: ['source'], message: 'redone', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		setTrackMidiRoute: async (input) => ({ ok: true, action: 'set_track_midi_route', affectedEntityIds: ['source', input.trackId ?? 'trk_test'], message: 'routed', state, revision: 1, activeRevision: 1, transactionId: input.transactionId }),
		midi,
	};
}

describe('WebMCP tool adapter', () => {
	test('accepts an explicitly supplied native model context', () => {
		const context = { registerTool: async () => undefined } as unknown as WebMCP.ModelContext;
		expect(getNativeModelContext(context)).toBe(context);
	});

	test('finds a model context exposed by an embedded browser host', () => {
		const host = globalThis as typeof globalThis & { modelContext?: WebMCP.ModelContext };
		const previous = host.modelContext;
		const context = { registerTool: async () => undefined } as unknown as WebMCP.ModelContext;
		Object.defineProperty(host, 'modelContext', { configurable: true, value: context });
		try {
			expect(getNativeModelContext()).toBe(context);
		} finally {
			if (previous === undefined) Reflect.deleteProperty(host, 'modelContext');
			else Object.defineProperty(host, 'modelContext', { configurable: true, value: previous });
		}
	});

	test('skips an unusable document context and keeps probing fallbacks', () => {
		const host = globalThis as typeof globalThis & {
			document?: { modelContext?: WebMCP.ModelContext };
			modelContext?: WebMCP.ModelContext;
		};
		const previousDocument = Object.getOwnPropertyDescriptor(host, 'document');
		const previousContext = Object.getOwnPropertyDescriptor(host, 'modelContext');
		const context = { registerTool: async () => undefined } as unknown as WebMCP.ModelContext;
		Object.defineProperty(host, 'document', { configurable: true, value: { modelContext: {} } });
		Object.defineProperty(host, 'modelContext', { configurable: true, value: context });
		try {
			expect(getNativeModelContext()).toBe(context);
		} finally {
			if (previousDocument) Object.defineProperty(host, 'document', previousDocument);
			else Reflect.deleteProperty(host, 'document');
			if (previousContext) Object.defineProperty(host, 'modelContext', previousContext);
			else Reflect.deleteProperty(host, 'modelContext');
		}
	});

	test('prefers the canonical document model context over legacy host fallbacks', () => {
		const host = globalThis as typeof globalThis & {
			document?: { modelContext?: WebMCP.ModelContext };
			modelContext?: WebMCP.ModelContext;
		};
		const previousDocument = Object.getOwnPropertyDescriptor(host, 'document');
		const previousContext = Object.getOwnPropertyDescriptor(host, 'modelContext');
		const canonical = { registerTool: async () => undefined } as unknown as WebMCP.ModelContext;
		const legacy = { registerTool: async () => undefined } as unknown as WebMCP.ModelContext;
		Object.defineProperty(host, 'document', { configurable: true, value: { modelContext: canonical } });
		Object.defineProperty(host, 'modelContext', { configurable: true, value: legacy });
		try {
			expect(getNativeModelContext()).toBe(canonical);
		} finally {
			if (previousDocument) Object.defineProperty(host, 'document', previousDocument);
			else Reflect.deleteProperty(host, 'document');
			if (previousContext) Object.defineProperty(host, 'modelContext', previousContext);
			else Reflect.deleteProperty(host, 'modelContext');
		}
	});

	test('ignores a host model-context getter that throws', () => {
		const host = globalThis as typeof globalThis & { modelContext?: WebMCP.ModelContext };
		const previous = Object.getOwnPropertyDescriptor(host, 'modelContext');
		Object.defineProperty(host, 'modelContext', { configurable: true, get: () => { throw new Error('not ready'); } });
		try {
			expect(getNativeModelContext()).toBeUndefined();
		} finally {
			if (previous) Object.defineProperty(host, 'modelContext', previous);
			else Reflect.deleteProperty(host, 'modelContext');
		}
	});

	test('waits for a model context installed after hydration', async () => {
		const host = globalThis as typeof globalThis & { modelContext?: WebMCP.ModelContext };
		const previous = host.modelContext;
		const context = { registerTool: async () => undefined } as unknown as WebMCP.ModelContext;
		if (previous !== undefined) Reflect.deleteProperty(host, 'modelContext');
		const installTimer = setTimeout(() => {
			Object.defineProperty(host, 'modelContext', { configurable: true, value: context });
		}, 5);
		try {
			expect(await waitForNativeModelContext({ timeoutMs: 100, pollIntervalMs: 1 })).toBe(context);
		} finally {
			clearTimeout(installTimer);
			if (previous === undefined) Reflect.deleteProperty(host, 'modelContext');
			else Object.defineProperty(host, 'modelContext', { configurable: true, value: previous });
		}
	});

	test('cancels a late-context wait when its owner is disposed', async () => {
		const host = globalThis as typeof globalThis & { modelContext?: WebMCP.ModelContext };
		const previous = Object.getOwnPropertyDescriptor(host, 'modelContext');
		const ownerController = new AbortController();
		if (previous) Reflect.deleteProperty(host, 'modelContext');
		try {
			const contextPromise = waitForNativeModelContext({ timeoutMs: 1_000, pollIntervalMs: 10, signal: ownerController.signal });
			ownerController.abort();
			expect(await contextPromise).toBeUndefined();
		} finally {
			if (previous) Object.defineProperty(host, 'modelContext', previous);
		}
	});

	test('does not probe the host when a context wait is already aborted', async () => {
		const host = globalThis as typeof globalThis & { modelContext?: WebMCP.ModelContext };
		const previous = Object.getOwnPropertyDescriptor(host, 'modelContext');
		const ownerController = new AbortController();
		let reads = 0;
		Object.defineProperty(host, 'modelContext', {
			configurable: true,
			get: () => {
				reads += 1;
				return undefined;
			},
		});
		ownerController.abort();
		try {
			expect(await waitForNativeModelContext({ signal: ownerController.signal })).toBeUndefined();
			expect(reads).toBe(0);
		} finally {
			if (previous) Object.defineProperty(host, 'modelContext', previous);
			else Reflect.deleteProperty(host, 'modelContext');
		}
	});

	test('exposes the contract tools and revision-aware schemas', () => {
		const tools = createWebMcpTools(testController());
		expect(tools.map((tool) => tool.name)).toEqual([...WEBMCP_TOOL_NAMES]);
		const sourceReaders = tools.filter((tool) => ['open_studio_session', 'inspect_strudel_state', 'read_strudel_source', 'validate_strudel_source', 'view_editor_template'].includes(tool.name));
		expect(sourceReaders.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.untrustedContentHint === true)).toBe(true);
		const sourceWriters = tools.filter((tool) => ['write_strudel_source', 'patch_strudel_source', 'load_editor_template', 'control_playback', 'undo_source_edit', 'redo_source_edit'].includes(tool.name));
		expect(sourceWriters.every((tool) => tool.annotations?.readOnlyHint === false && tool.annotations?.untrustedContentHint === true)).toBe(true);
		expect(tools.find((tool) => tool.name === 'lookup_strudel_reference')?.annotations).toEqual({ readOnlyHint: true });
		expect(tools.find((tool) => tool.name === 'list_editor_templates')?.annotations).toEqual({ readOnlyHint: true });
		const write = tools.find((tool) => tool.name === 'write_strudel_source');
		expect(write?.inputSchema).toMatchObject({ required: ['source', 'baseRevision', 'transactionId'] });
		const patch = tools.find((tool) => tool.name === 'patch_strudel_source');
		expect(patch?.inputSchema).toMatchObject({ required: ['edits', 'baseRevision', 'transactionId'] });
		const tempo = tools.find((tool) => tool.name === 'set_tempo');
		expect(tempo?.inputSchema).toMatchObject({ required: ['bpm', 'baseRevision', 'transactionId'] });
		const key = tools.find((tool) => tool.name === 'set_key');
		expect(key?.inputSchema).toMatchObject({ required: ['key', 'baseRevision', 'transactionId'] });
		const deleteTool = tools.find((tool) => tool.name === 'delete_track');
		expect(deleteTool?.inputSchema).toMatchObject({ required: ['baseRevision', 'transactionId'] });
		const renameTool = tools.find((tool) => tool.name === 'rename_track');
		expect(renameTool?.inputSchema).toMatchObject({ required: ['newName', 'baseRevision', 'transactionId'] });
		const rangeTool = tools.find((tool) => tool.name === 'set_track_range');
		expect(rangeTool?.inputSchema).toMatchObject({ required: ['startCycle', 'endCycle', 'baseRevision', 'transactionId'] });
		const extendTool = tools.find((tool) => tool.name === 'extend_timeline');
		expect(extendTool?.inputSchema).toMatchObject({ required: ['baseRevision', 'transactionId'] });
		const listTemplates = tools.find((tool) => tool.name === 'list_editor_templates');
		expect(listTemplates?.inputSchema).toMatchObject({ properties: { query: { type: 'string' }, limit: { type: 'integer' } } });
		const viewTemplate = tools.find((tool) => tool.name === 'view_editor_template');
		expect(viewTemplate?.inputSchema).toMatchObject({ required: ['templateId'] });
		const loadTemplate = tools.find((tool) => tool.name === 'load_editor_template');
		expect(loadTemplate?.inputSchema).toMatchObject({ required: ['templateId', 'baseRevision', 'transactionId'] });
		const midiRoute = tools.find((tool) => tool.name === 'set_track_midi_route');
		expect(midiRoute?.inputSchema).toMatchObject({ properties: { velocity: { oneOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] }, program: { oneOf: [{ type: 'integer', minimum: 0, maximum: 127 }, { type: 'null' }] } } });
	});

	test('exposes MIDI state and dispatches guarded MIDI actions', async () => {
		const tools = createWebMcpTools(testController());
		const capabilities = tools.find((tool) => tool.name === 'get_midi_capabilities');
		const access = tools.find((tool) => tool.name === 'request_midi_access');
		const arm = tools.find((tool) => tool.name === 'arm_midi_recording');
		const route = tools.find((tool) => tool.name === 'set_track_midi_route');
		expect((await capabilities?.execute({}, { signal: new AbortController().signal }) as { capabilities: { supported: boolean } }).capabilities.supported).toBe(false);
		expect((await access?.execute({ sysex: false }, { signal: new AbortController().signal }) as { ok: boolean }).ok).toBe(true);
		expect((await arm?.execute({ trackId: 'trk_test' }, { signal: new AbortController().signal }) as { ok: boolean }).ok).toBe(true);
		expect((await route?.execute({ trackId: 'trk_test', channel: 2, enabled: true, baseRevision: 0, transactionId: 'midi-route-test' }, { signal: new AbortController().signal }) as { ok: boolean }).ok).toBe(true);
	});

	test('omits MIDI tools when the studio composition has no MIDI controller', () => {
		const controller = testController();
		delete controller.midi;
		delete controller.setTrackMidiRoute;

		const tools = createWebMcpTools(controller);

		expect(tools.some((tool) => tool.name.startsWith('midi') || tool.name.includes('_midi'))).toBe(false);
		expect(tools.some((tool) => tool.name === 'set_track_midi_route')).toBe(false);
	});

	test('passes a local instrument through the revision-safe MIDI route tool', async () => {
		let received: unknown;
		const controller = { ...testController(), setTrackMidiRoute: async (input: Parameters<NonNullable<WebMcpController['setTrackMidiRoute']>>[0]) => {
			received = input;
			return { ok: true, action: 'set_track_midi_route', affectedEntityIds: ['source', 'trk_test'], message: 'routed', state, revision: 1, activeRevision: 1, transactionId: input.transactionId };
		} };
		const route = createWebMcpTools(controller).find((tool) => tool.name === 'set_track_midi_route');
		await route?.execute({ trackId: 'trk_test', instrument: 'gm_piano', channel: 1, enabled: false, baseRevision: 0, transactionId: 'instrument-route-test' }, { signal: new AbortController().signal });
		expect(received).toMatchObject({ trackId: 'trk_test', instrument: 'gm_piano', channel: 1, enabled: false, baseRevision: 0, transactionId: 'instrument-route-test' });
	});

	test('requires user activation for agent MIDI permission and panic actions', async () => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
		Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userActivation: { isActive: false } } });
		try {
			const tools = createWebMcpTools(testController());
			const access = tools.find((tool) => tool.name === 'request_midi_access');
			const panic = tools.find((tool) => tool.name === 'panic_midi');
			const expected = { ok: false, error: { code: 'MIDI_USER_GESTURE_REQUIRED', message: 'The browser requires a user gesture. Press Connect MIDI or the hardware action button in Sushi before asking an agent to continue.' } };
			expect(await access?.execute({ sysex: false }, { signal: new AbortController().signal })).toEqual(expected);
			expect(await panic?.execute({}, { signal: new AbortController().signal })).toEqual(expected);
		} finally {
			if (previous) Object.defineProperty(globalThis, 'navigator', previous);
			else Reflect.deleteProperty(globalThis, 'navigator');
		}
	});

	test('rejects malformed tool inputs before dispatch', async () => {
		const write = createWebMcpTools(testController()).find((tool) => tool.name === 'write_strudel_source');
		const result = await write?.execute({ source: 'next', baseRevision: 0 }, { signal: new AbortController().signal });
		expect(result).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'transactionId must be a non-empty string.' } });
	});

	test('validates track targets before dispatching track tools', async () => {
		const deleteTool = createWebMcpTools(testController()).find((tool) => tool.name === 'delete_track');
		const result = await deleteTool?.execute({ baseRevision: 0, transactionId: 'delete-test' }, { signal: new AbortController().signal });
		expect(result).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Provide trackNumber, trackId, or trackName to identify a track.' } });
	});

	test('validates tempo and key inputs before dispatch', async () => {
		const tools = createWebMcpTools(testController());
		const tempo = tools.find((tool) => tool.name === 'set_tempo');
		const key = tools.find((tool) => tool.name === 'set_key');
		const signal = new AbortController().signal;

		expect(await tempo?.execute({ bpm: 301, baseRevision: 0, transactionId: 'tempo-test' }, { signal })).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'bpm must be a finite number from 0 to 300.' } });
		expect(await key?.execute({ key: '  ', baseRevision: 0, transactionId: 'key-test' }, { signal })).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'key must contain 1-64 characters.' } });
	});

	test('normalizes a track-name target before dispatch', async () => {
		let received: unknown;
		const controller = { ...testController(), deleteTrack: async (input: Parameters<WebMcpController['deleteTrack']>[0]) => {
			received = input;
			return { ok: true, action: 'delete_track', affectedEntityIds: ['source', 'trk_test'], message: 'deleted', state, revision: 1, activeRevision: 1, transactionId: input.transactionId };
		} };
		const deleteTool = createWebMcpTools(controller).find((tool) => tool.name === 'delete_track');
		await deleteTool?.execute({ trackName: '  Test  ', baseRevision: 0, transactionId: 'delete-name' }, { signal: new AbortController().signal });
		expect(received).toMatchObject({ trackName: 'Test', baseRevision: 0, transactionId: 'delete-name' });
	});

	test('accepts an explicit track ID target', async () => {
		let received: unknown;
		const controller = { ...testController(), deleteTrack: async (input: Parameters<WebMcpController['deleteTrack']>[0]) => {
			received = input;
			return { ok: true, action: 'delete_track', affectedEntityIds: ['source', 'trk_test'], message: 'deleted', state, revision: 1, activeRevision: 1, transactionId: input.transactionId };
		} };
		const deleteTool = createWebMcpTools(controller).find((tool) => tool.name === 'delete_track');
		await deleteTool?.execute({ trackId: '  trk_test  ', baseRevision: 0, transactionId: 'delete-id' }, { signal: new AbortController().signal });
		expect(received).toMatchObject({ trackId: 'trk_test', baseRevision: 0, transactionId: 'delete-id' });
	});

	test('applies exact edits and rejects overlap', () => {
		expect(applyTextEdits('abcdef', [{ start: 0, end: 1, text: 'A' }, { start: 3, end: 4, text: 'D' }])).toEqual({ ok: true, source: 'AbcDef' });
		expect(applyTextEdits('abcdef', [{ start: 1, end: 4, text: 'x' }, { start: 3, end: 5, text: 'y' }])).toEqual({ ok: false, error: { code: 'OVERLAPPING_EDITS', message: 'Text edits must not overlap.' } });
		expect(applyTextEdits('abcdef', [{ start: 2, end: 2, text: 'x' }, { start: 2, end: 2, text: 'y' }])).toEqual({ ok: false, error: { code: 'OVERLAPPING_EDITS', message: 'Text edits must not overlap or share an insertion offset.' } });
		expect(sourceDiff('abc', 'abXYZc', 2, 3)).toEqual({ fromRevision: 2, toRevision: 3, start: 2, end: 2, removed: '', added: 'XYZ' });
	});

	test('looks up the local Strudel reference', async () => {
		const lookup = createWebMcpTools(testController()).find((tool) => tool.name === 'lookup_strudel_reference');
		const result = await lookup?.execute({ query: 'gain' }, { signal: new AbortController().signal }) as { results: Array<{ id: string }> };
		expect(result.results[0]?.id).toBe('gain');
	});

	test('lists and views curated editor templates', async () => {
		const tools = createWebMcpTools(testController());
		const list = tools.find((tool) => tool.name === 'list_editor_templates');
		const view = tools.find((tool) => tool.name === 'view_editor_template');
		const listed = await list?.execute({ query: 'witch' }, { signal: new AbortController().signal }) as { templates: Array<{ id: string; name: string; description: string; bpm: number; key: string; lanes: number; source?: string }> };
		expect(listed.templates).toEqual([{ id: 'witch-house-climax', name: 'Witch-House Climax', description: 'A cinematic 24-cycle build from sparse arpeggios into a dense, distorted climax.', bpm: 84, key: 'F minor', lanes: 16 }]);
		expect(listed.templates[0]).not.toHaveProperty('source');

		const viewed = await view?.execute({ templateId: 'witch-house-climax' }, { signal: new AbortController().signal }) as { template: { id: string; source: string } };
		expect(viewed.template.id).toBe('witch-house-climax');
		expect(viewed.template.source).toContain('const key = "F:minor"');
	});

	test('validates and dispatches editor template loads', async () => {
		let received: unknown;
		const controller = { ...testController(), loadTemplate: async (input: Parameters<WebMcpController['loadTemplate']>[0]) => {
			received = input;
			return { ok: true, action: 'load_editor_template', affectedEntityIds: ['source', 'project', 'timeline'], message: 'loaded', state, revision: 1, activeRevision: 1, transactionId: input.transactionId };
		} };
		const load = createWebMcpTools(controller).find((tool) => tool.name === 'load_editor_template');
		const signal = new AbortController().signal;
		await expect(load?.execute({ templateId: '  witch-house-climax  ', baseRevision: 0, transactionId: 'load-template' }, { signal })).resolves.toMatchObject({ ok: true });
		expect(received).toEqual({ templateId: 'witch-house-climax', baseRevision: 0, transactionId: 'load-template' });
		expect(await load?.execute({ templateId: 'missing', baseRevision: 0, transactionId: 'load-invalid' }, { signal })).toEqual({ ok: false, error: { code: 'TEMPLATE_NOT_FOUND', message: 'No editor template exists with ID "missing".' } });
	});

	test('handles native executeTool callbacks that omit optional cancellation options', async () => {
		const lookup = createWebMcpTools(testController()).find((tool) => tool.name === 'lookup_strudel_reference');
		const execute = lookup?.execute as unknown as (input: Record<string, unknown>) => Promise<{ results: Array<{ id: string }> }>;
		const result = await execute({ query: 'gain' });
		expect(result.results[0]?.id).toBe('gain');
	});

	test('registers tools only when a model context is supplied and disposes them', async () => {
		const registered: string[] = [];
		let registrationSignal: AbortSignal | undefined;
		const context = {
			registerTool: async (tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => {
				registered.push(tool.name);
				registrationSignal = options?.signal;
			},
		} as unknown as WebMCP.ModelContext;

		const registration = await registerWebMcpTools(testController(), context);
		expect(registration.available).toBe(true);
		expect(registered).toEqual([...WEBMCP_TOOL_NAMES]);
		expect(registrationSignal?.aborted).toBe(false);
		registration.dispose();
		expect(registrationSignal?.aborted).toBe(true);
	});

	test('rejects an explicitly supplied context without a usable registerTool method', async () => {
		const registration = await registerWebMcpTools(testController(), {} as WebMCP.ModelContext);
		expect(registration.available).toBe(false);
		expect(registration.toolNames).toEqual([]);
	});

	test('aborts the registration transaction when a host rejects a tool', async () => {
		const registered: string[] = [];
		let registrationSignal: AbortSignal | undefined;
		const context = {
			registerTool: async (tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => {
				registered.push(tool.name);
				registrationSignal = options?.signal;
				if (tool.name === 'inspect_strudel_state') throw new Error('host rejected tool');
			},
		} as unknown as WebMCP.ModelContext;

		const registration = await registerWebMcpTools(testController(), context);
		expect(registration.available).toBe(false);
		expect(registration.toolNames).toEqual([]);
		expect(registration.error).toBe('host rejected tool');
		expect(registered).toEqual(['open_studio_session', 'inspect_strudel_state']);
		expect(registrationSignal?.aborted).toBe(true);
	});

	test('cancels an in-flight registration when its owner is disposed', async () => {
		const ownerController = new AbortController();
		let registrationStarted: () => void = () => undefined;
		const started = new Promise<void>((resolve) => { registrationStarted = resolve; });
		const context = {
			registerTool: (_tool: WebMCP.ModelContextTool, _options?: WebMCP.ModelContextRegisterToolOptions) => {
				registrationStarted();
				return new Promise<void>(() => undefined);
			},
		} as unknown as WebMCP.ModelContext;

		const registrationPromise = registerWebMcpTools(testController(), context, { signal: ownerController.signal });
		await started;
		ownerController.abort();
		const registration = await registrationPromise;
		expect(registration.available).toBe(false);
		expect(registration.toolNames).toEqual([]);
		expect(registration.error).toBe('WebMCP registration was cancelled.');
	});

	test('does not touch a host when registration is already aborted', async () => {
		const ownerController = new AbortController();
		ownerController.abort();
		let calls = 0;
		const context = {
			registerTool: async () => { calls += 1; },
		} as unknown as WebMCP.ModelContext;

		const registration = await registerWebMcpTools(testController(), context, { signal: ownerController.signal });
		expect(registration.available).toBe(false);
		expect(calls).toBe(0);
	});

	test('does not probe a host when registration is already aborted', async () => {
		const host = globalThis as typeof globalThis & { modelContext?: WebMCP.ModelContext };
		const previous = Object.getOwnPropertyDescriptor(host, 'modelContext');
		const ownerController = new AbortController();
		let reads = 0;
		Object.defineProperty(host, 'modelContext', {
			configurable: true,
			get: () => {
				reads += 1;
				return undefined;
			},
		});
		ownerController.abort();
		try {
			const registration = await registerWebMcpTools(testController(), undefined, { signal: ownerController.signal });
			expect(registration.available).toBe(false);
			expect(reads).toBe(0);
		} finally {
			if (previous) Object.defineProperty(host, 'modelContext', previous);
			else Reflect.deleteProperty(host, 'modelContext');
		}
	});

	test('feature-detects WebMCP when the browser does not provide it', async () => {
		const registration = await registerWebMcpTools(testController(), undefined);
		expect(registration.available).toBe(false);
		expect(registration.toolNames).toEqual([]);
	});
});
