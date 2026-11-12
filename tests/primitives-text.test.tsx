import type { ReactElement } from 'react';
import { expect, it, vi } from 'vitest';

type Style = Record<string, unknown> | undefined | Style[];
const { flatten } = vi.hoisted(() => { const flatten = (style: Style): Record<string, unknown> => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : { ...style }; return { flatten }; });
vi.mock('react-native', () => ({
  Text: () => null, View: () => null, Pressable: () => null, ScrollView: () => null, Animated: {}, AccessibilityInfo: {},
  StyleSheet: { create: <T,>(value: T) => value, flatten },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: () => null }));
vi.mock('lucide-react-native', () => ({ ArrowLeft: () => null }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({ text: '#152033' }) }));
import { Text } from '../src/ui/primitives';

const lineHeight = (style?: Style) => flatten((Text({ style } as never) as ReactElement<{ style: Style }>).props.style).lineHeight;

it('scales line height with font size unless one is given', () => {
  expect(lineHeight({ fontSize: 12 })).toBe(17);
  expect(lineHeight([{ color: 'red' }, { fontSize: 20 }])).toBe(29);
  expect(lineHeight()).toBe(22);
  expect(lineHeight({ fontSize: 27, lineHeight: 36 })).toBe(36);
});
