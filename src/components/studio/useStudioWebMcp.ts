import { useCallback, useEffect, useMemo, type MutableRefObject } from 'react';
import {
	createInitialProject,
	diagnosticFromError,
	getSourceIdentityDiagnostics,
} from '../../lib/project/model';
import {
	getSourceBlockDetails,
	getSourceGlobals,
	type TrackMidiRouteUpdate,
} from '../../lib/project/source-mapper';
import { getTimelineCapacityForEndCycle } from '../../lib/project/timeline';
import { isAudioLockedError, type StrudelAdapter } from '../../lib/strudel/adapter';
import type { MidiChannel, MidiClockMode, MidiRuntimeState } from '../../lib/midi/types';
import type { MidiService } from '../../lib/midi/service';
import {
	applyTextEdits,
	registerWebMcpTools,
	waitForNativeModelContext,
	type SourceMutationInput,
	type SourcePatchInput,
	type WebMcpController,
	type WebMcpKeyInput,
	type WebMcpMutationResult,
	type WebMcpPlaybackAction,
	type WebMcpPlaybackResult,
	type WebMcpRegistration,
	type WebMcpStateSnapshot,
	type WebMcpTempoInput,
	type WebMcpTemplateLoadInput,
	type WebMcpTimelineExtensionInput,
	type WebMcpMidiRecordInput,
	type WebMcpMidiRouteInput,
	type WebMcpTrackMutationInput,
	type WebMcpTrackRangeInput,
	type WebMcpTrackRenameInput,
	type WebMcpValidationResult,
} from '../../lib/webmcp/tools';
import { getEditorPreset, type EditorPreset } from '../../lib/project/presets';
import { stableSerialize, TransactionCache, TransactionReuseError } from '../../lib/webmcp/transaction-cache';
import {
	formatCycle,
	formatRevision,
	getTrackTimingForTimeline,
	makeMutationResult,
	normalizeTrackRange,
	resolveTrackTarget,
	sourceEntityIds,
	sourceForTrackMutation,
	SOURCE_HISTORY_LIMIT,
	TIMELINE_SNAP_CYCLE,
} from './helpers';
import type {
	CommitSource,
	CommitSourceResult,
	DispatchResult,
	PatchStudio,
	PersistStudioSnapshot,
	StudioCommand,
	StudioState,
	SourceHistoryState,
	TrackDetails,
} from './types';

export interface UseStudioWebMcpOptions {
	studioRef: MutableRefObject<StudioState>;
	adapterRef: MutableRefObject<StrudelAdapter | null>;
	sourceTransactionsRef: MutableRefObject<TransactionCache<WebMcpMutationResult>>;
	sourceHistoryRef: MutableRefObject<SourceHistoryState>;
	webmcpRegistrationRef: MutableRefObject<WebMcpRegistration | null>;
	webmcpAvailableRef: MutableRefObject<boolean>;
	commitSource: CommitSource;
	dispatch: (command: StudioCommand) => Promise<DispatchResult>;
	patchStudio: PatchStudio;
	persistStudioSnapshot: PersistStudioSnapshot;
	bumpSourceHistory: () => void;
	commitTempo: (bpm: number) => Promise<CommitSourceResult>;
	commitKey: (key: string) => Promise<CommitSourceResult>;
	commitTrackRange: (trackId: string, startCycle: number, endCycle: number) => Promise<CommitSourceResult>;
	deleteTrack: (trackId: string) => Promise<CommitSourceResult>;
	renameTrack: (trackId: string, name: string) => Promise<CommitSourceResult>;
	loadTemplate: (preset: EditorPreset, expectedRevision?: number) => Promise<CommitSourceResult>;
	midiService: MidiService;
	startMidiRecording: (signal?: AbortSignal) => Promise<MidiRuntimeState>;
	stopMidiRecording: () => Promise<MidiRuntimeState>;
	commitMidiTake: (expectedRevision?: number) => Promise<CommitSourceResult>;
	setTrackMidiRoute: (trackId: string, output: string | number | null | undefined, channel: number, enabled: boolean, settings?: Pick<TrackMidiRouteUpdate, 'instrument' | 'velocity' | 'gain' | 'noteOffsetMs' | 'midimap' | 'program'>, expectedRevision?: number) => Promise<CommitSourceResult>;
}

