/// <reference types="webmcp-types" />

import type { SourceDiagnostic, RuntimeState } from '../project/model';
import type { SourceBlockDetails, SourceMidiRoute, TrackTiming } from '../project/source-mapper';
import { isMidiChannel, normalizeMidiChannel, normalizeMidiQuantizeGrid, type MidiChannel, type MidiClockMode, type MidiRecordMode, type MidiQuantizeGrid, type MidiRecordedTake, type MidiRecordingOptions, type MidiRuntimeState } from '../midi/types';
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
	'get_midi_capabilities',
	'list_midi_devices',
	'inspect_midi_state',
	'read_midi_take',
	'request_midi_access',
	'select_midi_input',
	'select_midi_output',
	'set_midi_settings',
	'learn_midi_control',
	'set_track_midi_route',
	'arm_midi_recording',
	'start_midi_recording',
	'stop_midi_recording',
	'cancel_midi_recording',
	'accept_midi_take',
	'panic_midi',
	'send_midi_test_note',
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
	instrument?: string;
	muted: boolean;
	soloed: boolean;
	midi?: SourceMidiRoute;
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
	midi: MidiRuntimeState;
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

export interface WebMcpMidiRouteInput extends WebMcpTrackMutationInput {
	output?: string | null;
	channel: number;
	instrument?: string | null;
	enabled: boolean;
	velocity?: number | null;
	gain?: number | null;
	noteOffsetMs?: number | null;
	midimap?: string | null;
	program?: number | null;
}

export interface WebMcpMidiAccessInput {
	sysex: boolean;
}

export interface WebMcpMidiSelectionInput {
	id: string | null;
}

export interface WebMcpMidiSettingsInput {
	inputChannel?: MidiChannel;
	outputChannel?: number;
	monitor?: boolean;
	clockMode?: MidiClockMode;
}

export interface WebMcpMidiRecordInput {
	trackId: string;
	inputId?: string;
	channel?: MidiChannel;
	mode?: MidiRecordMode;
	quantize?: MidiQuantizeGrid;
	quantizeStrength?: number;
	swing?: number;
	countInBars?: 0 | 1 | 2;
	loop?: boolean;
	captureAutomation?: boolean;
}

export interface WebMcpMidiTakeAcceptInput {
	baseRevision: number;
	transactionId: string;
}

export interface SourcePatchInput {
	edits: SourceTextEdit[];
	baseRevision: number;
	transactionId: string;
}

export interface WebMcpMidiController {
	getState: () => MidiRuntimeState;
	connect: (options: WebMcpMidiAccessInput) => Promise<MidiRuntimeState>;
	disconnect: () => Promise<MidiRuntimeState>;
	selectInput: (id: string | null) => MidiRuntimeState;
	selectOutput: (id: string | null) => MidiRuntimeState;
	setSettings: (settings: WebMcpMidiSettingsInput) => MidiRuntimeState;
	learnControl: () => MidiRuntimeState;
	armRecording: (options: WebMcpMidiRecordInput) => MidiRuntimeState;
	startRecording: (signal?: AbortSignal) => Promise<MidiRuntimeState>;
	stopRecording: () => Promise<MidiRuntimeState>;
	cancelRecording: () => MidiRuntimeState;
	acceptTake: (input: WebMcpMidiTakeAcceptInput) => Promise<WebMcpMutationResult>;
	panic: (outputId?: string | null) => MidiRuntimeState;
	testNote: (note?: number, durationMs?: number, velocity?: number) => Promise<MidiRuntimeState>;
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
	setTrackMidiRoute?: (input: WebMcpMidiRouteInput) => Promise<WebMcpMutationResult>;
	midi?: WebMcpMidiController;
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
const MAX_MIDI_PORT_ID_LENGTH = 256;
const MAX_MIDI_TAKE_NOTES = 2048;

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

function readMidiAccessInput(value: unknown): { ok: true; input: WebMcpMidiAccessInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	if (value.sysex !== undefined && typeof value.sysex !== 'boolean') return { ok: false, result: invalidInput('sysex must be a boolean.') };
	return { ok: true, input: { sysex: value.sysex === true } };
}

function readMidiSelectionInput(value: unknown, field: 'inputId' | 'outputId'): { ok: true; id: string | null } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	const raw = value[field];
	if (raw === undefined) return { ok: false, result: invalidInput(`${field} is required.`) };
	if (raw !== null && (typeof raw !== 'string' || raw.length > MAX_MIDI_PORT_ID_LENGTH)) return { ok: false, result: invalidInput(`${field} must be null or a string of at most ${MAX_MIDI_PORT_ID_LENGTH} characters.`) };
	return { ok: true, id: typeof raw === 'string' && raw.trim() ? raw.trim() : null };
}

