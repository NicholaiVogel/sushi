/// <reference types="webmcp-types" />

import type { SourceDiagnostic, RuntimeState } from '../project/model';
import type { SourceBlockDetails, TrackTiming } from '../project/source-mapper';
import { lookupStrudelReference, STRUDEL_REFERENCE_VERSION, type StrudelReferenceEntry, type StrudelReferenceKind } from '../strudel/reference';

export const WEBMCP_TOOL_NAMES = [
	'open_studio_session',
	'inspect_strudel_state',
	'read_strudel_source',
	'write_strudel_source',
	'patch_strudel_source',
	'validate_strudel_source',
	'lookup_strudel_reference',
	'control_playback',
	'undo_source_edit',
	'redo_source_edit',
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];

export interface WebMcpControlState {
	value?: number;
	editable: boolean;
}

export interface WebMcpTrackState {
	id: string;
	name: string;
	type: SourceBlockDetails['type'];
	line: number;
	label?: string;
	expression?: string;
	timing: TrackTiming;
	gain: WebMcpControlState;
	pan: WebMcpControlState;
	muted: boolean;
	soloed: boolean;
}

export interface WebMcpStateSnapshot {
	project: {
		id: string;
		name: string;
	};
	source: {
		draft: string;
		lastValid: string;
		revision: number;
		activeRevision: number | null;
	};
	timeline: {
		bpm: number;
		quarterNotesPerCycle: number;
		key: string;
		songEndCycle: number;
	};
	tracks: WebMcpTrackState[];
	diagnostics: SourceDiagnostic[];
	runtime: RuntimeState;
	phase: string;
	persistenceState: string;
	webmcp: {
		available: boolean;
	};
}

export interface SourceTextEdit {
	start: number;
	end: number;
	text: string;
}

export interface SourceDiff {
	fromRevision: number;
	toRevision: number;
	start: number;
	end: number;
	removed: string;
	added: string;
}

