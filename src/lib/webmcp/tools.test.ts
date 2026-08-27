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
};

function testController(): WebMcpController {
	return {
		getState: () => state,
		writeSource: async () => ({ ok: true, action: 'write_strudel_source', affectedEntityIds: ['source'], message: 'accepted', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		patchSource: async () => ({ ok: true, action: 'patch_strudel_source', affectedEntityIds: ['source'], message: 'accepted', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		validateSource: async (source) => ({ ok: true, action: 'validate_strudel_source', source: source ?? state.source.draft, diagnostics: [], message: 'valid', revision: state.source.revision, state }),
		controlPlayback: async ({ action }) => ({ ok: true, action: `control_playback:${action}`, affectedEntityIds: ['transport'], message: 'done', state, revision: state.source.revision, activeRevision: state.source.activeRevision }),
		undoSourceEdit: async () => ({ ok: true, action: 'undo_source_edit', affectedEntityIds: ['source'], message: 'undone', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
		redoSourceEdit: async () => ({ ok: true, action: 'redo_source_edit', affectedEntityIds: ['source'], message: 'redone', state, revision: 1, activeRevision: 1, transactionId: 'tx' }),
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
		const sourceReaders = tools.filter((tool) => ['open_studio_session', 'inspect_strudel_state', 'read_strudel_source', 'validate_strudel_source'].includes(tool.name));
		expect(sourceReaders.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.untrustedContentHint === true)).toBe(true);
		const sourceWriters = tools.filter((tool) => ['write_strudel_source', 'patch_strudel_source', 'control_playback', 'undo_source_edit', 'redo_source_edit'].includes(tool.name));
		expect(sourceWriters.every((tool) => tool.annotations?.readOnlyHint === false && tool.annotations?.untrustedContentHint === true)).toBe(true);
		expect(tools.find((tool) => tool.name === 'lookup_strudel_reference')?.annotations).toEqual({ readOnlyHint: true });
		const write = tools.find((tool) => tool.name === 'write_strudel_source');
		expect(write?.inputSchema).toMatchObject({ required: ['source', 'baseRevision', 'transactionId'] });
		const patch = tools.find((tool) => tool.name === 'patch_strudel_source');
		expect(patch?.inputSchema).toMatchObject({ required: ['edits', 'baseRevision', 'transactionId'] });
	});

	test('rejects malformed tool inputs before dispatch', async () => {
		const write = createWebMcpTools(testController()).find((tool) => tool.name === 'write_strudel_source');
		const result = await write?.execute({ source: 'next', baseRevision: 0 }, { signal: new AbortController().signal });
		expect(result).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'transactionId must be a non-empty string.' } });
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
