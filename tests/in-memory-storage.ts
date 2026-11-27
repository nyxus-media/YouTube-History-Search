import type { StorageAdapter } from "../src/domain/types.js";

export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.store.has(key)) {
      return undefined;
    }
    return structuredClone(this.store.get(key)) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  keys(): string[] {
    return Array.from(this.store.keys()).sort();
  }
}