export function useStudioWebMcp({
	studioRef,
	adapterRef,
	sourceTransactionsRef,
	sourceHistoryRef,
	webmcpRegistrationRef,
	webmcpAvailableRef,
	commitSource,
	dispatch,
	patchStudio,
	persistStudioSnapshot,
	bumpSourceHistory,
	commitTempo,
	commitKey,
	commitTrackRange,
	deleteTrack,
	renameTrack,
	loadTemplate,
	midiService,
	startMidiRecording,
	stopMidiRecording,
	commitMidiTake,
	setTrackMidiRoute,
}: UseStudioWebMcpOptions) {
	const getWebMcpState = useCallback((): WebMcpStateSnapshot => {
		const current = studioRef.current;
		const midi = midiService.getState();
		const reviewedTake = midi.recording.take;
		const boundedMidi = reviewedTake ? {
			...midi,
			recording: {
				...midi.recording,
				take: {
					...reviewedTake,
					notes: reviewedTake.notes.slice(0, 256),
					automation: reviewedTake.automation.slice(0, 256).map((event) => ({ ...event, data: event.data.slice(0, 256) })),
					truncated: reviewedTake.truncated === true || reviewedTake.notes.length > 256 || reviewedTake.automation.length > 256 || reviewedTake.automation.some((event) => event.data.length > 256),
				},
			},
		} : midi;
		const project = createInitialProject();
		const globals = getSourceGlobals(current.lastValid);
		const tracks = getSourceBlockDetails(current.lastValid).map((track, index) => ({
			id: track.id,
			number: index + 1,
			name: track.name,
			type: track.type,
			line: track.line,
			...(track.label === undefined ? {} : { label: track.label }),
			...(track.expression === undefined ? {} : { expression: track.expression }),
			...(track.color === undefined ? {} : { color: track.color }),
			...(track.instrument === undefined ? {} : { instrument: track.instrument }),
			...(track.midi === undefined ? {} : { midi: { ...track.midi } }),
			colorEditable: track.colorEditable,
			timing: getTrackTimingForTimeline(track, current.songEndCycle),
			gain: { ...(track.gain === undefined ? {} : { value: track.gain }), editable: track.gainEditable },
			pan: { ...(track.pan === undefined ? {} : { value: track.pan }), editable: track.panEditable },
			muted: track.muted,
			soloed: track.soloed,
		}));
		return {
			project: { id: project.id, name: current.projectName },
			source: {
				draft: current.draft,
				lastValid: current.lastValid,
				revision: current.revision,
				activeRevision: current.activeRevision,
			},
			timeline: {
				bpm: globals.bpm,
				quarterNotesPerCycle: globals.quarterNotesPerCycle,
				key: globals.key,
				songEndCycle: current.songEndCycle,
			},
			tracks,
			diagnostics: current.diagnostics,
			runtime: current.runtime,
			phase: current.phase,
			persistenceState: current.persistenceState,
			webmcp: { available: webmcpAvailableRef.current },
			midi: boundedMidi,
		};
	}, [midiService, studioRef, webmcpAvailableRef]);

	const applySourceMutation = useCallback(
		async (action: string, input: SourceMutationInput): Promise<WebMcpMutationResult> => {
			const current = studioRef.current;
			if (input.baseRevision !== current.revision) {
				const state = getWebMcpState();
				return {
					ok: false,
					action,
					affectedEntityIds: sourceEntityIds(state),
					message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`,
					state,
					revision: state.source.revision,
					activeRevision: state.source.activeRevision,
					transactionId: input.transactionId,
					error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' },
					conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision },
				};
			}

			const beforeSource = current.draft;
			let result: CommitSourceResult;
			try {
				result = await commitSource(input.source, { expectedRevision: input.baseRevision });
			} catch (error) {
				const state = getWebMcpState();
				return makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, false, 'The source transaction could not be completed.', { code: 'SOURCE_COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) });
			}

			const state = getWebMcpState();
			if (result.conflict) {
				return {
					ok: false,
					action,
					affectedEntityIds: sourceEntityIds(state),
					message: `Revision conflict: expected ${formatRevision(result.conflict.expectedRevision)}, current is ${formatRevision(result.conflict.actualRevision)}.`,
					state,
					revision: state.source.revision,
					activeRevision: state.source.activeRevision,
					transactionId: input.transactionId,
					error: { code: 'REVISION_CONFLICT', message: 'The source changed while this transaction was waiting to commit.' },
					conflict: result.conflict,
				};
			}
			if (result.ok) {
				return makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, true, `Source accepted at ${formatRevision(state.source.revision)}.`);
			}

			const diagnostic = result.error;
			return makeMutationResult(
				state,
				action,
				input.transactionId,
				beforeSource,
				input.baseRevision,
				false,
				`Source draft updated, but Strudel rejected it; ${formatRevision(state.source.activeRevision)} remains active.`,
				{ code: 'VALIDATION_FAILED', message: diagnostic?.message ?? 'Strudel could not evaluate the source.', details: diagnostic ? { diagnostic } : undefined },
			);
		},
		[commitSource, getWebMcpState, studioRef],
	);

	const sourceMutationForWebMcp = useCallback(
		(action: string, input: SourceMutationInput): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			action,
			input.transactionId,
			() => applySourceMutation(action, input),
			stableSerialize(input),
		).catch((error) => {
			if (!(error instanceof TransactionReuseError)) throw error;
			const state = getWebMcpState();
			return makeMutationResult(state, action, input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
		}),
		[applySourceMutation, getWebMcpState, sourceTransactionsRef],
	);

	const timelineMutationForWebMcp = useCallback(
		(
			action: string,
			input: WebMcpTempoInput | WebMcpKeyInput,
			mutate: () => Promise<CommitSourceResult>,
			successMessage: (state: WebMcpStateSnapshot) => string,
		): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			action,
			input.transactionId,
			async () => {
				const current = studioRef.current;
				if (input.baseRevision !== current.revision) {
					const state = getWebMcpState();
					return {
						ok: false,
						action,
						affectedEntityIds: ['source'],
						message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`,
						state,
						revision: state.source.revision,
						activeRevision: state.source.activeRevision,
						transactionId: input.transactionId,
						error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' },
						conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision },
					};
				}

				const beforeSource = current.draft;
				let result: CommitSourceResult;
				try {
					result = await mutate();
				} catch (error) {
					const state = getWebMcpState();
					return makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, false, 'The timeline setting could not be changed.', { code: 'SOURCE_COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) });
				}

				const state = getWebMcpState();
				if (result.ok) return makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, true, successMessage(state), undefined, ['source']);

				const diagnostic = result.error;
				return makeMutationResult(
					state,
					action,
					input.transactionId,
					beforeSource,
					input.baseRevision,
					false,
					`Timeline setting was rejected; ${formatRevision(state.source.activeRevision)} remains active.`,
					{ code: 'VALIDATION_FAILED', message: diagnostic?.message ?? 'Strudel could not evaluate the timeline setting.', details: diagnostic ? { diagnostic } : undefined },
					['source'],
				);
			},
			stableSerialize(input),
		).catch((error) => {
			if (!(error instanceof TransactionReuseError)) throw error;
			const state = getWebMcpState();
			return makeMutationResult(state, action, input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
		}),
		[getWebMcpState, sourceTransactionsRef, studioRef],
	);

	const setTempoForWebMcp = useCallback(
		(input: WebMcpTempoInput) => timelineMutationForWebMcp(
			'set_tempo',
			input,
			() => commitTempo(input.bpm),
			(state) => `Set tempo to ${formatCycle(state.timeline.bpm)} BPM at ${formatRevision(state.source.revision)}.`,
		),
		[commitTempo, timelineMutationForWebMcp],
	);

	const setKeyForWebMcp = useCallback(
		(input: WebMcpKeyInput) => timelineMutationForWebMcp(
			'set_key',
			input,
			() => commitKey(input.key),
			(state) => `Set key to ${JSON.stringify(state.timeline.key)} at ${formatRevision(state.source.revision)}.`,
		),
		[commitKey, timelineMutationForWebMcp],
	);

	const extendTimelineForWebMcp = useCallback(
		(input: WebMcpTimelineExtensionInput): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			'extend_timeline',
			input.transactionId,
			async () => {
				const current = studioRef.current;
				if (input.baseRevision !== current.revision) {
					const state = getWebMcpState();
					return {
						ok: false,
						action: 'extend_timeline',
						affectedEntityIds: ['timeline'],
						message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`,
						state,
						revision: state.source.revision,
						activeRevision: state.source.activeRevision,
						transactionId: input.transactionId,
						error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' },
						conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision },
					};
				}

				const nextSongEndCycle = getTimelineCapacityForEndCycle(current.songEndCycle + TIMELINE_SNAP_CYCLE);
				if (nextSongEndCycle > current.songEndCycle) {
					adapterRef.current?.setSongEndCycle(nextSongEndCycle);
					patchStudio({ songEndCycle: nextSongEndCycle });
					void persistStudioSnapshot();
				}
				const state = getWebMcpState();
				return makeMutationResult(
					state,
					'extend_timeline',
					input.transactionId,
					current.draft,
					input.baseRevision,
					true,
					`Timeline is available through bar ${state.timeline.songEndCycle}.`,
					undefined,
					['timeline'],
				);
			},
			stableSerialize(input),
		).catch((error) => {
			if (!(error instanceof TransactionReuseError)) throw error;
			const state = getWebMcpState();
			return makeMutationResult(state, 'extend_timeline', input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
		}),
		[adapterRef, getWebMcpState, patchStudio, persistStudioSnapshot, sourceTransactionsRef, studioRef],
	);

	const trackMutationForWebMcp = useCallback(
		(
			action: string,
			input: WebMcpTrackMutationInput,
			mutate: (trackId: string) => Promise<CommitSourceResult>,
			successMessage: (track: TrackDetails, state: WebMcpStateSnapshot) => string,
		): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			action,
			input.transactionId,
			async () => {
			const current = studioRef.current;
			if (input.baseRevision !== current.revision) {
				const state = getWebMcpState();
				return {
					ok: false,
					action,
					affectedEntityIds: sourceEntityIds(state),
					message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`,
					state,
					revision: state.source.revision,
					activeRevision: state.source.activeRevision,
					transactionId: input.transactionId,
					error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' },
					conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision },
				};
			}

			const mutationSource = sourceForTrackMutation(current);
			const resolved = resolveTrackTarget(mutationSource, input);
			if (!resolved.ok) {
				const state = getWebMcpState();
				return makeMutationResult(state, action, input.transactionId, current.draft, current.revision, false, resolved.message, { code: resolved.code, message: resolved.message });
			}

			const beforeSource = current.draft;
			let result: CommitSourceResult;
			try {
				result = await mutate(resolved.track.id);
			} catch (error) {
				const state = getWebMcpState();
				return makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, false, 'The track transaction could not be completed.', { code: 'TRACK_COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) }, ['source', resolved.track.id]);
			}

			const state = getWebMcpState();
			const affectedEntityIds = ['source', resolved.track.id];
			if (result.ok) {
				return makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, true, successMessage(resolved.track, state), undefined, affectedEntityIds);
			}

			const diagnostic = result.error;
			return makeMutationResult(
				state,
				action,
				input.transactionId,
				beforeSource,
				input.baseRevision,
				false,
				`Track change was rejected; ${formatRevision(state.source.activeRevision)} remains active.`,
				{ code: 'VALIDATION_FAILED', message: diagnostic?.message ?? 'Strudel could not evaluate the track change.', details: diagnostic ? { diagnostic } : undefined },
				affectedEntityIds,
			);
			},
			stableSerialize(input),
		).catch((error) => {
			if (!(error instanceof TransactionReuseError)) throw error;
			const state = getWebMcpState();
			return makeMutationResult(state, action, input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
		}),
		[getWebMcpState, sourceTransactionsRef, studioRef],
	);

	const deleteTrackForWebMcp = useCallback(
		(input: WebMcpTrackMutationInput) => trackMutationForWebMcp(
			'delete_track',
			input,
			deleteTrack,
			(track, state) => `Deleted track ${JSON.stringify(track.name)} at ${formatRevision(state.source.revision)}.`,
		),
		[deleteTrack, trackMutationForWebMcp],
	);

	const renameTrackForWebMcp = useCallback(
		(input: WebMcpTrackRenameInput) => trackMutationForWebMcp(
			'rename_track',
			input,
			(trackId) => renameTrack(trackId, input.newName),
			(_track, state) => `Renamed track to ${JSON.stringify(input.newName.trim())} at ${formatRevision(state.source.revision)}.`,
		),
		[renameTrack, trackMutationForWebMcp],
	);

	const setTrackRangeForWebMcp = useCallback(
		(input: WebMcpTrackRangeInput) => trackMutationForWebMcp(
			'set_track_range',
			input,
			(trackId) => commitTrackRange(trackId, input.startCycle, input.endCycle),
			(track, state) => {
				const range = normalizeTrackRange(input.startCycle, input.endCycle, state.timeline.songEndCycle);
				return `Set ${JSON.stringify(track.name)} to cycles ${formatCycle(range.startCycle)}–${formatCycle(range.endCycle)} at ${formatRevision(state.source.revision)}.`;
			},
		),
		[commitTrackRange, trackMutationForWebMcp],
	);

	const setTrackMidiRouteForWebMcp = useCallback(
		(input: WebMcpMidiRouteInput): Promise<WebMcpMutationResult> => trackMutationForWebMcp(
			'set_track_midi_route',
			input,
			(trackId) => setTrackMidiRoute(trackId, input.output, input.channel, input.enabled, {
				instrument: input.instrument,
				velocity: input.velocity,
				gain: input.gain,
				noteOffsetMs: input.noteOffsetMs,
				midimap: input.midimap,
				program: input.program,
			}, input.baseRevision),
			(track, state) => `${input.enabled ? 'Enabled' : 'Disabled'} MIDI output for ${JSON.stringify(track.name)} at ${formatRevision(state.source.revision)}.`,
		),
		[setTrackMidiRoute, trackMutationForWebMcp],
	);

	const loadTemplateForWebMcp = useCallback(
		(input: WebMcpTemplateLoadInput): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			'load_editor_template',
			input.transactionId,
			async () => {
				const current = studioRef.current;
				const preset = getEditorPreset(input.templateId);
				if (!preset) {
					const state = getWebMcpState();
					return makeMutationResult(
						state,
						'load_editor_template',
						input.transactionId,
						current.draft,
						current.revision,
						false,
						`No editor template exists with ID ${JSON.stringify(input.templateId)}.`,
						{ code: 'TEMPLATE_NOT_FOUND', message: `No editor template exists with ID ${JSON.stringify(input.templateId)}.` },
						['source', 'project', 'timeline'],
					);
				}

				if (input.baseRevision !== current.revision) {
					const state = getWebMcpState();
					return {
						ok: false,
						action: 'load_editor_template',
						affectedEntityIds: ['source', 'project', 'timeline'],
						message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`,
						state,
						revision: state.source.revision,
						activeRevision: state.source.activeRevision,
						transactionId: input.transactionId,
						error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' },
						conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision },
					};
				}

				const beforeSource = current.draft;
				let result: CommitSourceResult;
				try {
					result = await loadTemplate(preset, input.baseRevision);
				} catch (error) {
					const state = getWebMcpState();
					return makeMutationResult(
						state,
						'load_editor_template',
						input.transactionId,
						beforeSource,
						input.baseRevision,
						false,
						'The editor template could not be loaded.',
						{ code: 'TEMPLATE_LOAD_FAILED', message: error instanceof Error ? error.message : String(error) },
						['source', 'project', 'timeline'],
					);
				}

				const state = getWebMcpState();
				if (result.conflict) {
					return {
						ok: false,
						action: 'load_editor_template',
						affectedEntityIds: ['source', 'project', 'timeline'],
						message: `Revision conflict: expected ${formatRevision(result.conflict.expectedRevision)}, current is ${formatRevision(result.conflict.actualRevision)}.`,
						state,
						revision: state.source.revision,
						activeRevision: state.source.activeRevision,
						transactionId: input.transactionId,
						error: { code: 'REVISION_CONFLICT', message: 'The source changed while this transaction was waiting to commit.' },
						conflict: result.conflict,
					};
				}
				if (result.ok) {
					return makeMutationResult(
						state,
						'load_editor_template',
						input.transactionId,
						beforeSource,
						input.baseRevision,
						true,
						`Loaded editor template ${JSON.stringify(preset.name)} at ${formatRevision(state.source.revision)}.`,
						undefined,
						['source', 'project', 'timeline'],
					);
				}

				const diagnostic = result.error;
				return makeMutationResult(
					state,
					'load_editor_template',
					input.transactionId,
					beforeSource,
					input.baseRevision,
					false,
					`Editor template was rejected; ${formatRevision(state.source.activeRevision)} remains active.`,
					{ code: 'VALIDATION_FAILED', message: diagnostic?.message ?? 'Strudel could not evaluate the editor template.', details: diagnostic ? { diagnostic } : undefined },
					['source', 'project', 'timeline'],
				);
			},
			stableSerialize(input),
		).catch((error) => {
			if (!(error instanceof TransactionReuseError)) throw error;
			const state = getWebMcpState();
			return makeMutationResult(state, 'load_editor_template', input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
		}),
		[getWebMcpState, loadTemplate, sourceTransactionsRef, studioRef],
	);

	const patchSourceForWebMcp = useCallback(
		(input: SourcePatchInput): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			'patch_strudel_source',
			input.transactionId,
			async () => {
				const current = studioRef.current;
				if (input.baseRevision !== current.revision) {
					return applySourceMutation('patch_strudel_source', { source: current.draft, baseRevision: input.baseRevision, transactionId: input.transactionId });
				}
				const applied = applyTextEdits(current.draft, input.edits);
				if (!applied.ok) {
					const state = getWebMcpState();
					return makeMutationResult(state, 'patch_strudel_source', input.transactionId, current.draft, current.revision, false, 'Patch rejected before validation; the source was not changed.', applied.error);
				}
				if (applied.source === current.draft) {
					const state = getWebMcpState();
					return makeMutationResult(state, 'patch_strudel_source', input.transactionId, current.draft, current.revision, true, 'No source changes were requested.');
				}
				return applySourceMutation('patch_strudel_source', { source: applied.source, baseRevision: input.baseRevision, transactionId: input.transactionId });
			},
			stableSerialize(input),
		).catch((error) => {
			if (!(error instanceof TransactionReuseError)) throw error;
			const state = getWebMcpState();
			return makeMutationResult(state, 'patch_strudel_source', input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
		}),
		[applySourceMutation, getWebMcpState, sourceTransactionsRef, studioRef],
	);

	const validateSourceForWebMcp = useCallback(
		async (source?: string): Promise<WebMcpValidationResult> => {
			const candidate = source ?? studioRef.current.draft;
			const revision = studioRef.current.revision;
			const identityDiagnostics = getSourceIdentityDiagnostics(revision, candidate);
			if (identityDiagnostics.length) {
				const diagnostic = identityDiagnostics[0];
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: identityDiagnostics, message: diagnostic.message, revision, state: getWebMcpState(), error: { code: 'VALIDATION_FAILED', message: diagnostic.message, details: { diagnostic } } };
			}
			const adapter = adapterRef.current;
			if (!adapter) {
				const diagnostic = diagnosticFromError(revision, new Error('The Strudel runtime is not ready.'), candidate);
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: [diagnostic], message: diagnostic.message, revision, state: getWebMcpState(), error: { code: 'VALIDATION_UNAVAILABLE', message: diagnostic.message } };
			}

			try {
				const previousTransport = studioRef.current.runtime.transport;
				const wasPlaying = previousTransport === 'playing';
				if (previousTransport !== 'stopped' || midiService.getState().clockRunning) midiService.panic();
				const result = await adapter.validateSource(candidate, studioRef.current.lastValid);
				const state = getWebMcpState();
				if (wasPlaying && state.runtime.transport === 'playing') midiService.startTransportClock();
				const resultRevision = state.source.revision;
				const staleSuffix = resultRevision === revision
					? ''
					: ` (the studio advanced to ${formatRevision(resultRevision)} while validation was running)`;
				if (result.ok) return { ok: true, action: 'validate_strudel_source', source: candidate, diagnostics: [], message: `Strudel accepted the candidate source.${staleSuffix}`, revision: resultRevision, state };
				const diagnostic = diagnosticFromError(resultRevision, result.error, candidate);
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: [diagnostic], message: diagnostic.message, revision: resultRevision, state, error: { code: 'VALIDATION_FAILED', message: diagnostic.message, details: { diagnostic } } };
			} catch (error) {
				const state = getWebMcpState();
				const diagnostic = diagnosticFromError(state.source.revision, error, candidate);
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: [diagnostic], message: diagnostic.message, revision: state.source.revision, state, error: { code: 'VALIDATION_FAILED', message: diagnostic.message, details: { diagnostic } } };
			}
		},
		[adapterRef, getWebMcpState, midiService, studioRef],
	);

	const controlPlaybackForWebMcp = useCallback(
		async (input: { action: WebMcpPlaybackAction; cycle?: number }): Promise<WebMcpPlaybackResult> => {
			const command: StudioCommand = input.action === 'seek'
				? { type: 'seek', cycle: input.cycle ?? 0 }
				: input.action === 'pause' ? { type: 'pause' } : input.action === 'stop' ? { type: 'stop' } : { type: 'play' };
			const result = await dispatch(command);
			const state = getWebMcpState();
			if (result.ok) {
				const message = input.action === 'seek' ? `Playhead moved to cycle ${formatCycle(state.runtime.currentCycle)}.` : `Playback ${input.action === 'resume' ? 'resumed' : input.action === 'stop' ? 'stopped' : 'played'}.`;
				return { ok: true, action: `control_playback:${input.action}`, affectedEntityIds: ['transport'], message, state, revision: state.source.revision, activeRevision: state.source.activeRevision };
			}
			const message = result.error instanceof Error ? result.error.message : String(result.error ?? 'Playback command failed.');
			return { ok: false, action: `control_playback:${input.action}`, affectedEntityIds: ['transport'], message, state, revision: state.source.revision, activeRevision: state.source.activeRevision, error: { code: isAudioLockedError(result.error) ? 'AUDIO_LOCKED' : 'PLAYBACK_FAILED', message } };
		},
		[dispatch, getWebMcpState],
	);

	const undoSourceForWebMcp = useCallback(
		(input: Omit<SourceMutationInput, 'source'>): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			'undo_source_edit',
			input.transactionId,
			async () => {
				const current = studioRef.current;
				if (input.baseRevision !== current.revision) {
					const state = getWebMcpState();
					return { ok: false, action: 'undo_source_edit', affectedEntityIds: sourceEntityIds(state), message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`, state, revision: state.source.revision, activeRevision: state.source.activeRevision, transactionId: input.transactionId, error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' }, conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision } };
				}
				const entry = sourceHistoryRef.current.undo[sourceHistoryRef.current.undo.length - 1];
				if (!entry) {
					const state = getWebMcpState();
					return makeMutationResult(state, 'undo_source_edit', input.transactionId, current.draft, current.revision, false, 'There is no source edit to undo.', { code: 'NO_UNDO', message: 'The shared source history is already at its oldest revision.' });
				}
				const result = await commitSource(entry.before, { recordHistory: false, expectedRevision: input.baseRevision });
				if (!result.ok) {
					const state = getWebMcpState();
					if (result.conflict) {
						return { ok: false, action: 'undo_source_edit', affectedEntityIds: sourceEntityIds(state), message: `Revision conflict: expected ${formatRevision(result.conflict.expectedRevision)}, current is ${formatRevision(result.conflict.actualRevision)}.`, state, revision: state.source.revision, activeRevision: state.source.activeRevision, transactionId: input.transactionId, error: { code: 'REVISION_CONFLICT', message: 'The source changed while this transaction was waiting to commit.' }, conflict: result.conflict };
					}
					return makeMutationResult(state, 'undo_source_edit', input.transactionId, current.draft, input.baseRevision, false, 'Undo could not be validated by Strudel.', { code: 'VALIDATION_FAILED', message: result.error?.message ?? 'Undo source was rejected.' });
				}
				sourceHistoryRef.current.undo.pop();
				sourceHistoryRef.current.redo.push(entry);
				if (sourceHistoryRef.current.redo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.redo.shift();
				bumpSourceHistory();
				const state = getWebMcpState();
				return makeMutationResult(state, 'undo_source_edit', input.transactionId, current.draft, input.baseRevision, true, `Undid source edit; now at ${formatRevision(state.source.revision)}.`);
			},
			stableSerialize(input),
		).catch((error) => {
			if (!(error instanceof TransactionReuseError)) throw error;
			const state = getWebMcpState();
			return makeMutationResult(state, 'undo_source_edit', input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
		}),
		[bumpSourceHistory, commitSource, getWebMcpState, sourceHistoryRef, sourceTransactionsRef, studioRef],
	);

	const redoSourceForWebMcp = useCallback(
		(input: Omit<SourceMutationInput, 'source'>): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			'redo_source_edit',
			input.transactionId,
			async () => {
				const current = studioRef.current;
				if (input.baseRevision !== current.revision) {
					const state = getWebMcpState();
					return { ok: false, action: 'redo_source_edit', affectedEntityIds: sourceEntityIds(state), message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`, state, revision: state.source.revision, activeRevision: state.source.activeRevision, transactionId: input.transactionId, error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' }, conflict: { expectedRevision: input.baseRevision, actualRevision: current.revision } };
				}
				const entry = sourceHistoryRef.current.redo[sourceHistoryRef.current.redo.length - 1];
				if (!entry) {
					const state = getWebMcpState();
					return makeMutationResult(state, 'redo_source_edit', input.transactionId, current.draft, current.revision, false, 'There is no source edit to redo.', { code: 'NO_REDO', message: 'The shared source history is already at its newest revision.' });
				}
				const result = await commitSource(entry.after, { recordHistory: false, expectedRevision: input.baseRevision });
				if (!result.ok) {
					const state = getWebMcpState();
					if (result.conflict) {
						return { ok: false, action: 'redo_source_edit', affectedEntityIds: sourceEntityIds(state), message: `Revision conflict: expected ${formatRevision(result.conflict.expectedRevision)}, current is ${formatRevision(result.conflict.actualRevision)}.`, state, revision: state.source.revision, activeRevision: state.source.activeRevision, transactionId: input.transactionId, error: { code: 'REVISION_CONFLICT', message: 'The source changed while this transaction was waiting to commit.' }, conflict: result.conflict };
					}
					return makeMutationResult(state, 'redo_source_edit', input.transactionId, current.draft, input.baseRevision, false, 'Redo could not be validated by Strudel.', { code: 'VALIDATION_FAILED', message: result.error?.message ?? 'Redo source was rejected.' });
				}
				sourceHistoryRef.current.redo.pop();
				sourceHistoryRef.current.undo.push(entry);
				if (sourceHistoryRef.current.undo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.undo.shift();
				bumpSourceHistory();
				const state = getWebMcpState();
				return makeMutationResult(state, 'redo_source_edit', input.transactionId, current.draft, input.baseRevision, true, `Redid source edit; now at ${formatRevision(state.source.revision)}.`);
			},
			stableSerialize(input),
		).catch((error) => {
			if (!(error instanceof TransactionReuseError)) throw error;
			const state = getWebMcpState();
			return makeMutationResult(state, 'redo_source_edit', input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
		}),
		[bumpSourceHistory, commitSource, getWebMcpState, sourceHistoryRef, sourceTransactionsRef, studioRef],
	);

	const acceptMidiTakeForWebMcp = useCallback(
		(input: { baseRevision: number; transactionId: string }): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			'accept_midi_take',
			input.transactionId,
			async () => {
				const current = studioRef.current;
				const stateBefore = getWebMcpState();
				if (input.baseRevision !== current.revision) return {
					ok: false,
					action: 'accept_midi_take',
					affectedEntityIds: sourceEntityIds(stateBefore),
					message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(stateBefore.source.revision)}.`,
					state: stateBefore,
					revision: stateBefore.source.revision,
					activeRevision: stateBefore.source.activeRevision,
					transactionId: input.transactionId,
					error: { code: 'REVISION_CONFLICT', message: 'The source changed after this MIDI take was prepared.' },
					conflict: { expectedRevision: input.baseRevision, actualRevision: stateBefore.source.revision },
				};
				if (!midiService.getState().recording.take) return makeMutationResult(stateBefore, 'accept_midi_take', input.transactionId, current.draft, current.revision, false, 'There is no MIDI take waiting for review.', { code: 'MIDI_TAKE_NOT_AVAILABLE', message: 'Stop or review a MIDI take before accepting it.' });
				const result = await commitMidiTake(input.baseRevision);
				const state = getWebMcpState();
				if (result.conflict) return {
					ok: false,
					action: 'accept_midi_take',
					affectedEntityIds: sourceEntityIds(state),
					message: `Revision conflict: expected ${formatRevision(result.conflict.expectedRevision)}, current is ${formatRevision(result.conflict.actualRevision)}.`,
					state,
					revision: state.source.revision,
					activeRevision: state.source.activeRevision,
					transactionId: input.transactionId,
					error: { code: 'REVISION_CONFLICT', message: 'The source changed while accepting the MIDI take.' },
					conflict: result.conflict,
				};
				if (result.ok) return makeMutationResult(state, 'accept_midi_take', input.transactionId, current.draft, input.baseRevision, true, `Accepted MIDI take at ${formatRevision(state.source.revision)}.`, undefined, ['source', 'midi']);
				return makeMutationResult(state, 'accept_midi_take', input.transactionId, current.draft, input.baseRevision, false, 'MIDI take source was rejected; the accepted source remains active.', { code: 'VALIDATION_FAILED', message: result.error?.message ?? 'Strudel rejected the recorded MIDI source.' }, ['source', 'midi']);
			},
			stableSerialize(input),
		).catch((error) => {
			if (!(error instanceof TransactionReuseError)) throw error;
			const state = getWebMcpState();
			return makeMutationResult(state, 'accept_midi_take', input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
		}),
		[commitMidiTake, getWebMcpState, midiService, sourceTransactionsRef, studioRef],
	);

	const midiController = useMemo(() => ({
		getState: () => midiService.getState(),
		connect: (options: { sysex: boolean }) => midiService.connect(options),
		disconnect: () => {
			adapterRef.current?.releaseAllLiveMidiNotes();
			return midiService.disconnect();
		},
		selectInput: (id: string | null) => midiService.setSelectedInput(id),
		selectOutput: (id: string | null) => {
			const before = midiService.getState();
			if (before.clockRunning && id !== before.selectedOutputId) midiService.panic();
			const next = midiService.setSelectedOutput(id);
			if (id === null) midiService.stopTransportClock();
			else if (!next.lastError && studioRef.current.runtime.transport === 'playing' && next.clockMode === 'send' && (!next.clockRunning || next.selectedOutputId !== before.selectedOutputId)) midiService.startTransportClock();
			return midiService.getState();
		},
		setSettings: (settings: { inputChannel?: MidiChannel; outputChannel?: number; monitor?: boolean; clockMode?: MidiClockMode }) => {
			if (settings.inputChannel !== undefined) midiService.setInputChannel(settings.inputChannel);
			if (settings.outputChannel !== undefined) midiService.setOutputChannel(settings.outputChannel);
			if (settings.monitor !== undefined) midiService.setMonitor(settings.monitor);
			if (settings.clockMode !== undefined) midiService.setClockMode(settings.clockMode);
			const next = midiService.getState();
			if (next.clockMode === 'send' && next.enabled && studioRef.current.runtime.transport === 'playing' && !next.clockRunning) midiService.startTransportClock();
			return midiService.getState();
		},
		learnControl: () => midiService.beginControlLearn(),
		armRecording: (options: WebMcpMidiRecordInput) => {
			const track = getSourceBlockDetails(studioRef.current.lastValid).find((candidate) => candidate.id === options.trackId);
			return midiService.armRecording({
				...options,
				...(options.loop && track ? { loopStartCycle: track.timing.startCycle, loopEndCycle: track.timing.endCycle } : {}),
			});
		},
		startRecording: startMidiRecording,
		stopRecording: stopMidiRecording,
		cancelRecording: () => midiService.cancelRecording(),
		acceptTake: acceptMidiTakeForWebMcp,
		panic: (outputId?: string | null) => {
			adapterRef.current?.releaseAllLiveMidiNotes();
			return midiService.panic(outputId);
		},
		testNote: (note?: number, durationMs?: number, velocity?: number) => midiService.testNote(note, durationMs, velocity),
	}), [acceptMidiTakeForWebMcp, midiService, startMidiRecording, stopMidiRecording]);

	const webmcpController = useMemo<WebMcpController>(() => ({
		getState: getWebMcpState,
		loadTemplate: loadTemplateForWebMcp,
		writeSource: (input) => sourceMutationForWebMcp('write_strudel_source', input),
		patchSource: patchSourceForWebMcp,
		setTempo: setTempoForWebMcp,
		setKey: setKeyForWebMcp,
		deleteTrack: deleteTrackForWebMcp,
		renameTrack: renameTrackForWebMcp,
		setTrackRange: setTrackRangeForWebMcp,
		extendTimeline: extendTimelineForWebMcp,
		validateSource: validateSourceForWebMcp,
		controlPlayback: controlPlaybackForWebMcp,
		undoSourceEdit: undoSourceForWebMcp,
		redoSourceEdit: redoSourceForWebMcp,
		setTrackMidiRoute: setTrackMidiRouteForWebMcp,
		midi: midiController,
	}), [controlPlaybackForWebMcp, deleteTrackForWebMcp, extendTimelineForWebMcp, getWebMcpState, loadTemplateForWebMcp, midiController, patchSourceForWebMcp, redoSourceForWebMcp, renameTrackForWebMcp, setKeyForWebMcp, setTempoForWebMcp, setTrackMidiRouteForWebMcp, setTrackRangeForWebMcp, sourceMutationForWebMcp, undoSourceForWebMcp, validateSourceForWebMcp]);

	useEffect(() => {
		let disposed = false;
		let registration: WebMcpRegistration | null = null;
		const waitController = new AbortController();
		void waitForNativeModelContext({ signal: waitController.signal }).then((context) => {
			if (!context || disposed) return null;
			return registerWebMcpTools(webmcpController, context, { signal: waitController.signal });
		}).then((nextRegistration) => {
			if (!nextRegistration) return;
			if (disposed) {
				nextRegistration.dispose();
				return;
			}
			registration = nextRegistration;
			webmcpRegistrationRef.current = nextRegistration;
			webmcpAvailableRef.current = nextRegistration.available;
		}).catch(() => {
			// Host integration is optional. A late or malformed host must not create
			// an unhandled rejection that takes down the studio page.
			if (!disposed) webmcpAvailableRef.current = false;
		});
		return () => {
			disposed = true;
			waitController.abort();
			// The local registration and the ref point at the same object once
			// discovery completes. Dispose through one path so a host bridge with a
			// non-idempotent teardown callback is never invoked twice.
			(registration ?? webmcpRegistrationRef.current)?.dispose();
			webmcpRegistrationRef.current = null;
			webmcpAvailableRef.current = false;
		};
	}, [webmcpController, webmcpAvailableRef, webmcpRegistrationRef]);
}