export interface WebMcpError {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

export interface WebMcpMutationResult {
	ok: boolean;
	action: string;
	affectedEntityIds: string[];
	message: string;
	state: WebMcpStateSnapshot;
	revision: number;
	activeRevision: number | null;
	transactionId?: string;
	diff?: SourceDiff;
	error?: WebMcpError;
	conflict?: {
		expectedRevision: number;
		actualRevision: number;
	};
}

export interface WebMcpValidationResult {
	ok: boolean;
	action: 'validate_strudel_source';
	source: string;
	diagnostics: SourceDiagnostic[];
	message: string;
	revision: number;
	state: WebMcpStateSnapshot;
	error?: WebMcpError;
}

export type WebMcpPlaybackAction = 'play' | 'pause' | 'resume' | 'stop' | 'seek';

export interface WebMcpPlaybackResult {
	ok: boolean;
	action: `control_playback:${WebMcpPlaybackAction}`;
	affectedEntityIds: string[];
	message: string;
	state: WebMcpStateSnapshot;
	revision: number;
	activeRevision: number | null;
	error?: WebMcpError;
}

export interface SourceMutationInput {
	source: string;
	baseRevision: number;
	transactionId: string;
}

export interface SourcePatchInput {
	edits: SourceTextEdit[];
	baseRevision: number;
	transactionId: string;
}

export interface WebMcpController {
	getState: () => WebMcpStateSnapshot;
	writeSource: (input: SourceMutationInput) => Promise<WebMcpMutationResult>;
	patchSource: (input: SourcePatchInput) => Promise<WebMcpMutationResult>;
	validateSource: (source?: string) => Promise<WebMcpValidationResult>;
	controlPlayback: (input: { action: WebMcpPlaybackAction; cycle?: number }) => Promise<WebMcpPlaybackResult>;
	undoSourceEdit: (input: Omit<SourceMutationInput, 'source'>) => Promise<WebMcpMutationResult>;
	redoSourceEdit: (input: Omit<SourceMutationInput, 'source'>) => Promise<WebMcpMutationResult>;
}

export interface WebMcpRegistration {
	available: boolean;
	toolNames: string[];
	error?: string;
	dispose: () => void;
}

/**
 * Resolve the browser-provided WebMCP surface without assuming a single host
 * placement. Chromium builds have exposed ModelContext on the document, while
 * embedded app browsers may provide the same native object on navigator or
 * window. Keeping this lookup in one place also makes the feature detection
 * testable without requiring a real browser implementation.
 */
export function getNativeModelContext(context?: WebMCP.ModelContext): WebMCP.ModelContext | undefined {
	if (context) return context;
	const globalWithModelContext = globalThis as typeof globalThis & { modelContext?: WebMCP.ModelContext };
	if (globalWithModelContext.modelContext) return globalWithModelContext.modelContext;
	if (typeof document !== 'undefined' && document.modelContext) return document.modelContext;
	if (typeof navigator !== 'undefined') {
		const navigatorWithModelContext = navigator as Navigator & { modelContext?: WebMCP.ModelContext };
		if (navigatorWithModelContext.modelContext) return navigatorWithModelContext.modelContext;
	}
	if (typeof window !== 'undefined') {
		const windowWithModelContext = window as Window & { modelContext?: WebMCP.ModelContext };
		if (windowWithModelContext.modelContext) return windowWithModelContext.modelContext;
	}
	return undefined;
}

interface ToolOptions {
	signal: AbortSignal;
}

const MAX_SOURCE_LENGTH = 200_000;
const MAX_EDIT_COUNT = 100;
const MAX_TRANSACTION_LENGTH = 128;

const EMPTY_SCHEMA = {
	type: 'object',
	properties: {},
	additionalProperties: false,
} as const;

function messageFromError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function failed(error: WebMcpError): { ok: false; error: WebMcpError } {
	return { ok: false, error };
}

function invalidInput(message: string, details?: Record<string, unknown>) {
	return failed({ code: 'INVALID_INPUT', message, ...(details ? { details } : {}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value);
}

function readSourceInput(value: unknown): { ok: true; source: string } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (typeof value !== 'string') return { ok: false, result: invalidInput('source must be a string.') };
	if (value.length > MAX_SOURCE_LENGTH) return { ok: false, result: invalidInput(`source must be at most ${MAX_SOURCE_LENGTH} characters.`) };
	return { ok: true, source: value };
}

function readRevisionInput(value: unknown): { ok: true; revision: number } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isInteger(value) || value < 0) return { ok: false, result: invalidInput('baseRevision must be a non-negative integer.') };
	return { ok: true, revision: value };
}

function readTransactionInput(value: unknown): { ok: true; transactionId: string } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (typeof value !== 'string' || !value.trim()) return { ok: false, result: invalidInput('transactionId must be a non-empty string.') };
	if (value.length > MAX_TRANSACTION_LENGTH) return { ok: false, result: invalidInput(`transactionId must be at most ${MAX_TRANSACTION_LENGTH} characters.`) };
	return { ok: true, transactionId: value };
}

function readMutationInput(value: unknown): { ok: true; input: SourceMutationInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	const source = readSourceInput(value.source);
	if (!source.ok) return source;
	const revision = readRevisionInput(value.baseRevision);
	if (!revision.ok) return revision;
	const transaction = readTransactionInput(value.transactionId);
	if (!transaction.ok) return transaction;
	return { ok: true, input: { source: source.source, baseRevision: revision.revision, transactionId: transaction.transactionId } };
}

function readRevisionTransactionInput(value: unknown): { ok: true; input: Omit<SourceMutationInput, 'source'> } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	const revision = readRevisionInput(value.baseRevision);
	if (!revision.ok) return revision;
	const transaction = readTransactionInput(value.transactionId);
	if (!transaction.ok) return transaction;
	return { ok: true, input: { baseRevision: revision.revision, transactionId: transaction.transactionId } };
}

