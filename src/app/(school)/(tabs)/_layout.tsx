import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { House, CalendarCheck, Bell, UserRound, BookOpen } from 'lucide-react-native';
import { usePalette } from '../../../ui/theme';

export default function SchoolTabs() {
  const p = usePalette(), insets = useSafeAreaInsets();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: p.primary, tabBarInactiveTintColor: p.muted,
    tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.border, height: 64 + Math.max(12, insets.bottom), paddingBottom: Math.max(12, insets.bottom), paddingTop: 8 }, tabBarLabelStyle: { fontFamily: 'Sora', fontSize: 11 } }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
    <Tabs.Screen name="attendance" options={{ title: 'Attendance', tabBarItemStyle: { flex: 1.28 }, tabBarIcon: ({ color, size }) => <CalendarCheck color={color} size={size} /> }} />
    <Tabs.Screen name="learning" options={{ title: 'Learning', tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size} /> }} />
    <Tabs.Screen name="notifications" options={{ title: 'Updates', tabBarIcon: ({ color, size }) => <Bell color={color} size={size} /> }} />
    <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
  </Tabs>;
}