function readMidiSettingsInput(value: unknown): { ok: true; input: WebMcpMidiSettingsInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	if (value.inputChannel !== undefined && value.inputChannel !== 'all' && !isMidiChannel(value.inputChannel)) return { ok: false, result: invalidInput('inputChannel must be all or an integer from 1 to 16.') };
	if (value.outputChannel !== undefined && (!isInteger(value.outputChannel) || value.outputChannel < 1 || value.outputChannel > 16)) return { ok: false, result: invalidInput('outputChannel must be an integer from 1 to 16.') };
	if (value.monitor !== undefined && typeof value.monitor !== 'boolean') return { ok: false, result: invalidInput('monitor must be a boolean.') };
	if (value.clockMode !== undefined && value.clockMode !== 'off' && value.clockMode !== 'send' && value.clockMode !== 'receive') return { ok: false, result: invalidInput('clockMode must be off, send, or receive.') };
	return {
		ok: true,
		input: {
			...(value.inputChannel === undefined ? {} : { inputChannel: normalizeMidiChannel(value.inputChannel) }),
			...(value.outputChannel === undefined ? {} : { outputChannel: value.outputChannel as number }),
			...(value.monitor === undefined ? {} : { monitor: value.monitor as boolean }),
			...(value.clockMode === undefined ? {} : { clockMode: value.clockMode as MidiClockMode }),
		},
	};
}

function readMidiRecordInput(value: unknown): { ok: true; input: WebMcpMidiRecordInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	if (typeof value.trackId !== 'string' || !value.trackId.trim() || value.trackId.length > MAX_TRANSACTION_LENGTH) return { ok: false, result: invalidInput('trackId must be a non-empty string.') };
	if (value.inputId !== undefined && (typeof value.inputId !== 'string' || value.inputId.length > MAX_MIDI_PORT_ID_LENGTH)) return { ok: false, result: invalidInput(`inputId must be a string of at most ${MAX_MIDI_PORT_ID_LENGTH} characters.`) };
	if (value.channel !== undefined && value.channel !== 'all' && !isMidiChannel(value.channel)) return { ok: false, result: invalidInput('channel must be all or an integer from 1 to 16.') };
	if (value.mode !== undefined && value.mode !== 'replace' && value.mode !== 'overdub') return { ok: false, result: invalidInput('mode must be replace or overdub.') };
	if (value.quantize !== undefined && !['off', '1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T', '1/32T'].includes(String(value.quantize))) return { ok: false, result: invalidInput('quantize must be off, 1/4, 1/8, 1/16, 1/32, 1/8T, 1/16T, or 1/32T.') };
	if (value.quantizeStrength !== undefined && (!isFiniteNumber(value.quantizeStrength) || value.quantizeStrength < 0 || value.quantizeStrength > 1)) return { ok: false, result: invalidInput('quantizeStrength must be between 0 and 1.') };
	if (value.swing !== undefined && (!isFiniteNumber(value.swing) || value.swing < 0 || value.swing > 0.5)) return { ok: false, result: invalidInput('swing must be between 0 and 0.5.') };
	if (value.countInBars !== undefined && value.countInBars !== 0 && value.countInBars !== 1 && value.countInBars !== 2) return { ok: false, result: invalidInput('countInBars must be 0, 1, or 2.') };
	if (value.loop !== undefined && typeof value.loop !== 'boolean') return { ok: false, result: invalidInput('loop must be a boolean.') };
	if (value.captureAutomation !== undefined && typeof value.captureAutomation !== 'boolean') return { ok: false, result: invalidInput('captureAutomation must be a boolean.') };
	return {
		ok: true,
		input: {
			trackId: value.trackId.trim(),
			...(value.inputId === undefined ? {} : { inputId: (value.inputId as string).trim() }),
			...(value.channel === undefined ? {} : { channel: normalizeMidiChannel(value.channel) }),
			...(value.mode === undefined ? {} : { mode: value.mode as MidiRecordMode }),
			...(value.quantize === undefined ? {} : { quantize: normalizeMidiQuantizeGrid(value.quantize) }),
			...(value.quantizeStrength === undefined ? {} : { quantizeStrength: value.quantizeStrength as number }),
			...(value.swing === undefined ? {} : { swing: value.swing as number }),
			...(value.countInBars === undefined ? {} : { countInBars: value.countInBars as 0 | 1 | 2 }),
			...(value.loop === undefined ? {} : { loop: value.loop as boolean }),
			...(value.captureAutomation === undefined ? {} : { captureAutomation: value.captureAutomation as boolean }),
		},
	};
}

