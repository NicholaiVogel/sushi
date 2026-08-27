import { describe, expect, test } from 'bun:test';
import { stableSerialize, TransactionCache, TransactionReuseError } from './transaction-cache';

describe('WebMCP transaction cache', () => {
	test('scopes IDs by action and shares concurrent retries', async () => {
		const cache = new TransactionCache<string>(10);
		let calls = 0;
		let release: (() => void) | undefined;
		const first = cache.run('write_strudel_source', 'same-id', async () => {
			calls += 1;
			await new Promise<void>((resolve) => { release = resolve; });
			return 'write-result';
		});
		const retry = cache.run('write_strudel_source', 'same-id', async () => {
			calls += 1;
			return 'duplicate-result';
		});
		const otherAction = cache.run('patch_strudel_source', 'same-id', async () => {
			calls += 1;
			return 'patch-result';
		});

		expect(retry).toBe(first);
		release?.();
		expect(await first).toBe('write-result');
		expect(await retry).toBe('write-result');
		expect(await otherAction).toBe('patch-result');
		expect(calls).toBe(2);
		expect(cache.get('write_strudel_source', 'same-id')).toBe('write-result');
		expect(cache.get('patch_strudel_source', 'same-id')).toBe('patch-result');
	});

	test('allows a failed transaction ID to retry cleanly', async () => {
		const cache = new TransactionCache<string>();
		let calls = 0;
		await expect(cache.run('write_strudel_source', 'retry', async () => {
			calls += 1;
			throw new Error('temporary bridge failure');
		})).rejects.toThrow('temporary bridge failure');

		expect(await cache.run('write_strudel_source', 'retry', async () => {
			calls += 1;
			return 'recovered';
		})).toBe('recovered');
		expect(calls).toBe(2);
	});

	test('caches an undefined result instead of running it again', async () => {
		const cache = new TransactionCache<undefined>();
		let calls = 0;
		expect(await cache.run('write', 'undefined-result', () => {
			calls += 1;
			return undefined;
		})).toBeUndefined();
		expect(await cache.run('write', 'undefined-result', () => {
			calls += 1;
			return undefined;
		})).toBeUndefined();
		expect(calls).toBe(1);
	});

	test('rejects reusing a transaction ID for a different payload', async () => {
		const cache = new TransactionCache<string>();
		expect(await cache.run('write', 'same-id', () => 'first', '{"source":"one"}')).toBe('first');
		await expect(cache.run('write', 'same-id', () => 'second', '{"source":"two"}')).rejects.toBeInstanceOf(TransactionReuseError);
	});

	test('fingerprints JSON-shaped payloads independent of object-key order', async () => {
		const cache = new TransactionCache<string>();
		const firstInput = { source: 'one', baseRevision: 2, nested: { b: true, a: 1 } };
		const equivalentInput = { nested: { a: 1, b: true }, baseRevision: 2, source: 'one' };
		expect(stableSerialize(firstInput)).toBe(stableSerialize(equivalentInput));
		expect(await cache.run('write', 'same-id', () => 'first', stableSerialize(firstInput))).toBe('first');
		expect(await cache.run('write', 'same-id', () => 'retry', stableSerialize(equivalentInput))).toBe('first');
	});

	test('evicts the oldest completed result at its bound', async () => {
		const cache = new TransactionCache<string>(2);
		await cache.run('write', 'one', () => 'one');
		await cache.run('write', 'two', () => 'two');
		await cache.run('write', 'three', () => 'three');

		expect(cache.get('write', 'one')).toBeUndefined();
		expect(cache.get('write', 'two')).toBe('two');
		expect(cache.get('write', 'three')).toBe('three');
	});

	test('does not let a cleared in-flight operation repopulate the cache', async () => {
		const cache = new TransactionCache<string>();
		let release: (() => void) | undefined;
		const pending = cache.run('write', 'stale', async () => {
			await new Promise<void>((resolve) => { release = resolve; });
			return 'stale-result';
		});

		cache.clear();
		release?.();
		expect(await pending).toBe('stale-result');
		expect(cache.get('write', 'stale')).toBeUndefined();
		expect(await cache.run('write', 'stale', () => 'fresh-result')).toBe('fresh-result');
	});

	test('does not let a late failure erase a fresh transaction fingerprint', async () => {
		const cache = new TransactionCache<string>();
		let rejectStale: ((error: Error) => void) | undefined;
		const stale = cache.run('write', 'reused', () => new Promise<string>((_resolve, reject) => {
			rejectStale = reject;
		}), '{"source":"stale"}');

		cache.clear();
		const fresh = cache.run('write', 'reused', () => 'fresh', '{"source":"fresh"}');
		rejectStale?.(new Error('stale operation failed'));
		await expect(stale).rejects.toThrow('stale operation failed');
		expect(await fresh).toBe('fresh');
		await expect(cache.run('write', 'reused', () => 'wrong', '{"source":"wrong"}')).rejects.toBeInstanceOf(TransactionReuseError);
	});
});
