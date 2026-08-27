/**
 * Bounded idempotency cache for source mutations.
 *
 * A transaction ID is scoped to the tool that receives it. Keeping the action
 * in the cache key prevents a caller reusing an ID for a different mutation
 * from receiving an unrelated result. In-flight operations are shared too,
 * so concurrent retries cannot apply the same edit twice.
 */
export class TransactionCache<T> {
	private readonly completed = new Map<string, T>();
	private readonly pending = new Map<string, Promise<T>>();
	private readonly fingerprints = new Map<string, string>();
	private generation = 0;

	public constructor(private readonly limit = 100) {}

	public clear(): void {
		// A late result from an operation that was in flight before clear() must
		// not repopulate the cache after a new studio session starts.
		this.generation += 1;
		this.completed.clear();
		this.pending.clear();
		this.fingerprints.clear();
	}

	public get(action: string, transactionId: string): T | undefined {
		return this.completed.get(this.key(action, transactionId));
	}

	/** Store a result produced by a caller that manages its own async flow. */
	public set(action: string, transactionId: string, result: T): void {
		this.completed.set(this.key(action, transactionId), result);
		this.trimCompleted();
	}

	public run(action: string, transactionId: string, operation: () => T | Promise<T>, fingerprint?: string): Promise<T> {
		const key = this.key(action, transactionId);
		const existingFingerprint = this.fingerprints.get(key);
		if (existingFingerprint !== undefined && fingerprint !== undefined && existingFingerprint !== fingerprint) {
			return Promise.reject(new TransactionReuseError());
		}
		// `undefined` is a valid generic result. Use `has()` rather than the
		// value as the cache sentinel so a completed operation is never repeated
		// merely because its result happens to be undefined.
		if (this.completed.has(key)) return Promise.resolve(this.completed.get(key) as T);

		const existing = this.pending.get(key);
		if (existing) return existing;

		let operationPromise: Promise<T>;
		try {
			operationPromise = Promise.resolve(operation());
		} catch (error) {
			return Promise.reject(error);
		}

		const generation = this.generation;
		if (fingerprint !== undefined) this.fingerprints.set(key, fingerprint);
		let tracked: Promise<T>;
		tracked = operationPromise.then(
			(result) => {
				if (this.pending.get(key) === tracked) this.pending.delete(key);
				if (this.generation === generation) {
					this.completed.set(key, result);
					this.trimCompleted();
				}
				return result;
			},
		(error) => {
			if (this.pending.get(key) === tracked) this.pending.delete(key);
			// A failed operation may settle after clear() and after a new operation
			// has claimed the same transaction key. Only the generation that created
			// this fingerprint may remove it; otherwise a late rejection could make
			// the new transaction reusable with a different payload.
			if (this.generation === generation && this.fingerprints.get(key) === fingerprint) this.fingerprints.delete(key);
			throw error;
		},
		);
		this.pending.set(key, tracked);
		return tracked;
	}

	private key(action: string, transactionId: string): string {
		// JSON encoding avoids collisions when either component contains a colon
		// or another separator that a host-generated ID might legally include.
		return JSON.stringify([action, transactionId]);
	}

	private trimCompleted(): void {
		const limit = Number.isFinite(this.limit) ? Math.max(1, Math.floor(this.limit)) : 100;
		while (this.completed.size > limit) {
			const first = this.completed.keys().next().value as string | undefined;
			if (first === undefined) break;
			this.completed.delete(first);
			this.fingerprints.delete(first);
		}
	}
}

/**
 * Produce a deterministic fingerprint for JSON-shaped tool input. Native
 * callers may serialize the same payload with a different object-key order;
 * those retries should still resolve to the original idempotent result.
 */
export function stableSerialize(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		const serialized = JSON.stringify(value);
		return serialized === undefined ? String(value) : serialized;
	}
	if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
}

/** Raised when a caller reuses an id for different transaction payloads. */
export class TransactionReuseError extends Error {
	public constructor() {
		super('This transaction ID was already used for a different payload.');
		this.name = 'TransactionReuseError';
	}
}
