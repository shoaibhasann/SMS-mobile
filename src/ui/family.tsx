import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { listChildren, type FamilyChild } from '../data';
import { useAuth } from '../auth/provider';
import { Card, Text } from './primitives';
import { usePalette } from './theme';

type Family = { children: FamilyChild[]; selected: FamilyChild | null; loading: boolean; error: string | null; select(id: string): void; refresh(): void };
const Context = createContext<Family | null>(null);
export const childName = (child: FamilyChild) => [child.first_name, child.middle_name, child.last_name].filter(Boolean).join(' ');
export function FamilyProvider({ children }: { children: ReactNode }) {
  const { access, role, client } = useAuth();
  const [result, setResult] = useState<{ children: FamilyChild[]; loading: boolean; error: string | null }>({ children: [], loading: true, error: null });
  const [selectedId, setSelectedId] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!access) return;
    const controller = new AbortController();
    void listChildren(client!, access, role, controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      setResult({ children: rows, loading: false, error: null });
      setSelectedId(old => rows.some(child => child.id === old) ? old : rows[0]?.id ?? '');
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ children: [], loading: false, error: 'Your linked student profiles could not be confirmed. Refresh school access.' });
    });
    return () => controller.abort();
  }, [access, role, client, revision]);
  const select = useCallback((id: string) => { if (result.children.some(child => child.id === id)) setSelectedId(id); }, [result.children]);
  return <Context.Provider value={{ ...result, selected: result.children.find(child => child.id === selectedId) ?? null, select, refresh: () => { setResult({ children: [], loading: true, error: null }); setRevision(value => value + 1); } }}>{children}</Context.Provider>;
}
export function useFamily() { const context = useContext(Context); if (!context) throw new Error('Family provider missing.'); return context; }
export function ChildPicker() {
  const family = useFamily(), { role } = useAuth(), p = usePalette();
  if (!family.selected) return null;
  return <Card><Text style={{ color: p.muted, fontSize: 12 }}>{role === 'parent' ? 'YOUR LINKED CHILDREN' : 'YOUR SCHOOL PROFILE'}</Text>
    <View style={{ gap: 8 }}>{family.children.map(child => <Pressable key={child.id} accessibilityRole="button" accessibilityLabel={`Select ${childName(child)}`}
      accessibilityState={{ selected: child.id === family.selected?.id }} onPress={() => family.select(child.id)}
      style={({ pressed }) => ({ borderWidth: 1, borderColor: child.id === family.selected?.id ? p.primary : p.border, borderRadius: 12, minHeight: 56, padding: 12, backgroundColor: child.id === family.selected?.id ? p.soft : p.surface, opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ fontWeight: '600' }}>{childName(child)}</Text><Text style={{ color: p.muted, fontSize: 12 }}>{child.admission_no}</Text>
    </Pressable>)}</View></Card>;
}
