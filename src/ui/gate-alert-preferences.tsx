import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GateAlertError, loadGateAlertPreferences, saveGateAlertPreferences, type GateAlertPreference } from '../data/gate-alerts';
import { Button, Card, ErrorCard, Skeleton, Text } from './primitives';
import { useLoad } from './use-load';
import { usePalette } from './theme';

export function GateAlertPreferences({ client, userId, onChanged }: { client: SupabaseClient; userId: string; onChanged(): void }) {
  const p = usePalette();
  const active = useRef(new Set<string>()), live = useRef(true), [busy, setBusy] = useState(false);
  useEffect(() => {
    const operations = active.current;
    live.current = true;
    return () => { live.current = false; operations.clear(); };
  }, []);
  const changedBusy = useCallback((id: string, pending: boolean) => {
    if (pending && active.current.size > 0) return false;
    if (pending) active.current.add(id); else active.current.delete(id);
    if (live.current) setBusy(active.current.size > 0);
    return true;
  }, []);
  const read = useCallback((signal: AbortSignal) => loadGateAlertPreferences(client, userId, signal), [client, userId]);
  const settings = useLoad(userId, read);
  const refresh = () => { if (!active.current.size) settings.reload(); };
  return <View style={{ gap: 12 }}>
    <Card><Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700' }}>Arrival &amp; exit alerts</Text>
      <Text style={{ color: p.muted }}>Optional for each child. Changes save automatically. Absent attendance alerts remain available even when both options are off.</Text>
      <Text style={{ color: p.muted, fontSize: 12 }}>These options control your school inbox. They do not enable phone push or SMS. Turning an option on does not backfill missed scans; retained alerts can become visible again.</Text>
      <Button label="Refresh gate alert settings" secondary disabled={busy} onPress={refresh} />
    </Card>
    {settings.loading ? <Skeleton rows={1} /> : settings.error ? <ErrorCard message={settings.error} retry={refresh} />
      : settings.data?.length === 0 ? <Card><Text>No linked children with attendance access are available.</Text></Card>
        : settings.data?.map((row, _, rows) => <GatePreference key={`${userId}:${row.preference_id}:${row.version}`} client={client} userId={userId} initial={row} showStudentName={rows.length > 1}
          onChanged={onChanged} onBusy={changedBusy} locked={busy} onAccessChanged={settings.reload} />)}
  </View>;
}

function GatePreference({ client, userId, initial, showStudentName, onChanged, onBusy, onAccessChanged, locked }: { client: SupabaseClient; userId: string; initial: GateAlertPreference; showStudentName: boolean;
  onChanged(): void; onBusy(id: string, busy: boolean): boolean; onAccessChanged(): void; locked: boolean }) {
  const p = usePalette(), [current, setCurrent] = useState(initial);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); onBusy(initial.preference_id, false); }; }, [onBusy, initial.preference_id]);
  async function save(field: 'arrival_enabled' | 'exit_enabled', value: boolean) {
    if (!alive.current || pending.current || error || !onBusy(initial.preference_id, true)) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true);
    try {
      const saved = await saveGateAlertPreferences(client, userId, { ...current, [field]: value }, controller.signal);
      if (alive.current && !controller.signal.aborted) { setCurrent(saved); onChanged(); }
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'The change could not be confirmed. Refresh saved settings.');
        onChanged();
        if (cause instanceof GateAlertError && cause.code === 'access') onAccessChanged();
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null; onBusy(initial.preference_id, false);
        if (alive.current && !controller.signal.aborted) setBusy(false);
      }
    }
  }
  return <Card>
    {showStudentName && <Text accessibilityRole="header" style={{ fontWeight: '700' }}>{current.student_name}</Text>}
    {(['arrival_enabled', 'exit_enabled'] as const).map(field => <View key={field} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text>{field === 'arrival_enabled' ? 'Arrival' : 'Exit'}</Text>
      <Switch accessibilityLabel={`${field === 'arrival_enabled' ? 'Arrival' : 'Exit'} alerts for ${current.student_name}`}
        value={current[field]} disabled={busy || locked || !!error} onValueChange={value => void save(field, value)}
        trackColor={{ false: p.border, true: p.primary }} thumbColor={current[field] ? p.onPrimary : p.muted} ios_backgroundColor={p.border} />
    </View>)}
    {busy && <Text accessibilityRole="progressbar" style={{ color: p.muted }}>Saving settings…</Text>}
    {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: p.danger }}>{error} Use “Refresh gate alert settings” before another change.</Text>}
  </Card>;
}
