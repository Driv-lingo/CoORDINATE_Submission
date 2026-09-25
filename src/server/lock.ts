/**
 * Serializes state-changing operations per workspace inside this process, so
 * check-then-write sequences (dispatch gate → save) cannot interleave. Correct
 * for a single App Service instance; a scaled-out deployment would add Cosmos
 * DB optimistic concurrency (ETags) on the responder documents.
 */
const g = globalThis as unknown as { __coordinateLocks?: Map<string, Promise<unknown>> };
const locks = (g.__coordinateLocks ??= new Map());

export async function withWorkspaceLock<T>(ws: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(ws) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => (release = r));
  const chained = previous.then(() => current);
  locks.set(ws, chained);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(ws) === chained) locks.delete(ws);
  }
}