function readMidiRouteInput(value: unknown): { ok: true; input: WebMcpMidiRouteInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	const mutation = readTrackMutationInput(value);
	if (!mutation.ok) return mutation;
	if (value.output !== undefined && value.output !== null && (typeof value.output !== 'string' || value.output.length > MAX_MIDI_PORT_ID_LENGTH)) return { ok: false, result: invalidInput(`output must be null or a string of at most ${MAX_MIDI_PORT_ID_LENGTH} characters.`) };
	if (value.instrument !== undefined && value.instrument !== null && (typeof value.instrument !== 'string' || value.instrument.length > MAX_MIDI_PORT_ID_LENGTH || /[\r\n]/.test(value.instrument))) return { ok: false, result: invalidInput(`instrument must be null or a single-line string of at most ${MAX_MIDI_PORT_ID_LENGTH} characters.`) };
	if (!isInteger(value.channel) || value.channel < 1 || value.channel > 16) return { ok: false, result: invalidInput('channel must be an integer from 1 to 16.') };
	if (typeof value.enabled !== 'boolean') return { ok: false, result: invalidInput('enabled must be a boolean.') };
	if (value.velocity !== undefined && value.velocity !== null && (!isFiniteNumber(value.velocity) || value.velocity < 0 || value.velocity > 1)) return { ok: false, result: invalidInput('velocity must be null or a number from 0 to 1.') };
	if (value.gain !== undefined && value.gain !== null && (!isFiniteNumber(value.gain) || value.gain < 0 || value.gain > 1)) return { ok: false, result: invalidInput('gain must be null or a number from 0 to 1.') };
	if (value.noteOffsetMs !== undefined && value.noteOffsetMs !== null && (!isFiniteNumber(value.noteOffsetMs) || value.noteOffsetMs < 0 || value.noteOffsetMs > 10_000)) return { ok: false, result: invalidInput('noteOffsetMs must be null or a number from 0 to 10000.') };
	if (value.midimap !== undefined && value.midimap !== null && (typeof value.midimap !== 'string' || value.midimap.length > MAX_MIDI_PORT_ID_LENGTH)) return { ok: false, result: invalidInput(`midimap must be null or a string of at most ${MAX_MIDI_PORT_ID_LENGTH} characters.`) };
	if (value.program !== undefined && value.program !== null && (!isInteger(value.program) || value.program < 0 || value.program > 127)) return { ok: false, result: invalidInput('program must be null or an integer from 0 to 127.') };
	return {
		ok: true,
		input: {
			...mutation.input,
			...(value.output === undefined ? {} : { output: typeof value.output === 'string' && value.output.trim() ? value.output.trim() : null }),
			...(value.instrument === undefined ? {} : { instrument: typeof value.instrument === 'string' && value.instrument.trim() ? value.instrument.trim() : null }),
			channel: value.channel,
			enabled: value.enabled,
			...(value.velocity === undefined ? {} : { velocity: value.velocity as number | null }),
			...(value.gain === undefined ? {} : { gain: value.gain as number | null }),
			...(value.noteOffsetMs === undefined ? {} : { noteOffsetMs: value.noteOffsetMs as number | null }),
			...(value.midimap === undefined ? {} : { midimap: typeof value.midimap === 'string' ? value.midimap.trim() || null : null }),
			...(value.program === undefined ? {} : { program: value.program as number | null }),
		},
	};
}

function readMidiTakeAcceptInput(value: unknown): { ok: true; input: WebMcpMidiTakeAcceptInput } | { ok: false; result: ReturnType<typeof invalidInput> } {
	const parsed = readRevisionTransactionInput(value);
	if (!parsed.ok) return parsed;
	return { ok: true, input: { baseRevision: parsed.input.baseRevision, transactionId: parsed.input.transactionId } };
}