function readPatchInput(value: unknown): { ok: true; input: SourcePatchInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	const revision = readRevisionInput(value.baseRevision);
	if (!revision.ok) return revision;
	const transaction = readTransactionInput(value.transactionId);
	if (!transaction.ok) return transaction;
	if (!Array.isArray(value.edits)) return { ok: false, result: invalidInput('edits must be an array.') };
	if (value.edits.length > MAX_EDIT_COUNT) return { ok: false, result: invalidInput(`edits must contain at most ${MAX_EDIT_COUNT} entries.`) };

	const edits: SourceTextEdit[] = [];
	for (const [index, rawEdit] of value.edits.entries()) {
		if (!isRecord(rawEdit) || !isInteger(rawEdit.start) || !isInteger(rawEdit.end) || typeof rawEdit.text !== 'string') {
			return { ok: false, result: invalidInput(`edits[${index}] must contain integer start/end offsets and string text.`) };
		}
		edits.push({ start: rawEdit.start, end: rawEdit.end, text: rawEdit.text });
	}

	return { ok: true, input: { edits, baseRevision: revision.revision, transactionId: transaction.transactionId } };
}

function cancelled(options: ToolOptions): { ok: false; error: WebMcpError } | undefined {
	return options.signal.aborted ? failed({ code: 'CANCELLED', message: 'The WebMCP tool call was cancelled.' }) : undefined;
}

/** Apply exact, non-overlapping UTF-16 offset edits from right to left. */
export function applyTextEdits(source: string, edits: SourceTextEdit[]): { ok: true; source: string } | { ok: false; error: WebMcpError } {
	if (source.length > MAX_SOURCE_LENGTH) return failed({ code: 'SOURCE_TOO_LARGE', message: `source must be at most ${MAX_SOURCE_LENGTH} characters.` });
	if (edits.length > MAX_EDIT_COUNT) return failed({ code: 'TOO_MANY_EDITS', message: `edits must contain at most ${MAX_EDIT_COUNT} entries.` });

	const ordered = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
	let previousStart = source.length + 1;
	for (const edit of ordered) {
		if (!isInteger(edit.start) || !isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
			return failed({ code: 'INVALID_EDIT_RANGE', message: `Edit range ${edit.start}..${edit.end} is outside the current source.` });
		}
		if (edit.end > previousStart) return failed({ code: 'OVERLAPPING_EDITS', message: 'Text edits must not overlap.' });
		if (typeof edit.text !== 'string') return failed({ code: 'INVALID_EDIT_TEXT', message: 'Edit text must be a string.' });
		previousStart = edit.start;
	}

	let nextSource = source;
	for (const edit of ordered) nextSource = `${nextSource.slice(0, edit.start)}${edit.text}${nextSource.slice(edit.end)}`;
	if (nextSource.length > MAX_SOURCE_LENGTH) return failed({ code: 'SOURCE_TOO_LARGE', message: `resulting source must be at most ${MAX_SOURCE_LENGTH} characters.` });
	return { ok: true, source: nextSource };
}

export function sourceDiff(before: string, after: string, fromRevision: number, toRevision: number): SourceDiff | undefined {
	if (before === after) return undefined;
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) start += 1;

	let beforeEnd = before.length;
	let afterEnd = after.length;
	while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
		beforeEnd -= 1;
		afterEnd -= 1;
	}

	return {
		fromRevision,
		toRevision,
		start,
		end: beforeEnd,
		removed: before.slice(start, beforeEnd),
		added: after.slice(start, afterEnd),
	};
}

