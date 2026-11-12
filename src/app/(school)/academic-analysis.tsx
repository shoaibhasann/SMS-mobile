import { useCallback } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../auth/provider';
import { loadAllPublishedResults, summarizePublishedResults } from '../../data/academic-analysis';
import { listHomework } from '../../data/homework';
import { ChildPicker, useFamily } from '../../ui/family';
import { BackArrow, Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import { useLoad } from '../../ui/use-load';

const assessmentDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' });

export default function AcademicAnalysis() {
  const { access, client, role } = useAuth(), family = useFamily(), p = usePalette();
  const pupil = family.selected;
  const read = useCallback(async (signal: AbortSignal) => {
    if (!access || !client || !pupil) return null;
    const [results, homework] = await Promise.all([
      loadAllPublishedResults(client, access, role, pupil, signal),
      listHomework(client, access, role, pupil, 0, signal),
    ]);
    return { results, homeworkCount: homework.total, homeworkPlaced: homework.placed, summary: summarizePublishedResults(results.rows) };
  }, [access, client, role, pupil]);
  const analysis = useLoad(`${access?.userId}:${access?.schoolId}:${role}:${pupil?.id}`, read);
  return <Screen>
    <BackArrow onPress={() => router.canGoBack() ? router.back() : router.replace('/(school)/(tabs)/learning')} />
    <Title title="Academic analysis" subtitle="Compare published scores by subject and see the current session’s assigned homework." />
    {pupil && <ChildPicker />}
    {family.loading ? <Skeleton /> : family.error ? <ErrorCard message={family.error} retry={family.refresh} />
      : !pupil ? <Card><Text>No student profile is currently linked.</Text></Card>
      : analysis.loading ? <Skeleton /> : analysis.error ? <ErrorCard message={analysis.error} retry={family.refresh} /> : analysis.data && <>
        <Card style={{ backgroundColor: p.soft }}>
          <Text accessibilityRole="header" style={{ fontWeight: '700', fontSize: 18 }}>Current session homework</Text>
          {analysis.data.homeworkPlaced ? <Text><Text style={{ color: p.primary, fontWeight: '700' }}>{analysis.data.homeworkCount}</Text> published {analysis.data.homeworkCount === 1 ? 'task' : 'tasks'} for this student’s current placement.</Text>
            : <Text>No current class placement this session. Contact your school if you expected homework here.</Text>}
          <Text style={{ color: p.muted }}>Open Learning for due dates and teacher feedback.</Text>
        </Card>
        {analysis.data.summary ? <>
          <Text accessibilityRole="header" style={{ fontWeight: '700', fontSize: 18 }}>Subject results · {analysis.data.summary.year}</Text>
          <Text style={{ color: p.muted }}>Based on {analysis.data.results.rows.length} of {analysis.data.results.total_count} published assessments. Each comparison uses two assessment dates in the same subject and academic year.</Text>
          {analysis.data.summary.subjects.map(({ latest, previous }) => {
            const score = latest.percentage, change = previous ? Number((score - previous.percentage).toFixed(1)) : null;
            return <Card key={latest.metadata.subject_id}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                <Text accessibilityRole="header" style={{ fontWeight: '700', fontSize: 17 }}>{latest.metadata.subject_name}</Text>
                <Text style={{ color: p.primary, fontWeight: '700' }}>{score}%</Text>
              </View>
              <View accessible={false} style={{ height: 6, borderRadius: 3, backgroundColor: p.soft }}>
                <View style={{ width: `${score}%`, height: 6, borderRadius: 3, backgroundColor: p.primary }} />
              </View>
              <Text style={{ color: p.muted }}>{latest.metadata.name} · {latest.marks_obtained}/{latest.maximum_marks} · {assessmentDate.format(new Date(`${latest.metadata.assessment_date}T12:00:00Z`))}</Text>
              {previous && change !== null && <Text style={{ color: p.muted }}>{change > 0 ? '+' : ''}{change} percentage points compared with {previous.metadata.name} ({previous.percentage}%).</Text>}
            </Card>;
          })}
        </> : <Card><Text>No published results yet. Subject comparisons appear after the school publishes assessments.</Text></Card>}
        <Button label="View published results" secondary onPress={() => router.push('/(school)/results')} />
        <Button label="Refresh analysis" secondary onPress={analysis.reload} />
      </>}
  </Screen>;
}
