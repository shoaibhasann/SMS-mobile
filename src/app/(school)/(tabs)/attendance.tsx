import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { CalendarDays, Check, ChevronDown, SlidersHorizontal } from 'lucide-react-native';
import { useAuth } from '../../../auth/provider';
import { attendanceLabels, attendanceMonths, attendanceStatuses, loadAttendance, loadAttendanceYears, type AttendanceStatus, type FamilyChild } from '../../../data';
import { ChildPicker, useFamily } from '../../../ui/family';
import { useLoad } from '../../../ui/use-load';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../../ui/primitives';
import { usePalette } from '../../../ui/theme';

const pageSize = 30;
const schoolDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const schoolMonth = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const formatMonth = (value: string) => schoolMonth.format(new Date(`${value}T12:00:00Z`));
type FilterOption = { value: string; label: string };
type Filter = 'year' | 'month' | 'status';
type Selection = { yearId?: string; month?: string; status?: AttendanceStatus };

function FilterField({ label, value, options, expanded, toggle, select }: {
  label: string; value: string; options: FilterOption[]; expanded: boolean; toggle(): void; select(value: string): void;
}) {
  const p = usePalette();
  const current = options.find(option => option.value === value);
  return <View style={{ gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? 'Unavailable'}`} accessibilityState={{ expanded }}
      onPress={toggle} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: expanded || pressed ? p.soft : p.surface })}>
      <Text style={{ color: p.muted, flexShrink: 1 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        <Text style={{ fontWeight: '600', flexShrink: 1 }}>{current?.label ?? 'Unavailable'}</Text><ChevronDown size={16} color={p.muted} />
      </View>
    </Pressable>
    {expanded && <View style={{ gap: 4, paddingStart: 8, borderStartWidth: 1, borderStartColor: p.border }}>
      {options.map(option => <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: option.value === value }}
        onPress={() => select(option.value)} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8,
          flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: option.value === value || pressed ? p.soft : p.surface })}>
        <Text style={{ flex: 1 }}>{option.label}</Text>{option.value === value && <Check size={16} color={p.primary} />}
      </Pressable>)}
    </View>}
  </View>;
}

export default function Attendance() {
  const family = useFamily();
  return <Screen><Title title="Attendance" subtitle="View your school’s saved daily records." />
    {family.loading ? <Skeleton rows={2} /> : family.error ? <ErrorCard message={family.error} retry={family.refresh} />
      : family.selected ? <><ChildPicker /><AttendanceHistory key={family.selected.id} child={family.selected} /></>
        : <Card><Text>No student profile is currently linked.</Text></Card>}
  </Screen>;
}

function AttendanceHistory({ child }: { child: FamilyChild }) {
  const { access, role, client } = useAuth(), p = usePalette();
  const [filters, setFilters] = useState<Selection>({});
  const [offset, setOffset] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState<Filter | null>(null);
  const scope = `${access!.userId}:${role}:${child.id}`;
  const readYears = useCallback((signal: AbortSignal) => loadAttendanceYears(client!, access!, role, child, signal), [access, client, role, child]);
  const yearContext = useLoad(scope, readYears);
  const readRows = useCallback((signal: AbortSignal) => loadAttendance(client!, access!, role, child, { ...filters, offset, limit: pageSize }, signal),
    [access, client, role, child, filters, offset]);
  const result = useLoad(JSON.stringify([scope, offset, filters]), readRows);
  const years = yearContext.data?.years ?? [];
  const year = years.find(option => option.id === filters.yearId);
  const months = year && yearContext.data ? attendanceMonths(year, yearContext.data.today) : [];
  const filtered = !!(filters.yearId || filters.month || filters.status);
  const range = result.data?.rows.length ? `${offset + 1}–${offset + result.data.rows.length} of ${result.data.count}` : '';
  const scopeLabel = [year?.name ?? (filters.yearId ? 'Selected academic year' : 'All academic years'), filters.month && formatMonth(filters.month), filters.status && attendanceLabels[filters.status]].filter(Boolean).join(' · ');
  const statuses = [{ value: '', label: 'All statuses' }, ...attendanceStatuses.map(status => ({ value: status, label: attendanceLabels[status] }))];

  function select(next: Selection) {
    setOffset(0);
    setExpanded(null);
    setFilters(next);
  }
  function toggle(field: Filter) { setExpanded(expanded === field ? null : field); }
  function refresh() { result.reload(); yearContext.reload(); }

  return <>
    <Card style={{ gap: 8, padding: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Attendance filters" accessibilityState={{ expanded: showFilters }}
        onPress={() => { setShowFilters(value => !value); setExpanded(null); }} style={({ pressed }) => ({ minHeight: 48, borderRadius: 10, paddingHorizontal: 8,
          flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? p.soft : p.surface })}>
        <SlidersHorizontal size={19} color={p.primary} /><View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>Filters</Text>
          <Text style={{ color: p.muted, fontSize: 12 }}>{scopeLabel}</Text></View><ChevronDown size={17} color={p.muted} />
      </Pressable>
      {showFilters && <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: p.border, paddingTop: 8 }}>
        {yearContext.loading ? <Text style={{ color: p.muted }} accessibilityLiveRegion="polite">Loading academic years…</Text>
          : yearContext.error ? <ErrorCard message="Academic years could not be loaded. You can still view saved records." retry={yearContext.reload} />
            : <><FilterField label="Academic year" value={filters.yearId ?? ''} options={[{ value: '', label: 'All academic years' }, ...years.map(option => ({ value: option.id, label: option.name }))]}
              expanded={expanded === 'year'} toggle={() => toggle('year')} select={yearId => select({ yearId: yearId || undefined, status: filters.status })} />
            {year ? <FilterField label="Month" value={filters.month ?? ''} options={[{ value: '', label: 'All months' }, ...months.map(value => ({ value, label: formatMonth(value) }))]}
              expanded={expanded === 'month'} toggle={() => toggle('month')} select={month => select({ ...filters, month: month || undefined })} />
              : <Text style={{ color: p.muted, fontSize: 12, paddingHorizontal: 10 }}>Choose an academic year to filter by month.</Text>}</>}
        <FilterField label="Status" value={filters.status ?? ''} options={statuses} expanded={expanded === 'status'} toggle={() => toggle('status')}
          select={status => select({ ...filters, status: (status || undefined) as AttendanceStatus | undefined })} />
        {filtered && <Button label="Reset filters" secondary onPress={() => select({})} />}
      </View>}
    </Card>
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Text accessibilityRole="header" style={{ fontWeight: '700', fontSize: 16, flexShrink: 1 }}>Saved records</Text>
        {range !== '' && <Text accessibilityLiveRegion="polite" style={{ color: p.muted, fontSize: 12 }}>{range}</Text>}
      </View>
      {(offset > 0 || (result.data?.count ?? 0) > pageSize) && <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button label="Previous" secondary disabled={offset === 0 || result.loading} onPress={() => setOffset(Math.max(0, offset - pageSize))} /></View>
        <View style={{ flex: 1 }}><Button label="Next" secondary disabled={result.loading || offset + pageSize >= (result.data?.count ?? 0)} onPress={() => setOffset(offset + pageSize)} /></View>
      </View>}
      {result.loading ? <Skeleton rows={2} /> : result.error ? <ErrorCard message={result.error} retry={result.reload} />
        : result.data?.rows.length ? result.data.rows.map(row => {
          const tone = row.status === 'absent' ? p.danger : row.status === 'present' ? p.success : row.status === 'late' || row.status === 'half_day' ? p.warning : p.muted;
          return <View key={`${row.academic_year_id}:${row.attendance_date}`} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center',
            gap: 8, borderTopWidth: 1, borderTopColor: p.border, paddingTop: 10 }}>
            <Text style={{ flexShrink: 1 }}>{schoolDate.format(new Date(`${row.attendance_date}T12:00:00Z`))}</Text>
            <Text style={{ color: tone, fontWeight: '600', backgroundColor: p.bg, borderRadius: 8, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3 }}>{attendanceLabels[row.status]}</Text>
          </View>;
        }) : <View style={{ alignItems: 'flex-start', gap: 8, borderTopWidth: 1, borderTopColor: p.border, paddingTop: 14 }}>
          <CalendarDays size={22} color={p.primary} /><Text style={{ fontWeight: '600' }}>{offset > 0 ? 'No records on this page' : filtered ? 'No matching records' : 'No attendance recorded yet'}</Text>
          <Text style={{ color: p.muted }}>{offset > 0 ? 'Go back to the previous page.' : filtered ? 'Try another month or status.' : 'Records appear here after the school marks attendance.'}</Text>
        </View>}
    </Card>
    <Button label="Refresh attendance" secondary disabled={result.loading} onPress={refresh} />
    <Text style={{ color: p.muted, fontSize: 12 }}>Unmarked days do not appear in this history.</Text>
  </>;
}
