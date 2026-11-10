import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
export const light = { bg: '#f5f7fb', surface: '#ffffff', soft: '#edf2ff', text: '#152033', muted: '#57667c', border: '#d6deeb', primary: '#3158df', onPrimary: '#ffffff', danger: '#b4233a', success: '#167443', warning: '#865500' };
export const dark: typeof light = { bg: '#0b1020', surface: '#121a2d', soft: '#172137', text: '#f5f7ff', muted: '#a3b0c5', border: '#34425c', primary: '#9aaeff', onPrimary: '#101a35', danger: '#ff9baa', success: '#7fe1a8', warning: '#f5cb7a' };
const themeKey = 'sms.appearance.dark';
const ThemeContext = createContext({ darkMode: false, setDarkMode: (_value: boolean) => {} });

async function readTheme() {
  return Platform.OS === 'web' ? globalThis.localStorage?.getItem(themeKey) : SecureStore.getItemAsync(themeKey);
}
async function writeTheme(value: boolean) {
  const stored = value ? '1' : '0';
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(themeKey, stored);
  else await SecureStore.setItemAsync(themeKey, stored);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [darkMode, setMode] = useState(false);
  const changed = useRef(false);
  const save = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    void readTheme().then(value => {
      if (active && !changed.current) setMode(value === '1');
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  function setDarkMode(value: boolean) {
    changed.current = true;
    setMode(value);
    save.current = save.current.then(() => writeTheme(value)).catch(() => {});
  }

  return <ThemeContext.Provider value={{ darkMode, setDarkMode }}>{children}</ThemeContext.Provider>;
}

export function useDarkMode() { return useContext(ThemeContext); }
export function usePalette() { return useDarkMode().darkMode ? dark : light; }
