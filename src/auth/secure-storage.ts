type Store = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};
type Manifest = { generation: string; count: number };
function manifest(raw: string | null): Manifest | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const entry = value as Record<string, unknown>;
    if (typeof entry.generation !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(entry.generation)
      || typeof entry.count !== 'number' || !Number.isInteger(entry.count) || entry.count < 1 || entry.count > 64) throw new Error();
    return { generation: entry.generation, count: entry.count };
  } catch {
    throw new Error('Saved sign-in could not be verified. Sign in again.');
  }
}

export function createSecureSessionStorage(store: Store, generation: () => string) {
  let pending: Promise<void> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>) => {
    const result = pending.then(work);
    pending = result.then(() => {}, () => {});
    return result;
  };
  const removeParts = async (key: string, old: Manifest | null) => {
    if (old) await Promise.all(Array.from({ length: old.count }, (_, i) => store.deleteItemAsync(`${key}.${old.generation}.${i}`)));
  };
  return {
    getItem(key: string) { return serialized(async () => {
      const raw = await store.getItemAsync(key);
      let entry: Manifest | null;
      try { entry = manifest(raw); }
      catch {
        // Invalid local bytes cannot authenticate; unlike native I/O errors, this cache is safe to discard.
        await store.deleteItemAsync(key);
        return null;
      }
      if (!entry) return null;
      const parts = await Promise.all(Array.from({ length: entry.count }, (_, i) => store.getItemAsync(`${key}.${entry.generation}.${i}`)));
      if (parts.some(part => part === null)) {
        await store.deleteItemAsync(key);
        await removeParts(key, entry).catch(() => {});
        return null;
      }
      return parts.join('');
    }); },
    setItem(key: string, value: string) { return serialized(async () => {
      const raw = await store.getItemAsync(key);
      let old: Manifest | null = null;
      try { old = manifest(raw); } catch { /* A new sign-in can replace a corrupt pointer. */ }
      // Keep each native Keychain value small; publish the pointer only after all parts exist.
      const points = Array.from(value), parts: string[] = [];
      for (let i = 0; i < points.length; i += 400) parts.push(points.slice(i, i + 400).join(''));
      if (!parts.length) parts.push('');
      if (parts.length > 64) throw new Error('Sign-in data is too large to save securely.');
      const next = { generation: generation(), count: parts.length };
      const writes = await Promise.allSettled(parts.map((part, i) => store.setItemAsync(`${key}.${next.generation}.${i}`, part)));
      const failure = writes.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') {
        await removeParts(key, next).catch(() => {});
        throw failure.reason;
      }
      // A native write can commit before its promise rejects. Keep the parts if pointer publication is uncertain.
      await store.setItemAsync(key, JSON.stringify(next));
      await removeParts(key, old).catch(() => {});
    }); },
    removeItem(key: string) { return serialized(async () => {
      let old: Manifest | null = null;
      try { old = manifest(await store.getItemAsync(key)); } catch { /* Corrupt metadata must not prevent sign-out. */ }
      await store.deleteItemAsync(key);
      await removeParts(key, old).catch(() => {});
    }); },
  };
}
