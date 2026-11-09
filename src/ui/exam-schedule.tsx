import { useCallback } from 'react';
import { useAuth } from '../auth/provider';
import { getFamilyExamSchedule } from '../data';
import { Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from './primitives';
import { useLoad } from './use-load';

const dateFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' });

export function ExamSchedule({ assessment, back }: { assessment: string | string[]; back: () => void }) {
  const { access, client, role, revision } = useAuth();
  const load = useCallback((signal: AbortSignal) => getFamilyExamSchedule(client!, role, assessment, signal), [client, role, assessment]);
  const exam = useLoad(JSON.stringify([access?.userId, role, revision, assessment]), load);

  return <Screen>
    <Title title="Exam schedule" subtitle="Current date and instructions from your school." />
    <Button label="Back to updates" secondary onPress={back} />
    {exam.loading ? <Skeleton /> : exam.error ? <ErrorCard message={exam.error} retry={exam.reload} /> : exam.data
      ? <Card>
        <Text accessibilityRole="header" style={{ fontWeight: '700', fontSize: 20 }}>{exam.data.name}</Text>
        <Text>{dateFormat.format(new Date(`${exam.data.assessment_date}T00:00:00Z`))}</Text>
        <Text>{exam.data.subject_name} · {exam.data.class_name}{exam.data.section_name ? ` / ${exam.data.section_name}` : ' / Whole class'}</Text>
        {exam.data.description && <Text>{exam.data.description}</Text>}
      </Card>
      : <Card><Text>This exam is no longer available.</Text></Card>}
    {!exam.error && <Button label="Refresh exam schedule" secondary disabled={exam.loading} onPress={exam.reload} />}
  </Screen>;
}
