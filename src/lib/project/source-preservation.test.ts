import { describe, expect, test } from 'bun:test';
import { extendNoteGridSourceRange } from './note-grid';
import { createInitialProject } from './model';
import { parseProjectExport, serializeProjectSnapshot } from './storage';
import { updateTrackRange } from './source-mapper';
import { normalizeImportedSnapshot } from '../../components/studio/helpers';

const fixtureSource = `setcpm(120 / 4)
const key = "C:major"

// @sushi-track {"id":"trk_notes","name":"Notes","type":"synth","schema":1}
$: seqPLoop([0, 4, note("c4 ~ eb4 g4")]).s("triangle")

// @sushi-track {"id":"trk_other","name":"Other","type":"synth","schema":1}
$: note("a3 b3").s("sine").gain(0.2) // authored source
`;

describe('project source preservation', () => {
	test('loading and saving an untouched project preserves source bytes', () => {
		const project = createInitialProject();
		project.source = { ...project.source, draft: fixtureSource, lastValid: fixtureSource, revision: 7 };
		const parsed = parseProjectExport(serializeProjectSnapshot({ project, activeRevision: 7 }));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.snapshot.project.source.draft).toBe(fixtureSource);
		expect(parsed.snapshot.project.source.lastValid).toBe(fixtureSource);
	});

	test('restoring an imported draft and last-valid source preserves source bytes', () => {
		const project = createInitialProject();
		const draft = `${fixtureSource.replace('.s("triangle")', '.s("triangle").slow(7)')}// draft spacing\n`;
		const lastValid = `${fixtureSource.replace('.s("triangle")', '.s("triangle").slow(7)')}// accepted spacing\n`;
		project.source = { ...project.source, draft, lastValid, revision: 3 };
		const restored = normalizeImportedSnapshot({ project, activeRevision: 3 });
		expect(restored.project.source.draft).toBe(draft);
		expect(restored.project.source.lastValid).toBe(lastValid);
		expect(restored.project.source.draft).toContain('.slow(7)');
		expect(restored.project.source.lastValid).toContain('.slow(7)');
	});

	test('explicit range edits do not add an implicit slow transformation', () => {
		const extended = extendNoteGridSourceRange(fixtureSource, 'trk_notes', 4, 6);
		expect(extended).not.toContain('.slow(');
	});

	test('an unrelated track range edit leaves other source unchanged', () => {
		const updated = updateTrackRange(fixtureSource, 'trk_notes', 0, 6);
		expect(updated).toContain('$: note("a3 b3").s("sine").gain(0.2) // authored source');
	});
});