function readMidiTestNoteInput(value: unknown): { ok: true; note?: number; velocity?: number; durationMs?: number } | { ok: false; result: ReturnType<typeof invalidInput> } {
	if (!isRecord(value)) return { ok: false, result: invalidInput('Tool input must be an object.') };
	if (value.note !== undefined && (!isInteger(value.note) || value.note < 0 || value.note > 127)) return { ok: false, result: invalidInput('note must be an integer from 0 to 127.') };
	if (value.velocity !== undefined && (!isFiniteNumber(value.velocity) || value.velocity < 0 || value.velocity > 1)) return { ok: false, result: invalidInput('velocity must be between 0 and 1.') };
	if (value.durationMs !== undefined && (!isFiniteNumber(value.durationMs) || value.durationMs < 1 || value.durationMs > 10_000)) return { ok: false, result: invalidInput('durationMs must be between 1 and 10000.') };
	return { ok: true, ...(value.note === undefined ? {} : { note: value.note as number }), ...(value.velocity === undefined ? {} : { velocity: value.velocity as number }), ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs as number }) };
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

function midiUnavailable(controller: WebMcpController): { ok: false; error: WebMcpError } {
	const state = controller.getState();
	return failed({ code: 'MIDI_UNAVAILABLE', message: state.midi.supported ? 'MIDI is not connected or the MIDI controller is not ready.' : 'This browser does not expose Web MIDI.' });
}

function midiUserGestureRequired(): { ok: false; error: WebMcpError } | undefined {
	if (typeof navigator === 'undefined') return undefined;
	const activation = (navigator as Navigator & { userActivation?: { isActive?: boolean } }).userActivation;
	return activation && activation.isActive !== true
		? failed({ code: 'MIDI_USER_GESTURE_REQUIRED', message: 'The browser requires a user gesture. Press Connect MIDI or the hardware action button in Sushi before asking an agent to continue.' })
		: undefined;
}

function boundedMidiTake(take: MidiRecordedTake, limit: number): MidiRecordedTake {
	const notes = take.notes.slice(0, limit);
	const automation = take.automation.slice(0, limit).map((event) => ({ ...event, data: event.data.slice(0, 256) }));
	const dataTruncated = take.automation.slice(0, limit).some((event) => event.data.length > 256);
	return {
		...take,
		notes,
		automation,
		truncated: take.truncated === true || notes.length < take.notes.length || automation.length < take.automation.length || dataTruncated,
	};
}

function boundedMidiState(state: MidiRuntimeState, limit = 256): MidiRuntimeState {
	if (!state.recording.take) return state;
	return { ...state, recording: { ...state.recording, take: boundedMidiTake(state.recording.take, limit) } };
}

function midiStateResult(action: string, state: MidiRuntimeState): Record<string, unknown> {
	const boundedState = boundedMidiState(state);
	const stateError = state.lastError;
	const lifecycleError = action === 'arm_midi_recording' && state.recording.status !== 'armed'
		? { code: 'MIDI_RECORD_ARM_FAILED', message: 'MIDI recording was not armed.' }
		: action === 'start_midi_recording' && state.recording.status !== 'recording'
			? { code: 'MIDI_RECORD_START_FAILED', message: 'MIDI recording could not start; a user gesture and an armed input may be required.' }
			: action === 'stop_midi_recording' && state.recording.status !== 'review'
				? { code: 'MIDI_RECORD_STOP_FAILED', message: 'There is no active MIDI recording to stop.' }
				: undefined;
	const error = stateError ?? lifecycleError;
	return { ok: !error, action, midi: boundedState, ...(error ? { error } : {}) };
}

const MIDI_WEBMCP_TOOL_NAMES = new Set<WebMcpToolName>([
	'get_midi_capabilities',
	'list_midi_devices',
	'inspect_midi_state',
	'read_midi_take',
	'request_midi_access',
	'select_midi_input',
	'select_midi_output',
	'set_midi_settings',
	'learn_midi_control',
	'set_track_midi_route',
	'arm_midi_recording',
	'start_midi_recording',
	'stop_midi_recording',
	'cancel_midi_recording',
	'accept_midi_take',
	'panic_midi',
	'send_midi_test_note',
]);

