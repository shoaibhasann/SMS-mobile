import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../auth/provider';
import { Screen, Skeleton, ErrorCard } from '../ui/primitives';
import { ThemeProvider, useDarkMode, usePalette } from '../ui/theme';

export default function RootLayout() {
  return <ThemeProvider><RootNavigator /></ThemeProvider>;
}

function RootNavigator() {
  const [loaded, error] = useFonts({ Sora: require('../../assets/fonts/Sora-Variable.ttf') });
  const p = usePalette(), { darkMode } = useDarkMode();
  if (!loaded) return <SafeAreaProvider><Screen>{error ? <ErrorCard message="The app font could not be loaded. Restart the app." /> : <Skeleton />}</Screen></SafeAreaProvider>;
  return <SafeAreaProvider><AuthProvider><StatusBar style={darkMode ? 'light' : 'dark'} /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} /></AuthProvider></SafeAreaProvider>;
}
