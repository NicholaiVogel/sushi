import type { ProjectDocumentV1 } from './model';

const DATABASE_NAME = 'sushi-projects';
const DATABASE_VERSION = 1;
const PROJECT_STORE = 'projects';

export interface StoredProjectSnapshot {
	project: ProjectDocumentV1;
	activeRevision: number | null;
}

type StoredProjectRecord = ProjectDocumentV1 & {
	activeRevision: number | null;
	savedAt: number;
};

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

function projectRecord(snapshot: StoredProjectSnapshot): StoredProjectRecord {
	return {
		...snapshot.project,
		activeRevision: snapshot.activeRevision,
		savedAt: Date.now(),
	};
}

export async function loadProjectSnapshot(projectId: string): Promise<StoredProjectSnapshot | null> {
	const database = await openDatabase();
	return closeAfter(database, new Promise((resolve, reject) => {
		const transaction = database.transaction(PROJECT_STORE, 'readonly');
		const request = transaction.objectStore(PROJECT_STORE).get(projectId);
		request.onsuccess = () => {
			const record = request.result as StoredProjectRecord | undefined;
			if (!record) {
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
	const database = await openDatabase();
	return closeAfter(database, new Promise((resolve, reject) => {
		const transaction = database.transaction(PROJECT_STORE, 'readwrite');
		transaction.objectStore(PROJECT_STORE).put({ ...projectRecord(snapshot), id: projectId });
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? storageUnavailable());
		transaction.onabort = () => reject(transaction.error ?? storageUnavailable());
	}));
}
