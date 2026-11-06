import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

export function useLoad<T>(key: string, read: (signal: AbortSignal) => Promise<T>) {
  const [revision, setRevision] = useState(0);
  const loadKey = JSON.stringify([key, revision]);
  const [snapshot, setSnapshot] = useState<{ key: string; loading: boolean; data: T | null; error: string | null }>({ key: '', loading: true, data: null, error: null });
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    setSnapshot({ key: loadKey, loading: true, data: null, error: null });
    void read(controller.signal).then(data => {
      if (!controller.signal.aborted) setSnapshot({ key: loadKey, loading: false, data, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setSnapshot({ key: loadKey, loading: false, data: null,
        error: error instanceof Error ? error.message : 'School records could not be loaded. Retry.' });
    });
    return () => controller.abort();
  }, [loadKey, read]));
  return { ...(snapshot.key === loadKey ? snapshot : { loading: true, data: null, error: null }), reload: () => setRevision(value => value + 1) };
}
