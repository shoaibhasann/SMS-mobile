import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Check, ChevronDown, UserRound } from 'lucide-react-native';
import { listChildren, type FamilyChild } from '../data';
import { useAuth } from '../auth/provider';
import { Text } from './primitives';
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
export function ChildPicker({ child, onSelect, disabled = false }: { child?: FamilyChild; onSelect?(child: FamilyChild): void; disabled?: boolean } = {}) {
  const family = useFamily(), { role } = useAuth(), p = usePalette();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const selected = child ?? family.selected;
  if (role !== 'parent' || family.loading || family.error || family.children.length < 2 || !selected) return null;

  const expanded = !disabled && openFor === selected.id;
  return <View style={{ gap: 6 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Switch student. Selected: ${childName(selected)}`}
      accessibilityState={{ expanded, disabled }} disabled={disabled} onPress={() => setOpenFor(expanded ? null : selected.id)}
      style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12,
        borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, opacity: disabled || pressed ? 0.65 : 1 })}>
      <UserRound size={16} color={p.primary} />
      <Text numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>{childName(selected)}</Text>
      <ChevronDown size={17} color={p.muted} style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined} />
    </Pressable>
    {expanded && <View style={{ gap: 4, padding: 4, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, borderRadius: 12 }}>
      {family.children.map(option => {
        const active = option.id === selected.id;
        return <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={`Select ${childName(option)}, admission ${option.admission_no}`}
          accessibilityState={{ selected: active }} onPress={() => {
            setOpenFor(null);
            if (active) return;
            if (onSelect) onSelect(option);
            else family.select(option.id);
          }} style={({ pressed }) => ({ minHeight: 48, paddingVertical: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8,
            backgroundColor: active || pressed ? p.soft : p.surface })}>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '600' }}>{childName(option)}</Text><Text style={{ color: p.muted, fontSize: 12 }}>{option.admission_no}</Text></View>
          {active && <Check size={16} color={p.primary} />}
        </Pressable>;
      })}
    </View>}
  </View>;
}
