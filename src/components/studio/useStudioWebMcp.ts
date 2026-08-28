import { useCallback, useEffect, useMemo, type MutableRefObject } from 'react';
import {
	createInitialProject,
	diagnosticFromError,
	getSourceIdentityDiagnostics,
} from '../../lib/project/model';
import {
	getSourceBlockDetails,
	getSourceGlobals,
} from '../../lib/project/source-mapper';
import { getTimelineCapacityForEndCycle } from '../../lib/project/timeline';
import { isAudioLockedError, type StrudelAdapter } from '../../lib/strudel/adapter';
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
}: UseStudioWebMcpOptions) {
	const getWebMcpState = useCallback((): WebMcpStateSnapshot => {
		const current = studioRef.current;
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
		};
	}, [studioRef, webmcpAvailableRef]);

	const rememberMutation = useCallback((result: WebMcpMutationResult): WebMcpMutationResult => {
		if (result.transactionId) sourceTransactionsRef.current.set(result.action, result.transactionId, result);
		return result;
	}, [sourceTransactionsRef]);

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
		async (
			action: string,
			input: WebMcpTempoInput | WebMcpKeyInput,
			mutate: () => Promise<CommitSourceResult>,
			successMessage: (state: WebMcpStateSnapshot) => string,
		): Promise<WebMcpMutationResult> => {
			const cached = sourceTransactionsRef.current.get(action, input.transactionId);
			if (cached) return cached;

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
				return rememberMutation(makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, false, 'The timeline setting could not be changed.', { code: 'SOURCE_COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) }));
			}

			const state = getWebMcpState();
			if (result.ok) return rememberMutation(makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, true, successMessage(state), undefined, ['source']));

			const diagnostic = result.error;
			return rememberMutation(makeMutationResult(
				state,
				action,
				input.transactionId,
				beforeSource,
				input.baseRevision,
				false,
				`Timeline setting was rejected; ${formatRevision(state.source.activeRevision)} remains active.`,
				{ code: 'VALIDATION_FAILED', message: diagnostic?.message ?? 'Strudel could not evaluate the timeline setting.', details: diagnostic ? { diagnostic } : undefined },
				['source'],
			));
		},
		[getWebMcpState, rememberMutation, sourceTransactionsRef, studioRef],
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
		async (input: WebMcpTimelineExtensionInput): Promise<WebMcpMutationResult> => {
			const cached = sourceTransactionsRef.current.get('extend_timeline', input.transactionId);
			if (cached) return cached;
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
			return rememberMutation(makeMutationResult(
				state,
				'extend_timeline',
				input.transactionId,
				current.draft,
				input.baseRevision,
				true,
				`Timeline is available through bar ${state.timeline.songEndCycle}.`,
				undefined,
				['timeline'],
			));
		},
		[adapterRef, getWebMcpState, patchStudio, persistStudioSnapshot, rememberMutation, sourceTransactionsRef, studioRef],
	);

	const trackMutationForWebMcp = useCallback(
		async (
			action: string,
			input: WebMcpTrackMutationInput,
			mutate: (trackId: string) => Promise<CommitSourceResult>,
			successMessage: (track: TrackDetails, state: WebMcpStateSnapshot) => string,
		): Promise<WebMcpMutationResult> => {
			const cached = sourceTransactionsRef.current.get(action, input.transactionId);
			if (cached) return cached;

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
				return rememberMutation(makeMutationResult(state, action, input.transactionId, current.draft, current.revision, false, resolved.message, { code: resolved.code, message: resolved.message }));
			}

			const beforeSource = current.draft;
			let result: CommitSourceResult;
			try {
				result = await mutate(resolved.track.id);
			} catch (error) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, false, 'The track transaction could not be completed.', { code: 'TRACK_COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) }, ['source', resolved.track.id]));
			}

			const state = getWebMcpState();
			const affectedEntityIds = ['source', resolved.track.id];
			if (result.ok) {
				return rememberMutation(makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, true, successMessage(resolved.track, state), undefined, affectedEntityIds));
			}

			const diagnostic = result.error;
			return rememberMutation(makeMutationResult(
				state,
				action,
				input.transactionId,
				beforeSource,
				input.baseRevision,
				false,
				`Track change was rejected; ${formatRevision(state.source.activeRevision)} remains active.`,
				{ code: 'VALIDATION_FAILED', message: diagnostic?.message ?? 'Strudel could not evaluate the track change.', details: diagnostic ? { diagnostic } : undefined },
				affectedEntityIds,
			));
		},
		[getWebMcpState, rememberMutation, sourceTransactionsRef, studioRef],
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
				const result = await adapter.validateSource(candidate, studioRef.current.lastValid);
				const state = getWebMcpState();
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
		[adapterRef, getWebMcpState, studioRef],
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
	}), [controlPlaybackForWebMcp, deleteTrackForWebMcp, extendTimelineForWebMcp, getWebMcpState, loadTemplateForWebMcp, patchSourceForWebMcp, redoSourceForWebMcp, renameTrackForWebMcp, setKeyForWebMcp, setTempoForWebMcp, setTrackRangeForWebMcp, sourceMutationForWebMcp, undoSourceForWebMcp, validateSourceForWebMcp]);

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
