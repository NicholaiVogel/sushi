/// <reference types="webmcp-types" />

import { describe, expect, test } from 'bun:test';
import {
	WEBMCP_TOOL_NAMES,
	applyTextEdits,
	createWebMcpTools,
	registerWebMcpTools,
	sourceDiff,
	getNativeModelContext,
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
		const context = {} as WebMCP.ModelContext;
		expect(getNativeModelContext(context)).toBe(context);
	});

	test('finds a model context exposed by an embedded browser host', () => {
		const host = globalThis as typeof globalThis & { modelContext?: WebMCP.ModelContext };
		const previous = host.modelContext;
		const context = {} as WebMCP.ModelContext;
		Object.defineProperty(host, 'modelContext', { configurable: true, value: context });
		try {
			expect(getNativeModelContext()).toBe(context);
		} finally {
			if (previous === undefined) Reflect.deleteProperty(host, 'modelContext');
			else Object.defineProperty(host, 'modelContext', { configurable: true, value: previous });
		}
	});

	test('exposes the contract tools and revision-aware schemas', () => {
		const tools = createWebMcpTools(testController());
		expect(tools.map((tool) => tool.name)).toEqual([...WEBMCP_TOOL_NAMES]);
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
		expect(sourceDiff('abc', 'abXYZc', 2, 3)).toEqual({ fromRevision: 2, toRevision: 3, start: 2, end: 2, removed: '', added: 'XYZ' });
	});

	test('looks up the local Strudel reference', async () => {
		const lookup = createWebMcpTools(testController()).find((tool) => tool.name === 'lookup_strudel_reference');
		const result = await lookup?.execute({ query: 'gain' }, { signal: new AbortController().signal }) as { results: Array<{ id: string }> };
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

	test('feature-detects WebMCP when the browser does not provide it', async () => {
		const registration = await registerWebMcpTools(testController(), undefined);
		expect(registration.available).toBe(false);
		expect(registration.toolNames).toEqual([]);
	});
});
