import { router, useLocalSearchParams } from 'expo-router';
import { ExamSchedule } from '../../ui/exam-schedule';

export default function Exam() {
  const { assessment } = useLocalSearchParams<{ assessment?: string | string[] }>();
  return <ExamSchedule assessment={assessment ?? ''} back={() => { if (router.canGoBack()) router.back(); else router.replace('/(school)/(tabs)/notifications'); }} />;
}
