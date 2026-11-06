import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../auth/provider';
import { getFamilyAssessmentResults, getFamilyNotificationResult, publicationPageSize, type FamilyAssessmentResult, type FamilyResultPage } from '../../data/results';
import type { FamilyChild } from '../../data/family';
import { ChildPicker, childName, useFamily } from '../../ui/family';
import { useLoad } from '../../ui/use-load';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export default function Results() {
  const params = useLocalSearchParams<{ child?: string | string[]; assessment?: string | string[] }>();
  const { access, role, revision } = useAuth();
  const invalid = params.child !== undefined && !uuid(params.child) || params.assessment !== undefined && (!uuid(params.assessment) || !uuid(params.child));
  return <ResultsAccess key={JSON.stringify([access?.userId, access?.schoolId, role, revision, params.child, params.assessment])}
    childId={typeof params.child === 'string' ? params.child : undefined} assessmentId={typeof params.assessment === 'string' ? params.assessment : undefined} invalid={invalid} />;
}
function ResultsAccess({ childId, assessmentId, invalid }: { childId?: string; assessmentId?: string; invalid: boolean }) {
  const family = useFamily();
  const child = childId === undefined ? family.selected : family.children.find(item => item.id === childId) ?? null;
  const missing = childId !== undefined && !family.loading && !family.error && !child;
  function allResults() {
    if (child && family.children.some(item => item.id === child.id)) family.select(child.id);
    router.replace('/(school)/results');
  }
  return <Screen><Title title="Published results" subtitle="School-reviewed assessment results for your permitted student profile." />
    <Button label="Back to Learning" secondary onPress={() => router.replace('/(school)/learning')} />
    {childId === undefined ? <ChildPicker /> : child && <Card><Text style={{ fontWeight: '600' }}>{childName(child)}</Text><Text>{child.admission_no}</Text></Card>}
    {invalid ? <ErrorCard message="This result link is invalid. Open published result history to continue." />
      : family.loading ? <Skeleton />
        : family.error ? <ErrorCard message={family.error} retry={family.refresh} />
          : missing ? <ErrorCard message="The student in this result link is no longer available to your account. Refresh school access." retry={family.refresh} />
            : !child ? <Card><Text>No student profile is currently linked to this account.</Text></Card>
              : <ResultHistory key={`${child.id}:${assessmentId ?? ''}`} pupil={child} assessmentId={assessmentId} />}
    {(childId !== undefined || assessmentId !== undefined || invalid) && <Button label="All published results" secondary onPress={allResults} />}
  </Screen>;
}
function ResultHistory({ pupil, assessmentId }: { pupil: FamilyChild; assessmentId?: string }) {
  const { access, role, client } = useAuth(), p = usePalette();
  const [offset, setOffset] = useState(0);
  const read = useCallback(async (signal: AbortSignal): Promise<FamilyResultPage> => {
    if (!access || !client) throw new Error('A verified family session is required.');
    if (assessmentId !== undefined) {
      const result = await getFamilyNotificationResult(client, access, role, pupil, assessmentId, signal);
      return { rows: result ? [result] : [], total_count: result ? 1 : 0, offset: 0, student_id: pupil.id, school_id: access.schoolId };
    }
    return getFamilyAssessmentResults(client, access, role, pupil, offset, signal);
  }, [access, role, client, pupil, assessmentId, offset]);
  const history = useLoad(`${access?.userId}:${access?.schoolId}:${role}:${pupil.id}:${assessmentId ?? ''}:${offset}`, read);
  return <>
    <View style={{ gap: 5 }}><Text accessibilityRole="header" style={{ fontWeight: '700', fontSize: 18 }}>{assessmentId === undefined ? 'Published result history' : 'Result from notification'}</Text>
      <Text style={{ color: p.muted, fontSize: 12 }}>Only the latest published revision for each assessment is shown.</Text></View>
    {history.loading ? <Skeleton /> : history.error ? <ErrorCard message={history.error} retry={history.reload} />
      : !history.data?.rows.length ? <Card><Text>{assessmentId === undefined ? 'No school-published results on this page. Results appear after school review.' : 'This published result is no longer available. Open all published results to see the current history.'}</Text></Card>
        : history.data.rows.map(result => <ResultCard key={result.id} result={result} />)}
    {assessmentId === undefined && history.data && !history.loading && <>
      <Text style={{ color: p.muted, fontSize: 12 }}>{history.data.rows.length ? `${offset + 1}–${offset + history.data.rows.length} of ${history.data.total_count} results` : `${history.data.total_count} results`}</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Button label="Previous results" secondary disabled={offset === 0} onPress={() => setOffset(value => Math.max(0, value - publicationPageSize))} /></View>
        <View style={{ flex: 1 }}><Button label="Next results" secondary disabled={offset + publicationPageSize >= history.data.total_count} onPress={() => setOffset(value => value + publicationPageSize)} /></View></View>
    </>}
    <Button label="Refresh published results" secondary disabled={history.loading} onPress={history.reload} />
    <Text style={{ color: p.muted, fontSize: 12 }}>These are single-assessment results. Term grades, pass/fail and class rank are not included.</Text>
  </>;
}
function ResultCard({ result }: { result: FamilyAssessmentResult }) {
  const p = usePalette(), source = result.metadata;
  const assessed = new Date(`${source.assessment_date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const published = new Date(result.published_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  return <Card><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
    <Text style={{ color: p.success, fontSize: 12, fontWeight: '700' }}>PUBLISHED</Text><Text style={{ color: p.muted, fontSize: 12 }}>Revision {result.revision}</Text></View>
    <Text accessibilityRole="header" style={{ fontSize: 19, lineHeight: 28, fontWeight: '700' }}>{source.name}</Text>
    <Text>{source.subject_name} · {source.class_name}{source.section_name ? ` / ${source.section_name}` : ' / Whole class'}</Text>
    <Text style={{ color: p.muted, fontSize: 12 }}>{source.academic_year_name} · {assessed}</Text>
    <View style={{ padding: 16, borderRadius: 14, backgroundColor: p.soft, gap: 8 }}><Text style={{ fontWeight: '600' }}>{result.student_name}</Text>
      <Text style={{ color: p.muted, fontSize: 12 }}>{result.admission_no}{result.roll_no ? ` · Roll ${result.roll_no}` : ''}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18, paddingTop: 5 }}><View style={{ flex: 1, minWidth: 110 }}><Text style={{ color: p.muted, fontSize: 12 }}>Marks obtained</Text><Text style={{ fontSize: 27, lineHeight: 39, fontWeight: '700' }}>{result.marks_obtained} / {result.maximum_marks}</Text></View>
        <View style={{ flex: 1, minWidth: 100 }}><Text style={{ color: p.muted, fontSize: 12 }}>Percentage</Text><Text style={{ fontSize: 27, lineHeight: 39, fontWeight: '700' }}>{result.percentage.toFixed(2)}%</Text></View></View>
    </View>
    {result.remarks !== null && result.remarks !== '' && <View style={{ gap: 4 }}><Text style={{ fontWeight: '600' }}>Teacher remarks</Text><Text>{result.remarks}</Text></View>}
    <Text style={{ color: p.muted, fontSize: 12 }}>Published by {result.publisher_name} · {published} IST</Text>
    <Text style={{ color: p.muted, fontSize: 12 }}>Saved with the original school, class and session details.</Text>
  </Card>;
}
