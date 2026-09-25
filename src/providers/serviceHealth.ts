/**
 * Outcome tracking for request/response services (Azure AI Foundry, Azure Maps
 * geocoding/routing). The data-source panel derives state from these records,
 * so a configured-but-failing service shows DEGRADED, not "connected".
 */

interface Outcome {
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastError?: string;
  successes: number;
  failures: number;
}

const g = globalThis as unknown as { __coordinateServiceHealth?: Map<string, Outcome> };
const store = (g.__coordinateServiceHealth ??= new Map());
const get = (id: string) => {
  let o = store.get(id);
  if (!o) store.set(id, (o = { successes: 0, failures: 0 }));
  return o;
};

export function recordSuccess(id: string) {
  const o = get(id);
  o.lastSuccessAt = Date.now();
  o.successes++;
}

export function recordFailure(id: string, err: unknown) {
  const o = get(id);
  o.lastFailureAt = Date.now();
  o.lastError = ((err as Error)?.message ?? String(err)).slice(0, 200);
  o.failures++;
}

export function serviceOutcome(id: string): Outcome | undefined {
  return store.get(id);
}
