import { describe, expect, test } from 'bun:test';
import { createInitialProject, type ProjectDocumentV1 } from './model';
import { parseProjectExport, serializeProjectSnapshot, shouldReplaceStoredRecord, type StoredProjectRecord } from './storage';

function record(revision: number, savedAt: number, name = 'First light'): StoredProjectRecord {
	const project: ProjectDocumentV1 = createInitialProject();
	return {
		...project,
		name,
		source: { ...project.source, revision },
		activeRevision: revision,
		savedAt,
	};
}

describe('project storage ordering', () => {
	test('never lets a lower source revision replace a newer record', () => {
		expect(shouldReplaceStoredRecord(record(8, 100), record(7, 900))).toBe(false);
		expect(shouldReplaceStoredRecord(record(7, 900), record(8, 100))).toBe(true);
	});

	test('uses the save stamp to order same-revision metadata changes', () => {
		expect(shouldReplaceStoredRecord(record(4, 200), record(4, 199, 'Older name'))).toBe(false);
		expect(shouldReplaceStoredRecord(record(4, 200), record(4, 201, 'Newer name'))).toBe(true);
	});

	test('accepts the first record for a project', () => {
		expect(shouldReplaceStoredRecord(undefined, record(0, 1))).toBe(true);
	});
});

describe('project export format', () => {
	test('round-trips a versioned project snapshot', () => {
		const project = createInitialProject();
		project.name = 'Portable sketch';
		project.source.revision = 3;
		project.source.draft = `${project.source.draft}// draft\n`;
		project.assets = [{
			id: 'asset_01',
			alias: 'texture',
			originalName: 'texture.wav',
			contentHash: 'sha256:abc',
			mimeType: 'audio/wav',
			byteLength: 128,
			storageKey: 'prj_01JSUSHI/asset_01',
		}];
		const serialized = serializeProjectSnapshot({ project, activeRevision: 3 });
		const parsed = parseProjectExport(serialized);

		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.snapshot).toEqual({ project, activeRevision: 3 });
	});

	test('rejects malformed or incompatible exports before persistence', () => {
		expect(parseProjectExport('not json').ok).toBe(false);
		expect(parseProjectExport(JSON.stringify({ format: 'other', formatVersion: 1, exportedAt: new Date().toISOString(), snapshot: {} })).ok).toBe(false);
		expect(parseProjectExport(JSON.stringify({ format: 'sushi-project', formatVersion: 1, exportedAt: new Date().toISOString(), snapshot: { project: createInitialProject(), activeRevision: 9 } })).ok).toBe(false);
		const invalidAssetProject = createInitialProject();
		invalidAssetProject.assets = [{ id: '', alias: 'texture', originalName: 'texture.wav', contentHash: 'sha256:abc', mimeType: 'audio/wav', byteLength: 128, storageKey: 'prj_01JSUSHI/asset_01' }];
		expect(parseProjectExport(JSON.stringify({ format: 'sushi-project', formatVersion: 1, exportedAt: new Date().toISOString(), snapshot: { project: invalidAssetProject, activeRevision: 0 } })).ok).toBe(false);
		expect(parseProjectExport(JSON.stringify({ format: 'sushi-project', formatVersion: 1, exportedAt: 'not-a-date', snapshot: { project: createInitialProject(), activeRevision: 0 } })).ok).toBe(false);
	});
});
