/// <reference types="webmcp-types" />

import type { SourceDiagnostic, RuntimeState } from '../project/model';
import type { SourceBlockDetails, TrackTiming } from '../project/source-mapper';
import { getEditorPreset, listEditorPresets, summarizeEditorPreset, type EditorPresetSummary } from '../project/presets';
import { lookupStrudelReference, STRUDEL_REFERENCE_VERSION, type StrudelReferenceEntry, type StrudelReferenceKind } from '../strudel/reference';

export const WEBMCP_TOOL_NAMES = [
	'open_studio_session',
	'inspect_strudel_state',
	'read_strudel_source',
	'list_editor_templates',
	'view_editor_template',
	'load_editor_template',
	'write_strudel_source',
	'patch_strudel_source',
	'set_tempo',
	'set_key',
	'delete_track',
	'rename_track',
	'set_track_range',
	'extend_timeline',
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
	number: number;
	name: string;
	type: SourceBlockDetails['type'];
	line: number;
	label?: string;
	expression?: string;
	timing: TrackTiming;
	gain: WebMcpControlState;
	pan: WebMcpControlState;
	color?: string;
	colorEditable?: boolean;
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

export interface WebMcpTemplateLoadInput {
	templateId: string;
	baseRevision: number;
	transactionId: string;
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

export interface WebMcpTrackTarget {
	trackNumber?: number;
	trackId?: string;
	trackName?: string;
}

export interface WebMcpTrackMutationInput extends WebMcpTrackTarget {
	baseRevision: number;
	transactionId: string;
}

export interface WebMcpTrackRenameInput extends WebMcpTrackMutationInput {
	newName: string;
}

export interface WebMcpTrackRangeInput extends WebMcpTrackMutationInput {
	startCycle: number;
	endCycle: number;
}

export interface WebMcpTempoInput {
	bpm: number;
	baseRevision: number;
	transactionId: string;
}

export interface WebMcpKeyInput {
	key: string;
	baseRevision: number;
	transactionId: string;
}

export interface WebMcpTimelineExtensionInput {
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
	loadTemplate: (input: WebMcpTemplateLoadInput) => Promise<WebMcpMutationResult>;
	writeSource: (input: SourceMutationInput) => Promise<WebMcpMutationResult>;
	patchSource: (input: SourcePatchInput) => Promise<WebMcpMutationResult>;
	setTempo: (input: WebMcpTempoInput) => Promise<WebMcpMutationResult>;
	setKey: (input: WebMcpKeyInput) => Promise<WebMcpMutationResult>;
	deleteTrack: (input: WebMcpTrackMutationInput) => Promise<WebMcpMutationResult>;
	renameTrack: (input: WebMcpTrackRenameInput) => Promise<WebMcpMutationResult>;
	setTrackRange: (input: WebMcpTrackRangeInput) => Promise<WebMcpMutationResult>;
	extendTimeline: (input: WebMcpTimelineExtensionInput) => Promise<WebMcpMutationResult>;
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

export interface WebMcpRegistrationOptions {
	/** Abort an in-flight registration when the owning UI lifecycle ends. */
	signal?: AbortSignal;
}

export interface WebMcpContextWaitOptions {
	/** Maximum time to wait for a host-injected context. */
	timeoutMs?: number;
	/** Poll interval used when the host does not provide a readiness event. */
	pollIntervalMs?: number;
	signal?: AbortSignal;
}

/**
 * Resolve the browser-provided WebMCP surface without assuming a single host
 * placement. Chromium builds have exposed ModelContext on the document, while
 * embedded app browsers may provide the same native object on navigator or
 * window. Keeping this lookup in one place also makes the feature detection
 * testable without requiring a real browser implementation.
 */
export function getNativeModelContext(context?: WebMCP.ModelContext): WebMCP.ModelContext | undefined {
	// An explicitly supplied context is authoritative. Treat a malformed or
	// not-yet-ready value as unavailable instead of silently switching to a
	// different global surface that may belong to another host/document.
	if (context !== undefined) return readModelContext(() => context);
	const candidates: Array<() => unknown> = [];
	if (typeof document !== 'undefined') candidates.push(() => document.modelContext);
	if (typeof navigator !== 'undefined') {
		const navigatorWithModelContext = navigator as Navigator & { modelContext?: WebMCP.ModelContext };
		candidates.push(() => navigatorWithModelContext.modelContext);
	}
	if (typeof window !== 'undefined') {
		const windowWithModelContext = window as Window & { modelContext?: WebMCP.ModelContext };
		candidates.push(() => windowWithModelContext.modelContext);
	}
	const globalWithModelContext = globalThis as typeof globalThis & { modelContext?: WebMCP.ModelContext };
	candidates.push(() => globalWithModelContext.modelContext);
	for (const candidate of candidates) {
		const modelContext = readModelContext(candidate);
		if (modelContext) return modelContext;
	}
	return undefined;
}

function isUsableModelContext(context: unknown): context is WebMCP.ModelContext {
	if (!context || (typeof context !== 'object' && typeof context !== 'function')) return false;
	return typeof (context as { registerTool?: unknown }).registerTool === 'function';
}

function readModelContext(read: () => unknown): WebMCP.ModelContext | undefined {
	try {
		const context = read();
		return isUsableModelContext(context) ? context : undefined;
	} catch {
		// A host can expose the property before its permissions are ready. Keep
		// probing the remaining standard/legacy locations instead of failing the
		// registration effect from a throwing getter.
		return undefined;
	}
}

/**
 * Wait briefly for an embedded browser to finish installing its native
 * `document.modelContext` surface. Some hosts inject that surface after the
 * Astro document loads, so a single feature check during React hydration can
 * otherwise miss a valid WebMCP implementation forever.
 */
export function waitForNativeModelContext({
	timeoutMs = 10_000,
	pollIntervalMs = 50,
	signal,
}: WebMcpContextWaitOptions = {}): Promise<WebMCP.ModelContext | undefined> {
	const waitTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 10_000;
	const waitPollIntervalMs = Number.isFinite(pollIntervalMs) ? Math.max(10, pollIntervalMs) : 50;
	if (signal?.aborted) return Promise.resolve(undefined);
	const existing = getNativeModelContext();
	if (isUsableModelContext(existing)) return Promise.resolve(existing);

	return new Promise((resolve) => {
		let settled = false;
		let pollTimer: ReturnType<typeof setInterval> | undefined;
		let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

		const finish = (context?: WebMCP.ModelContext) => {
			if (settled) return;
			settled = true;
			if (pollTimer !== undefined) clearInterval(pollTimer);
			if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
			signal?.removeEventListener('abort', onAbort);
			resolve(context);
		};
		const poll = () => {
			const context = getNativeModelContext();
			if (isUsableModelContext(context)) finish(context);
		};
		const onAbort = () => finish();

		signal?.addEventListener('abort', onAbort, { once: true });
		if (signal?.aborted) {
			onAbort();
			return;
		}

		pollTimer = setInterval(poll, waitPollIntervalMs);
		timeoutTimer = setTimeout(() => {
			const context = getNativeModelContext();
			finish(isUsableModelContext(context) ? context : undefined);
		}, waitTimeoutMs);
	});
}

interface ToolOptions {
	/** Native Chrome currently omits callback options for direct executeTool calls. */
	signal?: AbortSignal;
}

const MAX_SOURCE_LENGTH = 200_000;
const MAX_EDIT_COUNT = 100;
const MAX_TRANSACTION_LENGTH = 128;
const MAX_TRACK_NAME_LENGTH = 120;
const MAX_KEY_LENGTH = 64;
const MAX_TEMPLATE_QUERY_LENGTH = 120;

const EMPTY_SCHEMA = {
	type: 'object',
	properties: {},
	additionalProperties: false,
} as const;

const TRACK_TARGET_SCHEMA = {
	trackNumber: { type: 'integer', minimum: 1 },
	trackId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
	trackName: { type: 'string', minLength: 1, maxLength: MAX_TRACK_NAME_LENGTH },
	name: { type: 'string', minLength: 1, maxLength: MAX_TRACK_NAME_LENGTH },
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

function readTemplateIdInput(value: unknown): { ok: true; templateId: string } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (typeof value !== 'string' || !value.trim()) return { ok: false, result: invalidInput('templateId must be a non-empty string.') };
	if (value.trim().length > MAX_TRANSACTION_LENGTH) return { ok: false, result: invalidInput(`templateId must contain 1-${MAX_TRANSACTION_LENGTH} characters.`) };
	return { ok: true, templateId: value.trim() };
}

function readTemplateListInput(value: unknown): { ok: true; query?: string; limit?: number } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	if (value.query !== undefined && (typeof value.query !== 'string' || value.query.length > MAX_TEMPLATE_QUERY_LENGTH)) {
		return { ok: false, result: invalidInput(`query must be a string of at most ${MAX_TEMPLATE_QUERY_LENGTH} characters.`) };
	}
	if (value.limit !== undefined && (!isInteger(value.limit) || value.limit < 1 || value.limit > 12)) {
		return { ok: false, result: invalidInput('limit must be an integer from 1 to 12.') };
	}
	return {
		ok: true,
		...(value.query === undefined ? {} : { query: value.query }),
		...(value.limit === undefined ? {} : { limit: value.limit }),
	};
}

function readTemplateLoadInput(value: unknown): { ok: true; input: WebMcpTemplateLoadInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	const template = readTemplateIdInput(value.templateId);
	if (!template.ok) return template;
	const revision = readRevisionInput(value.baseRevision);
	if (!revision.ok) return revision;
	const transaction = readTransactionInput(value.transactionId);
	if (!transaction.ok) return transaction;
	return { ok: true, input: { templateId: template.templateId, baseRevision: revision.revision, transactionId: transaction.transactionId } };
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

function readTrackTarget(value: Record<string, unknown>): { ok: true; target: WebMcpTrackTarget } | { ok: false; result: ReturnType<typeof invalidInput> } {
	const hasTrackNumber = value.trackNumber !== undefined;
	if (hasTrackNumber && (!isInteger(value.trackNumber) || value.trackNumber < 1)) return { ok: false, result: invalidInput('trackNumber must be a positive integer.') };

	const hasTrackId = value.trackId !== undefined;
	if (hasTrackId && (typeof value.trackId !== 'string' || !value.trackId.trim() || value.trackId.trim().length > MAX_TRANSACTION_LENGTH)) return { ok: false, result: invalidInput(`trackId must contain 1-${MAX_TRANSACTION_LENGTH} characters.`) };

	const hasTrackName = value.trackName !== undefined;
	const hasNameAlias = value.name !== undefined;
	if (hasTrackName && typeof value.trackName !== 'string') return { ok: false, result: invalidInput('trackName must be a non-empty string.') };
	if (hasNameAlias && typeof value.name !== 'string') return { ok: false, result: invalidInput('name must be a non-empty string.') };
	if (hasTrackName && hasNameAlias && value.trackName !== value.name) return { ok: false, result: invalidInput('trackName and name must identify the same track.') };

	const rawName = typeof value.trackName === 'string' ? value.trackName : typeof value.name === 'string' ? value.name : undefined;
	const trackName = rawName?.trim();
	if (trackName !== undefined && (!trackName || trackName.length > MAX_TRACK_NAME_LENGTH)) return { ok: false, result: invalidInput(`trackName must contain 1-${MAX_TRACK_NAME_LENGTH} characters.`) };
	if (!hasTrackNumber && !hasTrackId && !trackName) return { ok: false, result: invalidInput('Provide trackNumber, trackId, or trackName to identify a track.') };

	return {
		ok: true,
		target: {
			...(hasTrackNumber ? { trackNumber: value.trackNumber as number } : {}),
			...(hasTrackId ? { trackId: (value.trackId as string).trim() } : {}),
			...(trackName ? { trackName } : {}),
		},
	};
}

function readTrackMutationInput(value: unknown): { ok: true; input: WebMcpTrackMutationInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	const target = readTrackTarget(value);
	if (!target.ok) return target;
	const revision = readRevisionInput(value.baseRevision);
	if (!revision.ok) return revision;
	const transaction = readTransactionInput(value.transactionId);
	if (!transaction.ok) return transaction;
	return { ok: true, input: { ...target.target, baseRevision: revision.revision, transactionId: transaction.transactionId } };
}

function readTrackRenameInput(value: unknown): { ok: true; input: WebMcpTrackRenameInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	const mutation = readTrackMutationInput(value);
	if (!mutation.ok) return mutation;
	if (typeof value.newName !== 'string' || !value.newName.trim() || value.newName.trim().length > MAX_TRACK_NAME_LENGTH) return { ok: false, result: invalidInput(`newName must contain 1-${MAX_TRACK_NAME_LENGTH} characters.`) };
	return { ok: true, input: { ...mutation.input, newName: value.newName.trim() } };
}

function readTrackRangeInput(value: unknown): { ok: true; input: WebMcpTrackRangeInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	const mutation = readTrackMutationInput(value);
	if (!mutation.ok) return mutation;
	if (!isFiniteNumber(value.startCycle) || value.startCycle < 0) return { ok: false, result: invalidInput('startCycle must be a non-negative finite number.') };
	if (!isFiniteNumber(value.endCycle) || value.endCycle <= value.startCycle) return { ok: false, result: invalidInput('endCycle must be a finite number greater than startCycle.') };
	return { ok: true, input: { ...mutation.input, startCycle: value.startCycle, endCycle: value.endCycle } };
}

function readTempoInput(value: unknown): { ok: true; input: WebMcpTempoInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	if (!isFiniteNumber(value.bpm) || value.bpm < 0 || value.bpm > 300) return { ok: false, result: invalidInput('bpm must be a finite number from 0 to 300.') };
	const revision = readRevisionInput(value.baseRevision);
	if (!revision.ok) return revision;
	const transaction = readTransactionInput(value.transactionId);
	if (!transaction.ok) return transaction;
	return { ok: true, input: { bpm: value.bpm, baseRevision: revision.revision, transactionId: transaction.transactionId } };
}

function readKeyInput(value: unknown): { ok: true; input: WebMcpKeyInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	if (typeof value.key !== 'string' || !value.key.trim() || value.key.trim().length > MAX_KEY_LENGTH) return { ok: false, result: invalidInput(`key must contain 1-${MAX_KEY_LENGTH} characters.`) };
	const revision = readRevisionInput(value.baseRevision);
	if (!revision.ok) return revision;
	const transaction = readTransactionInput(value.transactionId);
	if (!transaction.ok) return transaction;
	return { ok: true, input: { key: value.key.trim(), baseRevision: revision.revision, transactionId: transaction.transactionId } };
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

function cancelled(options?: ToolOptions): { ok: false; error: WebMcpError } | undefined {
	return options?.signal?.aborted ? failed({ code: 'CANCELLED', message: 'The WebMCP tool call was cancelled.' }) : undefined;
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
		// Two insertions at the same UTF-16 offset have no deterministic order
		// unless the caller supplies one. Reject them instead of silently reversing
		// text based on the input array's incidental ordering.
		if (edit.start === previousStart && edit.end === edit.start) return failed({ code: 'OVERLAPPING_EDITS', message: 'Text edits must not overlap or share an insertion offset.' });
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

// Source, diagnostics, and runtime snapshots can contain user-authored code or
// content derived from it. Keep that provenance visible to an agent host while
// retaining read-only hints where the tool does not mutate the studio.
const READ_ONLY_SOURCE_ANNOTATIONS = { readOnlyHint: true, untrustedContentHint: true } as const;
const MUTATING_SOURCE_ANNOTATIONS = { readOnlyHint: false, untrustedContentHint: true } as const;
const READ_ONLY_REFERENCE_ANNOTATIONS = { readOnlyHint: true } as const;

function createTool<T extends Record<string, unknown>>(
	definition: Omit<WebMCP.ModelContextTool, 'execute'>,
	execute: (input: T, options?: ToolOptions) => WebMCP.MaybePromise<unknown>,
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
			annotations: READ_ONLY_SOURCE_ANNOTATIONS,
		}, (_input, options) => cancelled(options) ?? executeSafely(() => ({ ok: true, action: 'open_studio_session', state: controller.getState() }))),

		createTool({
			name: 'inspect_strudel_state',
			title: 'Inspect Strudel state',
			description: 'Inspect parsed source blocks, recognized source controls, diagnostics, and the derived Strudel runtime.',
			inputSchema: EMPTY_SCHEMA,
			annotations: READ_ONLY_SOURCE_ANNOTATIONS,
		}, (_input, options) => cancelled(options) ?? executeSafely(() => ({ ok: true, action: 'inspect_strudel_state', state: controller.getState() }))),

		createTool({
			name: 'read_strudel_source',
			title: 'Read Strudel source',
			description: 'Read the editable draft and last-valid Strudel source, including the current revision and diagnostics.',
			inputSchema: schema({ which: { type: 'string', enum: ['draft', 'lastValid'] } }),
			annotations: READ_ONLY_SOURCE_ANNOTATIONS,
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
			name: 'list_editor_templates',
			title: 'List Sushi editor templates',
			description: 'List the curated Sushi editor templates available to load, including each template’s stable ID, description, tempo, key, and lane count. Source text is omitted; use view_editor_template for a full source preview.',
			inputSchema: schema({ query: { type: 'string', maxLength: MAX_TEMPLATE_QUERY_LENGTH }, limit: { type: 'integer', minimum: 1, maximum: 12 } }),
			annotations: READ_ONLY_REFERENCE_ANNOTATIONS,
		}, (input: { query?: unknown; limit?: unknown }, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readTemplateListInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => ({
				ok: true,
				action: 'list_editor_templates',
				templates: listEditorPresets(parsed.query, parsed.limit) as EditorPresetSummary[],
			}));
		}),

		createTool({
			name: 'view_editor_template',
			title: 'View a Sushi editor template',
			description: 'Read one curated Sushi editor template’s metadata and complete Strudel source without changing the current project.',
			inputSchema: schema({ templateId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH } }, ['templateId']),
			annotations: READ_ONLY_SOURCE_ANNOTATIONS,
		}, (input: { templateId?: unknown }, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readTemplateIdInput(input.templateId);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => {
				const preset = getEditorPreset(parsed.templateId);
				if (!preset) return failed({ code: 'TEMPLATE_NOT_FOUND', message: `No editor template exists with ID ${JSON.stringify(parsed.templateId)}.` });
				const summary: EditorPresetSummary = summarizeEditorPreset(preset);
				return { ok: true, action: 'view_editor_template', template: { ...summary, source: preset.source } };
			});
		}),

		createTool({
			name: 'load_editor_template',
			title: 'Load a Sushi editor template',
			description: 'Replace the current source with a curated Sushi editor template and activate it after Strudel validation. Requires the current source revision and an idempotency transaction ID.',
			inputSchema: schema({
				templateId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
				baseRevision: { type: 'integer', minimum: 0 },
				transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
			}, ['templateId', 'baseRevision', 'transactionId']),
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readTemplateLoadInput(input);
			if (!parsed.ok) return parsed.result;
			if (!getEditorPreset(parsed.input.templateId)) return failed({ code: 'TEMPLATE_NOT_FOUND', message: `No editor template exists with ID ${JSON.stringify(parsed.input.templateId)}.` });
			return executeSafely(() => controller.loadTemplate(parsed.input));
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
			annotations: MUTATING_SOURCE_ANNOTATIONS,
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
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readPatchInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.patchSource(parsed.input));
		}),

		createTool({
			name: 'set_tempo',
			title: 'Set BPM',
			description: 'Set the source tempo from 0 to 300 BPM. Sushi writes this as setcpm(bpm / quarterNotesPerCycle) and validates it through Strudel.',
			inputSchema: schema({
				bpm: { type: 'number', minimum: 0, maximum: 300 },
				baseRevision: { type: 'integer', minimum: 0 },
				transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
			}, ['bpm', 'baseRevision', 'transactionId']),
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readTempoInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.setTempo(parsed.input));
		}),

		createTool({
			name: 'set_key',
			title: 'Set musical key',
			description: 'Update the canonical const key source declaration and validate it through Strudel.',
			inputSchema: schema({
				key: { type: 'string', minLength: 1, maxLength: MAX_KEY_LENGTH },
				baseRevision: { type: 'integer', minimum: 0 },
				transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
			}, ['key', 'baseRevision', 'transactionId']),
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readKeyInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.setKey(parsed.input));
		}),

		createTool({
			name: 'delete_track',
			title: 'Delete track',
			description: 'Delete a source-defined track by ID, 1-based track number, or exact track name. Requires the current source revision.',
			inputSchema: schema({
				...TRACK_TARGET_SCHEMA,
				baseRevision: { type: 'integer', minimum: 0 },
				transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
			}, ['baseRevision', 'transactionId']),
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readTrackMutationInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.deleteTrack(parsed.input));
		}),

		createTool({
			name: 'rename_track',
			title: 'Rename track',
			description: 'Rename a source-defined track by ID, 1-based track number, or exact track name. The new name is written into the Sushi source marker.',
			inputSchema: schema({
				...TRACK_TARGET_SCHEMA,
				newName: { type: 'string', minLength: 1, maxLength: MAX_TRACK_NAME_LENGTH },
				baseRevision: { type: 'integer', minimum: 0 },
				transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
			}, ['newName', 'baseRevision', 'transactionId']),
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readTrackRenameInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.renameTrack(parsed.input));
		}),

		createTool({
			name: 'set_track_range',
			title: 'Set track range',
			description: 'Move or resize a track by ID, 1-based track number, or exact track name to exact musical cycle boundaries. Use 0.25 increments for quarter-bar precision; in the default four-quarter-note cycle, cycle 1 is the start of bar 2.',
			inputSchema: schema({
				...TRACK_TARGET_SCHEMA,
				startCycle: { type: 'number', minimum: 0 },
				endCycle: { type: 'number', minimum: 0 },
				baseRevision: { type: 'integer', minimum: 0 },
				transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
			}, ['startCycle', 'endCycle', 'baseRevision', 'transactionId']),
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readTrackRangeInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.setTrackRange(parsed.input));
		}),

		createTool({
			name: 'extend_timeline',
			title: 'Extend timeline',
			description: 'Advance the editable timeline by the next 30-bar page, capped at the 137-bar maximum. This changes project timeline metadata without changing source text.',
			inputSchema: schema({
				baseRevision: { type: 'integer', minimum: 0 },
				transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH },
			}, ['baseRevision', 'transactionId']),
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readRevisionTransactionInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.extendTimeline(parsed.input));
		}),

		createTool({
			name: 'validate_strudel_source',
			title: 'Validate Strudel source',
			description: 'Evaluate candidate Strudel source for diagnostics without changing the project draft or active revision.',
			inputSchema: schema({ source: { type: 'string', maxLength: MAX_SOURCE_LENGTH } }),
			annotations: READ_ONLY_SOURCE_ANNOTATIONS,
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
			annotations: READ_ONLY_REFERENCE_ANNOTATIONS,
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
			annotations: MUTATING_SOURCE_ANNOTATIONS,
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
			annotations: MUTATING_SOURCE_ANNOTATIONS,
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
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readRevisionTransactionInput(input);
			if (!parsed.ok) return parsed.result;
			return executeSafely(() => controller.redoSourceEdit(parsed.input));
		}),
	];
}

