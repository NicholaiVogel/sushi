import { describe, expect, test } from 'bun:test';
import { createInitialProject, type ProjectDocumentV1 } from './model';
import { shouldReplaceStoredRecord, type StoredProjectRecord } from './storage';

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
