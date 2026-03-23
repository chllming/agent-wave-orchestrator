import { MemoryWaveControlStore } from "./memory-store.mjs";
import { createBucketStorage } from "./storage.mjs";

export async function createWaveControlStore(config) {
  const storage = await createBucketStorage(config);
  if (config.postgres.databaseUrl) {
    const { PostgresWaveControlStore } = await import("./postgres-store.mjs");
    const store = new PostgresWaveControlStore({ config, storage });
    await store.init();
    return store;
  }
  const store = new MemoryWaveControlStore();
  await store.init();
  store.storage = storage;
  return store;
}