export async function registerWebMcpTools(
	controller: WebMcpController,
	context?: WebMCP.ModelContext,
	options: WebMcpRegistrationOptions = {},
): Promise<WebMcpRegistration> {
	if (options.signal?.aborted) return { available: false, toolNames: [], dispose: () => undefined };
	const modelContext = getNativeModelContext(context);
	if (!modelContext) return { available: false, toolNames: [], dispose: () => undefined };

	const abortController = new AbortController();
	const tools = createWebMcpTools(controller);
	const abortRegistration = () => abortController.abort();
	const dispose = () => {
		options.signal?.removeEventListener('abort', abortRegistration);
		abortController.abort();
	};
	options.signal?.addEventListener('abort', abortRegistration, { once: true });
	try {
		for (const tool of tools) {
			if (abortController.signal.aborted) {
				dispose();
				return { available: false, toolNames: [], error: 'WebMCP registration was cancelled.', dispose };
			}
			await awaitAbortableRegistration(modelContext.registerTool(tool, { signal: abortController.signal }), abortController.signal);
		}
		if (abortController.signal.aborted) {
			dispose();
			return { available: false, toolNames: [], error: 'WebMCP registration was cancelled.', dispose };
		}
		return {
			available: true,
			toolNames: tools.map((tool) => tool.name),
			dispose,
		};
	} catch (error) {
		dispose();
		return { available: false, toolNames: [], error: messageFromError(error), dispose };
	}
}

/**
 * A host should resolve `registerTool()` quickly, but an embedded bridge can
 * disappear while registration is in flight. Race the host promise against
 * our lifecycle signal so teardown never waits forever for a dead bridge.
 */
function awaitAbortableRegistration(operation: Promise<void>, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => signal.removeEventListener('abort', onAbort);
		const settle = (callback: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};
		const onAbort = () => settle(resolve);
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		Promise.resolve(operation).then(
			() => settle(resolve),
			(error) => settle(() => reject(error)),
		);
	});
}
