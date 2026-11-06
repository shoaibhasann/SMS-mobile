import { useColorScheme } from 'react-native';
export const light = { bg: '#f5f7fb', surface: '#ffffff', soft: '#edf2ff', text: '#152033', muted: '#57667c', border: '#d6deeb', primary: '#3158df', onPrimary: '#ffffff', danger: '#b4233a', success: '#167443', warning: '#865500' };
export const dark: typeof light = { bg: '#0b1020', surface: '#121a2d', soft: '#172137', text: '#f5f7ff', muted: '#a3b0c5', border: '#34425c', primary: '#9aaeff', onPrimary: '#101a35', danger: '#ff9baa', success: '#7fe1a8', warning: '#f5cb7a' };
export function usePalette() { return useColorScheme() === 'dark' ? dark : light; }