function schema(properties: Record<string, object>, required: string[] = []) {
	return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function createTool<T extends Record<string, unknown>>(
	definition: Omit<WebMCP.ModelContextTool, 'execute'>,
	execute: (input: T, options: ToolOptions) => WebMCP.MaybePromise<unknown>,
): WebMCP.ModelContextTool {
	return {
		...definition,
		execute: (input, options) => execute((input ?? {}) as T, options),
	};
}

export function createWebMcpTools(controller: WebMcpController): WebMCP.ModelContextTool[] {
	const executeSafely = async (operation: () => WebMCP.MaybePromise<unknown>) => {
		try {
			return await operation();
		} catch (error) {
			return failed({ code: 'INTERNAL_ERROR', message: messageFromError(error) });
		}
	};

	return [
		createTool({
			name: 'open_studio_session',
			title: 'Open Sushi studio session',
			description: 'Return the current Sushi project, source revision, tracks, diagnostics, and runtime state.',
			inputSchema: EMPTY_SCHEMA,
			annotations: { readOnlyHint: true },
		}, (_input, options) => cancelled(options) ?? executeSafely(() => ({ ok: true, action: 'open_studio_session', state: controller.getState() }))),

		createTool({
			name: 'inspect_strudel_state',
			title: 'Inspect Strudel state',
			description: 'Inspect parsed source blocks, recognized source controls, diagnostics, and the derived Strudel runtime.',
			inputSchema: EMPTY_SCHEMA,
			annotations: { readOnlyHint: true },
		}, (_input, options) => cancelled(options) ?? executeSafely(() => ({ ok: true, action: 'inspect_strudel_state', state: controller.getState() }))),

		createTool({
			name: 'read_strudel_source',
			title: 'Read Strudel source',
			description: 'Read the editable draft and last-valid Strudel source, including the current revision and diagnostics.',
			inputSchema: schema({ which: { type: 'string', enum: ['draft', 'lastValid'] } }),
			annotations: { readOnlyHint: true },
		}, (input: { which?: unknown }, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			if (input.which !== undefined && input.which !== 'draft' && input.which !== 'lastValid') return invalidInput('which must be either draft or lastValid.');
			return executeSafely(() => {
				const state = controller.getState();
				return {
					ok: true,
					action: 'read_strudel_source',
					selected: input.which ?? 'draft',
					source: input.which === 'lastValid' ? state.source.lastValid : state.source.draft,
					draft: state.source.draft,
					lastValid: state.source.lastValid,
					revision: state.source.revision,
					activeRevision: state.source.activeRevision,
					diagnostics: state.diagnostics,
				};
			});
		}),

		createTool({
			name: 'write_strudel_source',
			title: 'Write Strudel source',
			description: 'Replace the source draft, validate it through Strudel, and activate it only when valid. Requires the current revision and an idempotency transaction ID.',
			inputSchema: schema({
				source: { type: 'string', maxLength: MAX_SOURCE_LENGTH },
				baseRevision: { type: 'integer', minimum: 0 },
				transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
			}, ['source', 'baseRevision', 'transactionId']),
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readMutationInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.writeSource(parsed.input));
		}),

		createTool({
			name: 'patch_strudel_source',
			title: 'Patch Strudel source',
			description: 'Apply exact, non-overlapping UTF-16 text edits to the current source revision, then validate through Strudel.',
			inputSchema: schema({
				edits: {
					type: 'array',
					maxItems: MAX_EDIT_COUNT,
					items: { type: 'object', properties: { start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, text: { type: 'string' } }, required: ['start', 'end', 'text'], additionalProperties: false },
				},
				baseRevision: { type: 'integer', minimum: 0 },
				transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
			}, ['edits', 'baseRevision', 'transactionId']),
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readPatchInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.patchSource(parsed.input));
		}),

		createTool({
			name: 'validate_strudel_source',
			title: 'Validate Strudel source',
			description: 'Evaluate candidate Strudel source for diagnostics without changing the project draft or active revision.',
			inputSchema: schema({ source: { type: 'string', maxLength: MAX_SOURCE_LENGTH } }),
			annotations: { readOnlyHint: true },
		}, (input: { source?: unknown }, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			if (input.source !== undefined && typeof input.source !== 'string') return invalidInput('source must be a string when provided.');
			if (typeof input.source === 'string' && input.source.length > MAX_SOURCE_LENGTH) return invalidInput(`source must be at most ${MAX_SOURCE_LENGTH} characters.`);
			return executeSafely(() => controller.validateSource(input.source as string | undefined));
		}),

		createTool({
			name: 'lookup_strudel_reference',
			title: 'Lookup Strudel reference',
			description: 'Search Sushi’s versioned local Strudel reference for functions, sounds, templates, and starter patterns.',
			inputSchema: schema({ query: { type: 'string' }, kind: { type: 'string', enum: ['function', 'sound', 'template', 'pattern'] }, limit: { type: 'integer', minimum: 1, maximum: 12 } }, ['query']),
			annotations: { readOnlyHint: true },
		}, (input: { query?: unknown; kind?: unknown; limit?: unknown }, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			if (typeof input.query !== 'string') return invalidInput('query must be a string.');
			if (input.kind !== undefined && input.kind !== 'function' && input.kind !== 'sound' && input.kind !== 'template' && input.kind !== 'pattern') return invalidInput('kind must be function, sound, template, or pattern.');
			if (input.limit !== undefined && (!isInteger(input.limit) || input.limit < 1 || input.limit > 12)) return invalidInput('limit must be an integer from 1 to 12.');
			return executeSafely(() => ({
				ok: true,
				action: 'lookup_strudel_reference',
				version: STRUDEL_REFERENCE_VERSION,
				query: input.query,
				kind: input.kind,
				results: lookupStrudelReference(input.query as string, input.kind as StrudelReferenceKind | undefined, input.limit as number | undefined) as StrudelReferenceEntry[],
			}));
		}),

		createTool({
			name: 'control_playback',
			title: 'Control playback',
			description: 'Start, pause, resume, stop, or seek the Strudel runtime. Seeking uses musical cycle positions.',
			inputSchema: schema({ action: { type: 'string', enum: ['play', 'pause', 'resume', 'stop', 'seek'] }, cycle: { type: 'number', minimum: 0 } }, ['action']),
		}, (input: { action?: unknown; cycle?: unknown }, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			if (input.action !== 'play' && input.action !== 'pause' && input.action !== 'resume' && input.action !== 'stop' && input.action !== 'seek') return invalidInput('action must be play, pause, resume, stop, or seek.');
			if (input.cycle !== undefined && !isFiniteNumber(input.cycle)) return invalidInput('cycle must be a finite number.');
			if (input.action === 'seek' && input.cycle === undefined) return invalidInput('cycle is required when action is seek.');
			return executeSafely(() => controller.controlPlayback({ action: input.action as WebMcpPlaybackAction, ...(input.cycle === undefined ? {} : { cycle: input.cycle as number }) }));
		}),

		createTool({
			name: 'undo_source_edit',
			title: 'Undo source edit',
			description: 'Undo the latest shared human or agent source edit when the supplied base revision is still current.',
			inputSchema: schema({ baseRevision: { type: 'integer', minimum: 0 }, transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH } }, ['baseRevision', 'transactionId']),
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readRevisionTransactionInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.undoSourceEdit(parsed.input));
		}),

		createTool({
			name: 'redo_source_edit',
			title: 'Redo source edit',
			description: 'Redo the latest shared source edit when the supplied base revision is still current.',
			inputSchema: schema({ baseRevision: { type: 'integer', minimum: 0 }, transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH } }, ['baseRevision', 'transactionId']),
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readRevisionTransactionInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.redoSourceEdit(parsed.input));
		}),
	];
}

export async function registerWebMcpTools(controller: WebMcpController, context?: WebMCP.ModelContext): Promise<WebMcpRegistration> {
	const modelContext = getNativeModelContext(context);
	if (!modelContext) return { available: false, toolNames: [], dispose: () => undefined };

	const abortController = new AbortController();
	const tools = createWebMcpTools(controller);
	try {
		for (const tool of tools) {
			await modelContext.registerTool(tool, { signal: abortController.signal });
		}
		return {
			available: true,
			toolNames: tools.map((tool) => tool.name),
			dispose: () => abortController.abort(),
		};
	} catch (error) {
		abortController.abort();
		return { available: false, toolNames: [], error: messageFromError(error), dispose: () => undefined };
	}
}
