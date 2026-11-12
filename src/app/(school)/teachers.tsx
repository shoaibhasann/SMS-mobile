import { useCallback } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { BookOpen, GraduationCap, UserRound } from 'lucide-react-native';
import { useAuth } from '../../auth/provider';
import { loadClassTeachers } from '../../data';
import { ChildPicker, useFamily } from '../../ui/family';
import { BackArrow, Button, Card, ErrorCard, Screen, Skeleton, Text, Title } from '../../ui/primitives';
import { usePalette } from '../../ui/theme';
import { useLoad } from '../../ui/use-load';

export default function Teachers() {
  const { access, role, client } = useAuth(), family = useFamily(), p = usePalette();
  const child = family.selected;
  const read = useCallback((signal: AbortSignal) => child && access && client ? loadClassTeachers(client, access, role, child, signal) : Promise.resolve(null),
    [access, child, client, role]);
  const result = useLoad(`${access?.userId}:${role}:${child?.id}`, read);
  const data = result.data;
  const classTeacher = data?.teachers.find(teacher => teacher.isClassTeacher);
  const subjectTeachers = data?.teachers.filter(teacher => !teacher.isClassTeacher) ?? [];

  return <Screen>
    <BackArrow onPress={() => router.canGoBack() ? router.back() : router.replace('/(school)/(tabs)')} />
    <Title title="Class teachers" subtitle="Your school’s current teaching assignments." />
    <ChildPicker />
    {family.loading ? <Skeleton rows={2} /> : family.error ? <ErrorCard message={family.error} retry={family.refresh} />
      : !child ? <Card><Text>No student profile is currently linked.</Text></Card> : result.loading ? <Skeleton rows={2} />
        : result.error ? <ErrorCard message={result.error} retry={family.refresh} /> : !data?.className ? <Card>
          <Text style={{ fontWeight: '700' }}>Class placement unavailable</Text>
          <Text style={{ color: p.muted }}>Contact your school if you expect to see a class here.</Text>
        </Card> : <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <GraduationCap size={21} color={p.primary} />
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{[data.className, data.section].filter(Boolean).join(' · ')}</Text>
              <Text style={{ color: p.muted, fontSize: 12 }}>{data.year}</Text></View>
          </View>
          <Card style={{ backgroundColor: p.soft }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><UserRound size={19} color={p.primary} />
              <Text accessibilityRole="header" style={{ fontWeight: '700', color: p.primary }}>Class teacher</Text></View>
            {classTeacher ? <><Text style={{ fontWeight: '700', fontSize: 19, lineHeight: 27 }}>{classTeacher.name}</Text>
              <Text style={{ color: p.muted }}>{classTeacher.subjects.join(' · ')}</Text></>
              : <Text style={{ color: p.muted }}>Your school has not listed a class teacher for this class.</Text>}
          </Card>
          {subjectTeachers.length > 0 && <Card>
            <Text accessibilityRole="header" style={{ fontWeight: '700' }}>{classTeacher ? 'Other subject teachers' : 'Subject teachers'}</Text>
            {subjectTeachers.map(teacher => <View key={teacher.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12,
              borderTopColor: p.border, borderTopWidth: 1, paddingTop: 12 }}>
              <BookOpen size={18} color={p.primary} /><View style={{ flex: 1 }}><Text style={{ fontWeight: '600' }}>{teacher.name}</Text>
                <Text style={{ color: p.muted }}>{teacher.subjects.join(' · ')}</Text></View>
            </View>)}
          </Card>}
          <Button label="Refresh teachers" secondary onPress={result.reload} />
        </>}
  </Screen>;
}
