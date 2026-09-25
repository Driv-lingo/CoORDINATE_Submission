import { config } from "@/config";
import { CosmosRepository } from "./cosmosRepository";
import { MemoryRepository } from "./memoryRepository";
import type { Repository } from "./repository";

const g = globalThis as unknown as { __coordinateRepo?: Repository; __coordinateRepoVersion?: number };
/** Bump when the Repository contract changes so a hot-reloaded dev server rebuilds the instance. */
const REPO_VERSION = 4;

/** Cosmos DB when configured, otherwise the in-memory store. One instance per process. */
export function getRepository(): Repository {
  if (!g.__coordinateRepo || g.__coordinateRepoVersion !== REPO_VERSION) {
    g.__coordinateRepoVersion = REPO_VERSION;
    const c = config().cosmos;
    g.__coordinateRepo = c ? new CosmosRepository(c) : new MemoryRepository();
  }
  return g.__coordinateRepo;
}

export type { Repository };
