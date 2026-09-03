import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import { createDisabledMidiRuntimeState } from '../../lib/midi/types';
import { getSourceGlobals } from '../../lib/project/source-mapper';
import { createInitialProject } from '../../lib/project/model';
import { createInitialStudioState, getKeyParts } from './helpers';
import { StudioHeader, type StudioHeaderProps } from './StudioHeader';

function emptyRef<T>(): { current: T | null } {
	return { current: null };
}

function headerProps(experimentalMidi: boolean): StudioHeaderProps {
	const studio = createInitialStudioState();
	const globals = getSourceGlobals(studio.lastValid);
	const noop = () => undefined;
	return {
		headerRef: emptyRef<HTMLElement>(),
		transportClockRef: emptyRef<HTMLSpanElement>(),
		transportCycleRef: emptyRef<HTMLSpanElement>(),
		projectName: createInitialProject().name,
		persistenceState: 'ready',
		saveStateLabel: 'SAVED',
		isDirty: false,
		isBusy: false,
		canPlay: true,
		experimentalMidi,
		runtime: studio.runtime,
		sourceGlobals: globals,
		draftGlobals: globals,
		draftBpm: globals.bpm,
		draftKey: getKeyParts(globals.key),
		currentSeconds: 0,
		songEndSeconds: 4,
		openPopover: null,
		canUndo: false,
		canRedo: false,
		localProjects: [],
		localProjectsLoading: false,
		localProjectsError: null,
		appearanceMode: 'system',
		isDarkMode: false,
		projectImportInputRef: emptyRef<HTMLInputElement>(),
		onNewProject: noop,
		onTogglePopover: noop,
		onProjectNameChange: noop,
		onPersistProject: noop,
		onSaveProject: noop,
		onSetTempo: noop,
		onSetQuarterNotesPerCycle: noop,
		onSetKey: noop,
		onRevertSource: noop,
		onCommitSource: noop,
		onUndoSource: noop,
		onRedoSource: noop,
		onExportProject: noop,
		onImportProject: noop,
		onPlay: noop,
		onPause: noop,
		onStop: noop,
		onRecordMidi: noop,
		onToggleMidiPanel: noop,
		midiPanelOpen: false,
		midiState: createDisabledMidiRuntimeState(),
		onLoadPreset: noop,
		onLoadLocalProject: noop,
		onRefreshLocalProjects: noop,
		onAppearanceModeChange: noop,
		onOpenOnboarding: noop,
	};
}

describe('StudioHeader MIDI containment', () => {
	test('omits the MIDI toolbar and recording controls when disabled', () => {
		const markup = renderToStaticMarkup(<StudioHeader {...headerProps(false)} />);

		expect(markup).not.toContain('MIDI');
		expect(markup).not.toContain('transport-midi');
		expect(markup).not.toContain('transport-record');
	});

	test('exposes the top-level MIDI entry point when enabled', () => {
		const markup = renderToStaticMarkup(<StudioHeader {...headerProps(true)} />);

		expect(markup).toContain('Open MIDI controls');
		expect(markup).toContain('Open MIDI recording');
	});
});
