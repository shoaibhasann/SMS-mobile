import { useEffect, useState, type ReactNode } from 'react';
import { Animated, AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text as NativeText, View, type TextProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { usePalette } from './theme';

export function Text({ style, ...props }: TextProps) {
  const p = usePalette(), flat = StyleSheet.flatten(style);
  // Leading scales with size so Devanagari matras do not clip on headings; an explicit lineHeight still wins.
  const lineHeight = flat?.fontSize && flat.lineHeight == null ? Math.round(flat.fontSize * 1.45) : 22;
  return <NativeText {...props} style={[{ fontFamily: 'Sora', color: p.text, fontSize: 14, lineHeight }, style]} />;
}
export function Button({ label, onPress, disabled, secondary = false, icon, selected }: { label: string; onPress(): void; disabled?: boolean; secondary?: boolean; icon?: ReactNode; selected?: boolean }) {
  const p = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected }} onPress={onPress} disabled={disabled}
    style={({ pressed }) => ({ minHeight: 50, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: secondary ? p.surface : p.primary, borderWidth: 1, borderColor: secondary ? p.border : p.primary, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 })}>
    {icon}<Text style={{ color: secondary ? p.text : p.onPrimary, fontWeight: '600' }}>{label}</Text>
  </Pressable>;
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const p = usePalette(); return <View style={[{ padding: 18, gap: 12, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, borderRadius: 20 }, style]}>{children}</View>;
}
export function BackArrow({ onPress, disabled = false }: { onPress(): void; disabled?: boolean }) {
  const p = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel="Back" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44, width: 44, paddingStart: 2, marginBottom: -8, opacity: disabled || pressed ? 0.55 : 1 })}>
    <ArrowLeft size={22} color={p.primary} />
  </Pressable>;
}
// Tab screens pass bottomInset={false}: the tab bar already pads for the navigation bar.
export function Screen({ children, scroll = true, bottomInset = true }: { children: ReactNode; scroll?: boolean; bottomInset?: boolean }) {
  const p = usePalette(); const content = <View style={styles.content}>{children}</View>;
  return <SafeAreaView edges={bottomInset ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']} style={{ flex: 1, backgroundColor: p.bg }}>{scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>{content}</ScrollView> : content}</SafeAreaView>;
}
export function Title({ title, subtitle, action, showWorkspace = false }: { title: string; subtitle?: string; action?: ReactNode; showWorkspace?: boolean }) {
  const p = usePalette(); return <View style={{ gap: 6, marginBottom: 4 }}>{showWorkspace && <Text style={{ color: p.primary, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>SMS · SCHOOL WORKSPACE</Text>}
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><Text accessibilityRole="header" style={{ fontSize: 27, lineHeight: 36, fontWeight: '700', flex: 1 }}>{title}</Text>{action}</View>
    {subtitle && <Text style={{ color: p.muted }}>{subtitle}</Text>}</View>;
}
export function ErrorCard({ message, retry, inline = false }: { message: string; retry?: () => void; inline?: boolean }) {
  const p = usePalette(); return <Card style={inline ? { padding: 0, borderWidth: 0, backgroundColor: 'transparent' } : undefined}><Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: p.danger }}>{message}</Text>{retry && <Button label="Retry" secondary onPress={retry} />}</Card>;
}
export function Skeleton({ rows = 3 }: { rows?: number }) {
  const p = usePalette(), [opacity] = useState(() => new Animated.Value(0.6));
  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined, cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (reduced || cancelled) return;
      animation = Animated.loop(Animated.sequence([Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(opacity, { toValue: 0.6, duration: 700, useNativeDriver: true })])); animation.start();
    }).catch(() => {}); return () => { cancelled = true; animation?.stop(); };
  }, [opacity]);
  return <View accessibilityLabel="Loading school records" accessibilityRole="progressbar" style={{ gap: 14 }}>{Array.from({ length: rows }, (_, i) => <Animated.View key={i} style={{ height: 94, borderRadius: 18, backgroundColor: p.soft, borderColor: p.border, borderWidth: 1, opacity }} />)}</View>;
}
export const styles = StyleSheet.create({ content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, gap: 18 }, muted: { fontSize: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 } });
