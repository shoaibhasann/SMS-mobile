import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createSecureSessionStorage } from '../src/auth/secure-storage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const values = new Map<string, string>();
  let generation = 0;
  const store = {
    getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    deleteItemAsync: vi.fn(async (key: string) => { values.delete(key); }),
  };
  return { store, values, storage: createSecureSessionStorage(store, () => `generation-${++generation}`) };
}

describe('Native secure session storage', () => {
  it('round-trips a large Unicode session while keeping each Keychain entry below 2 KB', async () => {
    const f = fixture(), value = JSON.stringify({ name: 'हिन्दी 👩🏽‍🏫 '.repeat(700), access_token: 'test-only' });
    await f.storage.setItem('session', value);
    expect(await f.storage.getItem('session')).toBe(value);
    expect(f.store.setItemAsync.mock.calls.length).toBeGreaterThan(2);
    for (const [, stored] of f.store.setItemAsync.mock.calls) expect(Buffer.byteLength(stored, 'utf8')).toBeLessThan(2048);
    await f.storage.removeItem('session'); expect(f.values.size).toBe(0);
    expect(await f.storage.getItem('session')).toBeNull();
  });

  it('publishes a new session only after all new chunks exist, then removes the old generation', async () => {
    const f = fixture(); await f.storage.setItem('session', 'old session');
    const save = f.store.setItemAsync.getMockImplementation()!;
    f.store.setItemAsync.mockImplementation(async (key, value) => {
      if (key === 'session' && value.includes('generation-2')) {
        expect(f.values.get('session.generation-2.0')).toBe('new session');
        expect(f.values.get('session')).toContain('generation-1');
        expect(f.values.get('session.generation-1.0')).toBe('old session');
      }
      await save(key, value);
    });
    await f.storage.setItem('session', 'new session');
    expect(await f.storage.getItem('session')).toBe('new session');
    expect(f.values.has('session.generation-1.0')).toBe(false);
  });

  it('waits for a late chunk write before cleaning up a failed generation and preserves the old session', async () => {
    const f = fixture(); await f.storage.setItem('session', 'old session');
    const save = f.store.setItemAsync.getMockImplementation()!;
    let finish!: () => void;
    const late = new Promise<void>(done => { finish = done; });
    f.store.setItemAsync.mockImplementation(async (key, value) => {
      if (key === 'session.generation-2.0') throw new Error('Keychain write failed.');
      if (key === 'session.generation-2.1') await late;
      await save(key, value);
    });
    const writing = f.storage.setItem('session', 'x'.repeat(450));
    const failed = expect(writing).rejects.toThrow('Keychain write failed.');
    await Promise.resolve(); expect(f.values.get('session.generation-1.0')).toBe('old session');
    finish(); await failed;
    expect([...f.values.keys()].some(key => key.startsWith('session.generation-2.'))).toBe(false);
    expect(await f.storage.getItem('session')).toBe('old session');
  });

  it('keeps a fully committed session intact if native pointer publication commits but reports an error', async () => {
    const f = fixture(); await f.storage.setItem('session', 'old session');
    const save = f.store.setItemAsync.getMockImplementation()!;
    f.store.setItemAsync.mockImplementation(async (key, value) => {
      await save(key, value);
      if (key === 'session') throw new Error('Acknowledgment lost.');
    });
    await expect(f.storage.setItem('session', 'new session')).rejects.toThrow('Acknowledgment lost.');
    expect(await f.storage.getItem('session')).toBe('new session');
    await f.storage.removeItem('session'); expect(await f.storage.getItem('session')).toBeNull();
  });

  it('retains the old session if pointer publication fails before committing', async () => {
    const f = fixture(); await f.storage.setItem('session', 'old session');
    const save = f.store.setItemAsync.getMockImplementation()!;
    f.store.setItemAsync.mockImplementation(async (key, value) => {
      if (key === 'session') throw new Error('Keychain locked.');
      await save(key, value);
    });
    await expect(f.storage.setItem('session', 'new session')).rejects.toThrow('Keychain locked.');
    expect(await f.storage.getItem('session')).toBe('old session');
  });

  it.each(['{broken', 'null', '[]', '"wrong"', '{"generation":"../../bad","count":1}', '{"generation":"valid","count":65}'])(
    'discards corrupt metadata as signed out and still permits sign-out (%s)', async raw => {
      const f = fixture(); f.values.set('session', raw);
      expect(await f.storage.getItem('session')).toBeNull();
      expect(f.values.has('session')).toBe(false);
      await f.storage.removeItem('session'); expect(f.values.has('session')).toBe(false);
      expect(await f.storage.getItem('session')).toBeNull();
    },
  );

  it('allows an explicit new sign-in to replace a corrupt pointer', async () => {
    const f = fixture(); f.values.set('session', '{broken');
    await f.storage.setItem('session', 'new session'); expect(await f.storage.getItem('session')).toBe('new session');
  });

  it('does not reconstruct a partial sign-in when a chunk is missing', async () => {
    const f = fixture(); await f.storage.setItem('session', 'x'.repeat(450));
    f.values.delete('session.generation-1.1');
    expect(await f.storage.getItem('session')).toBeNull(); expect(f.values.size).toBe(0);
    await f.storage.removeItem('session'); expect(await f.storage.getItem('session')).toBeNull();
  });

  it('deletes the session pointer even when metadata cannot be read or old chunk deletion fails', async () => {
    const f = fixture(); await f.storage.setItem('session', 'old session');
    f.store.getItemAsync.mockRejectedValueOnce(new Error('Metadata unavailable.'));
    await f.storage.removeItem('session'); expect(f.values.has('session')).toBe(false);
    f.store.getItemAsync.mockRestore();
    const another = fixture(); await another.storage.setItem('session', 'old session');
    const remove = another.store.deleteItemAsync.getMockImplementation()!;
    another.store.deleteItemAsync.mockImplementation(async key => {
      if (key !== 'session') throw new Error('Chunk deletion failed.');
      await remove(key);
    });
    await another.storage.removeItem('session'); expect(await another.storage.getItem('session')).toBeNull();
  });

  it('never confirms sign-out if native deletion of the session pointer fails', async () => {
    const f = fixture(); await f.storage.setItem('session', 'old session');
    f.store.deleteItemAsync.mockRejectedValue(new Error('Keychain unavailable.'));
    await expect(f.storage.removeItem('session')).rejects.toThrow('Keychain unavailable.');
    expect(await f.storage.getItem('session')).toBe('old session');
  });

  it('rejects an oversized replacement before modifying the saved session', async () => {
    const f = fixture(); await f.storage.setItem('session', 'old session');
    await expect(f.storage.setItem('session', '🙂'.repeat(25_601))).rejects.toThrow('Sign-in data is too large');
    expect(await f.storage.getItem('session')).toBe('old session');
  });

  it('serializes a pending refresh write before logout so the write cannot resurrect the session afterward', async () => {
    const f = fixture(); await f.storage.setItem('session', 'old session');
    const writingChunk = deferred<void>(), finishChunk = deferred<void>(), save = f.store.setItemAsync.getMockImplementation()!;
    f.store.setItemAsync.mockImplementation(async (key, value) => {
      if (key === 'session.generation-2.0') { writingChunk.resolve(); await finishChunk.promise; }
      await save(key, value);
    });
    const writing = f.storage.setItem('session', 'refreshed session'); await writingChunk.promise;
    const removing = f.storage.removeItem('session');
    await Promise.resolve(); expect(f.store.deleteItemAsync).not.toHaveBeenCalledWith('session');
    finishChunk.resolve(); await Promise.all([writing, removing]);
    expect(await f.storage.getItem('session')).toBeNull(); expect(f.values.size).toBe(0);
  });

  it('finishes an in-flight read before replacing and deleting its chunk generation', async () => {
    const f = fixture(); await f.storage.setItem('session', 'old session');
    const readingChunk = deferred<void>(), finishRead = deferred<void>(), read = f.store.getItemAsync.getMockImplementation()!;
    f.store.getItemAsync.mockImplementation(async key => {
      if (key === 'session.generation-1.0') { readingChunk.resolve(); await finishRead.promise; }
      return read(key);
    });
    const reading = f.storage.getItem('session'); await readingChunk.promise;
    const previousWrites = f.store.setItemAsync.mock.calls.length;
    const replacing = f.storage.setItem('session', 'new session');
    await Promise.resolve(); expect(f.store.setItemAsync).toHaveBeenCalledTimes(previousWrites);
    expect(f.values.has('session.generation-1.0')).toBe(true);
    finishRead.resolve(); expect(await reading).toBe('old session'); await replacing;
    expect(await f.storage.getItem('session')).toBe('new session'); expect(f.values.has('session.generation-1.0')).toBe(false);
  });

  it('does not silently discard a valid session when native Keychain reads fail', async () => {
    const f = fixture(); await f.storage.setItem('session', 'old session');
    const read = f.store.getItemAsync.getMockImplementation()!;
    f.store.getItemAsync.mockRejectedValueOnce(new Error('Keychain locked.'));
    await expect(f.storage.getItem('session')).rejects.toThrow('Keychain locked.');
    f.store.getItemAsync.mockImplementation(async key => {
      if (key === 'session.generation-1.0') throw new Error('Keychain inaccessible.');
      return read(key);
    });
    await expect(f.storage.getItem('session')).rejects.toThrow('Keychain inaccessible.');
    expect(f.store.deleteItemAsync).not.toHaveBeenCalled();
    f.store.getItemAsync.mockImplementation(read); expect(await f.storage.getItem('session')).toBe('old session');
  });

  it.each(['{broken', '{"generation":"missing-parts","count":2}'])(
    'lets the actual Supabase SDK recover corrupt cache, emit signed-out cleanup and complete local logout (%s)', async raw => {
      const f = fixture(); f.values.set('qa-session', raw);
      const remove = vi.spyOn(f.storage, 'removeItem'), cleanup = vi.fn();
      const fetch = vi.fn(async () => { throw new Error('Network is prohibited in this storage regression.'); });
      const client = createClient('https://example.supabase.co', 'synthetic-public-key', {
        auth: { storage: f.storage, storageKey: 'qa-session', autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
        global: { fetch },
      });
      const listener = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) cleanup();
      });
      try {
        const session = await client.auth.getSession();
        expect(session.error).toBeNull(); expect(session.data.session).toBeNull();
        const logout = await client.auth.signOut({ scope: 'local' });
        expect(logout.error).toBeNull(); expect(f.values.has('qa-session')).toBe(false);
        expect(remove).toHaveBeenCalledWith('qa-session'); expect(cleanup).toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      } finally { listener.data.subscription.unsubscribe(); client.auth.stopAutoRefresh(); }
    },
  );
});