export function createWebMcpTools(controller: WebMcpController): WebMCP.ModelContextTool[] {
	const executeSafely = async (operation: () => WebMCP.MaybePromise<unknown>) => {
		try {
			return await operation();
		} catch (error) {
			return failed({ code: 'INTERNAL_ERROR', message: messageFromError(error) });
		}
	};

	const tools = [
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

		createTool({
			name: 'get_midi_capabilities',
			title: 'Get MIDI capabilities',
			description: 'Report Web MIDI support, secure-context status, permission state, SysEx capability, and current connection status. This is read-only and never requests permission.',
			inputSchema: EMPTY_SCHEMA,
			annotations: READ_ONLY_REFERENCE_ANNOTATIONS,
		}, (_input, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			return executeSafely(() => {
				const midi = controller.getState().midi;
				const limitations = [
					...(midi.supported ? [] : ['The current browser does not expose Web MIDI.']),
					...(midi.secureContext ? [] : ['Web MIDI requires HTTPS or localhost.']),
					...(midi.permission === 'denied' ? ['The browser denied MIDI permission.'] : []),
					...(midi.permission === 'unsupported' ? ['The browser does not support MIDI permissions.'] : []),
				];
				return { ok: true, action: 'get_midi_capabilities', capabilities: { supported: midi.supported, secureContext: midi.secureContext, permission: midi.permission, enabled: midi.enabled, sysexEnabled: midi.sysexEnabled, limitations } };
			});
		}),

		createTool({
			name: 'list_midi_devices',
			title: 'List MIDI devices',
			description: 'List the currently connected MIDI input and output ports visible to Sushi. Device IDs are session-scoped and should not be treated as permanent hardware identities.',
			inputSchema: EMPTY_SCHEMA,
			annotations: READ_ONLY_SOURCE_ANNOTATIONS,
		}, (_input, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			return executeSafely(() => {
				const midi = controller.getState().midi;
				return { ok: true, action: 'list_midi_devices', inputs: midi.inputs, outputs: midi.outputs, permission: midi.permission, enabled: midi.enabled };
			});
		}),

		createTool({
			name: 'inspect_midi_state',
			title: 'Inspect MIDI state',
			description: 'Inspect selected MIDI ports, channels, monitor/clock settings, recording state, recent activity, and the last MIDI error.',
			inputSchema: EMPTY_SCHEMA,
			annotations: READ_ONLY_SOURCE_ANNOTATIONS,
		}, (_input, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			return executeSafely(() => ({ ok: true, action: 'inspect_midi_state', midi: boundedMidiState(controller.getState().midi) }));
		}),

		createTool({
			name: 'read_midi_take',
			title: 'Read MIDI take',
			description: 'Read a bounded summary of the MIDI take currently in review. This does not commit or alter the source.',
			inputSchema: EMPTY_SCHEMA,
			annotations: READ_ONLY_SOURCE_ANNOTATIONS,
		}, (_input, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			return executeSafely(() => {
				const state = controller.getState().midi;
				const take = state.recording.take;
				if (!take) return failed({ code: 'MIDI_TAKE_NOT_AVAILABLE', message: 'There is no MIDI take in review.' });
				return { ok: true, action: 'read_midi_take', take: boundedMidiTake(take, MAX_MIDI_TAKE_NOTES) };
			});
		}),

		createTool({
			name: 'request_midi_access',
			title: 'Request MIDI access',
			description: 'Request browser MIDI permission after explicit user intent. WebMCP cannot bypass a browser permission prompt; the result reports the required user action when permission is unavailable.',
			inputSchema: schema({ sysex: { type: 'boolean', default: false } }),
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readMidiAccessInput(input);
			if (!parsed.ok) return parsed.result;
			const gestureRequired = midiUserGestureRequired();
			if (gestureRequired) return gestureRequired;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(async () => {
				const state = await controller.midi?.connect(parsed.input);
				if (!state) return midiUnavailable(controller);
				return midiStateResult('request_midi_access', state);
			});
		}),

		createTool({
			name: 'select_midi_input',
			title: 'Select MIDI input',
			description: 'Select a connected MIDI input by session-scoped ID or exact port name, or pass null to clear the selection.',
			inputSchema: schema({ inputId: { oneOf: [{ type: 'string', maxLength: MAX_MIDI_PORT_ID_LENGTH }, { type: 'null' }] } }, ['inputId']),
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readMidiSelectionInput(input, 'inputId');
			if (!parsed.ok) return parsed.result;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(() => midiStateResult('select_midi_input', controller.midi?.selectInput(parsed.id) ?? controller.getState().midi));
		}),

		createTool({
			name: 'select_midi_output',
			title: 'Select MIDI output',
			description: 'Select a connected MIDI output by session-scoped ID or exact port name, or pass null to clear the selection.',
			inputSchema: schema({ outputId: { oneOf: [{ type: 'string', maxLength: MAX_MIDI_PORT_ID_LENGTH }, { type: 'null' }] } }, ['outputId']),
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readMidiSelectionInput(input, 'outputId');
			if (!parsed.ok) return parsed.result;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(() => midiStateResult('select_midi_output', controller.midi?.selectOutput(parsed.id) ?? controller.getState().midi));
		}),

		createTool({
			name: 'set_midi_settings',
			title: 'Set MIDI settings',
			description: 'Set MIDI input channel, output channel, monitor/thru, or clock mode. This changes runtime settings, not source revision.',
			inputSchema: schema({ inputChannel: { oneOf: [{ type: 'integer', minimum: 1, maximum: 16 }, { type: 'string', enum: ['all'] }] }, outputChannel: { type: 'integer', minimum: 1, maximum: 16 }, monitor: { type: 'boolean' }, clockMode: { type: 'string', enum: ['off', 'send', 'receive'] } }),
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readMidiSettingsInput(input);
			if (!parsed.ok) return parsed.result;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(() => midiStateResult('set_midi_settings', controller.midi?.setSettings(parsed.input) ?? controller.getState().midi));
		}),

		createTool({
			name: 'learn_midi_control',
			title: 'Learn MIDI controller',
			description: 'Arm the shared MIDI service to capture the next incoming CC message for UI/source mapping. This does not change source revision or send hardware output.',
			inputSchema: EMPTY_SCHEMA,
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (_input, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(() => midiStateResult('learn_midi_control', controller.midi?.learnControl() ?? controller.getState().midi));
		}),

		createTool({
			name: 'set_track_midi_route',
			title: 'Set track MIDI route',
			description: 'Write a track’s native Strudel .midichan()/.midi() route, optional local instrument, and velocity/gain/note-off/program settings. Requires a current source revision and idempotency transaction ID; the change affects external hardware when playback runs.',
			inputSchema: schema({ ...TRACK_TARGET_SCHEMA, output: { oneOf: [{ type: 'string', maxLength: MAX_MIDI_PORT_ID_LENGTH }, { type: 'null' }] }, instrument: { oneOf: [{ type: 'string', maxLength: MAX_MIDI_PORT_ID_LENGTH }, { type: 'null' }] }, channel: { type: 'integer', minimum: 1, maximum: 16 }, enabled: { type: 'boolean' }, velocity: { oneOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] }, gain: { oneOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] }, noteOffsetMs: { oneOf: [{ type: 'number', minimum: 0, maximum: 10000 }, { type: 'null' }] }, midimap: { oneOf: [{ type: 'string', maxLength: MAX_MIDI_PORT_ID_LENGTH }, { type: 'null' }] }, program: { oneOf: [{ type: 'integer', minimum: 0, maximum: 127 }, { type: 'null' }] }, baseRevision: { type: 'integer', minimum: 0 }, transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH } }, ['channel', 'enabled', 'baseRevision', 'transactionId']),
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readMidiRouteInput(input);
			if (!parsed.ok) return parsed.result;
			if (!controller.setTrackMidiRoute) return midiUnavailable(controller);
			return executeSafely(() => controller.setTrackMidiRoute?.(parsed.input));
		}),

		createTool({
			name: 'arm_midi_recording',
			title: 'Arm MIDI recording',
			description: 'Arm a source track for MIDI note/automation recording with optional input ID/name, quantization, count-in, loop, and overdub settings. Arming does not change source revision.',
			inputSchema: schema({ trackId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH }, inputId: { type: 'string', maxLength: MAX_MIDI_PORT_ID_LENGTH }, channel: { oneOf: [{ type: 'integer', minimum: 1, maximum: 16 }, { type: 'string', enum: ['all'] }] }, mode: { type: 'string', enum: ['replace', 'overdub'] }, quantize: { type: 'string', enum: ['off', '1/4', '1/8', '1/16', '1/32', '1/8T', '1/16T', '1/32T'] }, quantizeStrength: { type: 'number', minimum: 0, maximum: 1 }, swing: { type: 'number', minimum: 0, maximum: 0.5 }, countInBars: { type: 'integer', enum: [0, 1, 2] }, loop: { type: 'boolean' }, captureAutomation: { type: 'boolean' } }, ['trackId']),
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readMidiRecordInput(input);
			if (!parsed.ok) return parsed.result;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(() => midiStateResult('arm_midi_recording', controller.midi?.armRecording(parsed.input) ?? controller.getState().midi));
		}),

		createTool({
			name: 'start_midi_recording',
			title: 'Start MIDI recording',
			description: 'Start the armed MIDI recording using Sushi’s transport clock. Browser audio/MIDI user-gesture restrictions may require the user to press Start in the page.',
			inputSchema: EMPTY_SCHEMA,
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (_input, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const gestureRequired = midiUserGestureRequired();
			if (gestureRequired) return gestureRequired;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(async () => midiStateResult('start_midi_recording', await controller.midi!.startRecording(options?.signal)));
		}),

		createTool({
			name: 'stop_midi_recording',
			title: 'Stop MIDI recording',
			description: 'Stop the active MIDI recording and leave the bounded take in review; it does not write source until accept_midi_take is called.',
			inputSchema: EMPTY_SCHEMA,
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (_input, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(async () => midiStateResult('stop_midi_recording', await controller.midi!.stopRecording()));
		}),

		createTool({
			name: 'cancel_midi_recording',
			title: 'Cancel MIDI recording',
			description: 'Cancel an armed, counting-in, active, or reviewed MIDI take without changing source.',
			inputSchema: EMPTY_SCHEMA,
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (_input, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(() => midiStateResult('cancel_midi_recording', controller.midi?.cancelRecording() ?? controller.getState().midi));
		}),

		createTool({
			name: 'accept_midi_take',
			title: 'Accept MIDI take',
			description: 'Serialize the reviewed MIDI take as native Strudel source and commit it as one revision-safe source transaction.',
			inputSchema: schema({ baseRevision: { type: 'integer', minimum: 0 }, transactionId: { type: 'string', minLength: 1, maxLength: MAX_TRANSACTION_LENGTH } }, ['baseRevision', 'transactionId']),
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readMidiTakeAcceptInput(input);
			if (!parsed.ok) return parsed.result;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(() => controller.midi!.acceptTake(parsed.input));
		}),

		createTool({
			name: 'panic_midi',
			title: 'Panic MIDI outputs',
			description: 'Send stop, all sound off, all notes off, and reset controllers to selected or all connected MIDI outputs. An optional output ID or exact name targets one port. This affects external hardware immediately.',
			inputSchema: schema({ outputId: { oneOf: [{ type: 'string', maxLength: MAX_MIDI_PORT_ID_LENGTH }, { type: 'null' }] } }),
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			if (input.outputId !== undefined && input.outputId !== null && (typeof input.outputId !== 'string' || input.outputId.length > MAX_MIDI_PORT_ID_LENGTH)) return invalidInput('outputId must be null or a string of at most 256 characters.');
			const gestureRequired = midiUserGestureRequired();
			if (gestureRequired) return gestureRequired;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(() => midiStateResult('panic_midi', controller.midi?.panic(input.outputId as string | null | undefined) ?? controller.getState().midi));
		}),

		createTool({
			name: 'send_midi_test_note',
			title: 'Send MIDI test note',
			description: 'Send one short test note to the selected MIDI output. This is an explicit external-hardware action.',
			inputSchema: schema({ note: { type: 'integer', minimum: 0, maximum: 127 }, velocity: { type: 'number', minimum: 0, maximum: 1 }, durationMs: { type: 'number', minimum: 1, maximum: 10000 } }),
			annotations: MUTATING_SOURCE_ANNOTATIONS,
		}, (input: Record<string, unknown>, options) => {
			const stopped = cancelled(options);
			if (stopped) return stopped;
			const parsed = readMidiTestNoteInput(input);
			if (!parsed.ok) return parsed.result;
			const gestureRequired = midiUserGestureRequired();
			if (gestureRequired) return gestureRequired;
			if (!controller.midi) return midiUnavailable(controller);
			return executeSafely(async () => midiStateResult('send_midi_test_note', await controller.midi!.testNote(parsed.note, parsed.durationMs, parsed.velocity)));
		}),
	];
	return controller.midi ? tools : tools.filter((tool) => !MIDI_WEBMCP_TOOL_NAMES.has(tool.name as WebMcpToolName));
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
