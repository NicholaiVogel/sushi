import type { ChangeEvent, RefObject } from 'react';
import { EDITOR_PRESETS, type EditorPreset } from '../../lib/project/presets';
import type { StoredProjectSummary } from '../../lib/project/storage';
import type { PersistenceState } from './types';

export interface SettingsMenuProps {
	persistenceState: PersistenceState;
	saveStateLabel: string;
	isDirty: boolean;
	isBusy: boolean;
	localProjects: readonly StoredProjectSummary[];
	localProjectsLoading: boolean;
	localProjectsError: string | null;
	projectImportInputRef: RefObject<HTMLInputElement | null>;
	onSaveProject: () => void;
	onExportProject: () => void;
	onImportProject: (event: ChangeEvent<HTMLInputElement>) => void;
	onLoadPreset: (preset: EditorPreset) => void;
	onLoadLocalProject: (projectId: string) => void;
	onRefreshLocalProjects: () => void;
}

function formatSavedAt(savedAt: number): string {
	const date = new Date(savedAt);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SettingsMenu({
	persistenceState,
	saveStateLabel,
	isDirty,
	isBusy,
	localProjects,
	localProjectsLoading,
	localProjectsError,
	projectImportInputRef,
	onSaveProject,
	onExportProject,
	onImportProject,
	onLoadPreset,
	onLoadLocalProject,
	onRefreshLocalProjects,
}: SettingsMenuProps) {
	const canSave = persistenceState === 'ready' && !isBusy;

	return (
		<div className="topbar-settings-menu" role="dialog" aria-label="Sushi settings">
			<div className="settings-menu-heading">
				<div className="settings-menu-title-row">
					<strong className="topbar-popover-title">Sushi settings</strong>
					<span className="settings-menu-save-state"><span className="save-dot" aria-hidden="true" />{saveStateLabel}</span>
				</div>
				<span>Save, share, and reopen source-first projects.</span>
			</div>

			<section className="settings-menu-section" aria-labelledby="settings-project-heading">
				<h3 id="settings-project-heading">Project</h3>
				<div className="settings-menu-actions">
					<button className="settings-menu-action" type="button" onClick={onSaveProject} disabled={!canSave}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v6h8V4M8 20v-5h8v5" /></svg>
						<span><strong>Save locally</strong><small>{persistenceState === 'unavailable' ? 'IndexedDB is unavailable' : isDirty ? 'Write the current draft to this browser' : 'Project is already up to date'}</small></span>
					</button>
					<button className="settings-menu-action" type="button" onClick={onImportProjectButton} disabled={isBusy}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V9" /><path d="m8 16 4 4 4-4" /><path d="M5 10V5h14v5" /></svg>
						<span><strong>Import project</strong><small>Open a .sushi.json file</small></span>
					</button>
					<button className="settings-menu-action" type="button" onClick={onExportProject} disabled={isBusy}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11" /><path d="m8 8 4-4 4 4" /><path d="M5 14v5h14v-5" /></svg>
						<span><strong>Export project</strong><small>Download a portable .sushi.json</small></span>
					</button>
				</div>
				<input ref={projectImportInputRef} className="project-import-input" type="file" accept="application/json,.json" onChange={onImportProject} aria-label="Import Sushi project file" />
			</section>

			<section className="settings-menu-section" aria-labelledby="settings-local-heading">
				<div className="settings-menu-section-heading">
					<h3 id="settings-local-heading">Saved locally</h3>
					<button className="settings-menu-refresh" type="button" onClick={onRefreshLocalProjects} disabled={localProjectsLoading || isBusy} aria-label="Refresh saved projects" title="Refresh saved projects">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.8-3.9L4 9" /><path d="M4 4v5h5M4 13a8 8 0 0 0 14.8 3.9L20 15" /><path d="M20 20v-5h-5" /></svg>
					</button>
				</div>
				{localProjectsLoading ? <p className="settings-menu-status">Reading local projects…</p> : null}
				{localProjectsError ? <p className="settings-menu-status settings-menu-status-error">{localProjectsError}</p> : null}
				{!localProjectsLoading && !localProjectsError && !localProjects.length ? <p className="settings-menu-status">No saved projects yet.</p> : null}
				{localProjects.length ? (
					<div className="settings-menu-list">
						{localProjects.map((project) => (
							<button className="settings-menu-project" type="button" key={project.id} onClick={() => onLoadLocalProject(project.id)} disabled={isBusy}>
								<span><strong>{project.name}</strong><small>REV {project.revision} · {formatSavedAt(project.savedAt)}</small></span>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
							</button>
						))}
					</div>
				) : null}
			</section>

			<section className="settings-menu-section" aria-labelledby="settings-template-heading">
				<h3 id="settings-template-heading">Templates</h3>
				<div className="settings-menu-list">
					{EDITOR_PRESETS.map((preset) => (
						<button className="settings-menu-project settings-menu-template" type="button" key={preset.id} onClick={() => onLoadPreset(preset)} disabled={isBusy}>
							<span><strong>{preset.name}</strong><small>{preset.lanes} LANES · {preset.bpm} BPM · {preset.key}</small></span>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
						</button>
					))}
				</div>
			</section>
		</div>
	);

	function onImportProjectButton() {
		projectImportInputRef.current?.click();
	}
}
