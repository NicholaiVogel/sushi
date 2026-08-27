import type { AssetManifestEntry, ProjectDocumentV1 } from './model';

const DATABASE_NAME = 'sushi-projects';
const DATABASE_VERSION = 1;
const PROJECT_STORE = 'projects';
const EXPORT_FORMAT = 'sushi-project';
const EXPORT_VERSION = 1;

export interface StoredProjectSnapshot {
	project: ProjectDocumentV1;
	activeRevision: number | null;
}

export type StoredProjectRecord = ProjectDocumentV1 & {
	activeRevision: number | null;
	savedAt: number;
};

export interface ProjectExportV1 {
	format: 'sushi-project';
	formatVersion: 1;
	exportedAt: string;
	snapshot: StoredProjectSnapshot;
}

let lastSaveStamp = 0;

function storageUnavailable(): Error {
	return new Error('IndexedDB is unavailable in this browser context.');
}

function openDatabase(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') return Promise.reject(storageUnavailable());

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(PROJECT_STORE)) {
				database.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? storageUnavailable());
		request.onblocked = () => reject(new Error('The Sushi project database is blocked by another browser tab.'));
	});
}

function closeAfter<T>(database: IDBDatabase, operation: Promise<T>): Promise<T> {
	return operation.finally(() => database.close());
}

function nextSaveStamp(): number {
	const now = Date.now();
	lastSaveStamp = Math.max(now, lastSaveStamp + 1);
	return lastSaveStamp;
}

function projectRecord(snapshot: StoredProjectSnapshot, savedAt = nextSaveStamp()): StoredProjectRecord {
	return {
		...snapshot.project,
		activeRevision: snapshot.activeRevision,
		savedAt,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isAssetManifestEntry(value: unknown): value is AssetManifestEntry {
	if (!isRecord(value)) return false;
	const requiredStrings = ['id', 'alias', 'originalName', 'contentHash', 'mimeType', 'storageKey'];
	if (requiredStrings.some((key) => typeof value[key] !== 'string' || !(value[key] as string).trim())) return false;
	if (!isNonNegativeInteger(value.byteLength)) return false;
	return ['sourceUrl', 'license', 'attribution'].every((key) => value[key] === undefined || typeof value[key] === 'string');
}

function isProjectDocument(value: unknown): value is ProjectDocumentV1 {
	if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || !value.name.trim() || !Array.isArray(value.assets)) return false;
	if (!value.assets.every((asset) => isAssetManifestEntry(asset))) return false;
	const source = value.source;
	const timeline = value.timeline;
	if (!isRecord(source) || typeof source.draft !== 'string' || typeof source.lastValid !== 'string' || !isNonNegativeInteger(source.revision) || typeof source.strudelVersion !== 'string') return false;
	if (!isRecord(timeline) || !isRecord(timeline.quarterNotesPerCycle) || !isPositiveNumber(timeline.quarterNotesPerCycle.numerator) || !isPositiveNumber(timeline.quarterNotesPerCycle.denominator)) return false;
	if (timeline.songEndCycleVersion !== undefined && timeline.songEndCycleVersion !== 1) return false;
	return timeline.songEndCycle === undefined || isPositiveNumber(timeline.songEndCycle);
}

function readSnapshot(value: unknown): StoredProjectSnapshot | undefined {
	if (!isRecord(value) || !isProjectDocument(value.project)) return undefined;
	const project = value.project;
	const activeRevision = value.activeRevision;
	if (!(activeRevision === null || isNonNegativeInteger(activeRevision)) || (activeRevision !== null && activeRevision > project.source.revision)) return undefined;
	return { project, activeRevision };
}

/** Serialize a portable, versioned project envelope for local export. */
export function serializeProjectSnapshot(snapshot: StoredProjectSnapshot): string {
	const exportRecord: ProjectExportV1 = {
		format: EXPORT_FORMAT,
		formatVersion: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		snapshot,
	};
	return JSON.stringify(exportRecord, null, 2);
}

/** Parse and validate a project export before it can enter IndexedDB or Strudel. */
export function parseProjectExport(serialized: string): { ok: true; snapshot: StoredProjectSnapshot } | { ok: false; error: Error } {
	if (typeof serialized !== 'string' || !serialized.trim()) return { ok: false, error: new Error('The selected project file is empty.') };
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized) as unknown;
	} catch (error) {
		return { ok: false, error: new Error(`The selected project file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`) };
	}
	if (!isRecord(parsed) || parsed.format !== EXPORT_FORMAT || parsed.formatVersion !== EXPORT_VERSION || typeof parsed.exportedAt !== 'string' || Number.isNaN(Date.parse(parsed.exportedAt))) {
		return { ok: false, error: new Error('The selected file is not a Sushi project export.') };
	}
	const snapshot = readSnapshot(parsed.snapshot);
	if (!snapshot) return { ok: false, error: new Error('The Sushi project export is missing a valid project snapshot.') };
	return { ok: true, snapshot };
}

function readStoredRecord(value: unknown): StoredProjectRecord | undefined {
	if (!isRecord(value) || !isProjectDocument(value)) return undefined;
	const activeRevision = value.activeRevision;
	const savedAt = value.savedAt;
	if (!(activeRevision === null || isNonNegativeInteger(activeRevision)) || (activeRevision !== null && activeRevision > value.source.revision) || !isPositiveNumber(savedAt)) return undefined;
	return value as unknown as StoredProjectRecord;
}

/**
 * Decide whether an incoming snapshot may replace the current record. The
 * check runs inside the IndexedDB readwrite transaction, so overlapping saves
 * cannot let an older revision overwrite a newer one.
 */
export function shouldReplaceStoredRecord(existing: StoredProjectRecord | undefined, incoming: StoredProjectRecord): boolean {
	if (!existing) return true;
	const existingRevision = existing.source.revision;
	const incomingRevision = incoming.source.revision;
	if (incomingRevision !== existingRevision) return incomingRevision > existingRevision;
	return incoming.savedAt >= existing.savedAt;
}

export async function loadProjectSnapshot(projectId: string): Promise<StoredProjectSnapshot | null> {
	const database = await openDatabase();
	return closeAfter(database, new Promise((resolve, reject) => {
		const transaction = database.transaction(PROJECT_STORE, 'readonly');
		const request = transaction.objectStore(PROJECT_STORE).get(projectId);
		request.onsuccess = () => {
			const record = readStoredRecord(request.result);
			if (!record || record.id !== projectId) {
				resolve(null);
				return;
			}

			const { activeRevision, savedAt: _savedAt, ...project } = record;
			resolve({ project, activeRevision });
		};
		request.onerror = () => reject(request.error ?? storageUnavailable());
		transaction.onerror = () => reject(transaction.error ?? storageUnavailable());
	}));
}

export async function saveProjectSnapshot(projectId: string, snapshot: StoredProjectSnapshot): Promise<void> {
	const incoming = projectRecord(snapshot);
	const database = await openDatabase();
	return closeAfter(database, new Promise((resolve, reject) => {
		const transaction = database.transaction(PROJECT_STORE, 'readwrite');
		const store = transaction.objectStore(PROJECT_STORE);
		const request = store.get(projectId);
		request.onsuccess = () => {
			const existing = readStoredRecord(request.result);
			if (shouldReplaceStoredRecord(existing, incoming)) store.put({ ...incoming, id: projectId });
		};
		request.onerror = () => reject(request.error ?? storageUnavailable());
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? storageUnavailable());
		transaction.onabort = () => reject(transaction.error ?? storageUnavailable());
	}));
}
