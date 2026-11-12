import { reloadAppAsync } from 'expo';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../auth/provider';
import { Screen, Skeleton, ErrorCard, Button } from '../ui/primitives';
import { ThemeProvider, useDarkMode, usePalette } from '../ui/theme';

// Any render error lands on a recoverable screen instead of a fatal crash; fixed copy so internal error text is not shown.
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  // The boundary replaces RootLayout, so it needs its own ThemeProvider to honour the saved appearance.
  return <ThemeProvider><ErrorScreen retry={retry} /></ThemeProvider>;
}
function ErrorScreen({ retry }: Pick<ErrorBoundaryProps, 'retry'>) {
  const { darkMode } = useDarkMode();
  // The crashed navigator is gone, so Home is a full app reload (works in release builds) rather than router navigation.
  return <Screen><StatusBar style={darkMode ? 'light' : 'dark'} />
    <ErrorCard message="Something went wrong on this screen. Retry, or go to Home." retry={() => void retry()} />
    <Button label="Go to Home" secondary onPress={() => void reloadAppAsync('Leave a screen that failed to render').catch(() => {})} /></Screen>;
}

export default function RootLayout() {
  return <ThemeProvider><RootNavigator /></ThemeProvider>;
}

function RootNavigator() {
  const [loaded, error] = useFonts({ Sora: require('../../assets/fonts/Sora-Variable.ttf') });
  const p = usePalette(), { darkMode } = useDarkMode();
  if (!loaded) return <SafeAreaProvider><Screen>{error ? <ErrorCard message="The app font could not be loaded. Restart the app." /> : <Skeleton />}</Screen></SafeAreaProvider>;
  return <SafeAreaProvider><AuthProvider><StatusBar style={darkMode ? 'light' : 'dark'} /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} /></AuthProvider></SafeAreaProvider>;
}
