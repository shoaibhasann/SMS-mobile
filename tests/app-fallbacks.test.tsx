// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const replace = vi.fn(), reload = vi.fn(async (_reason?: string) => {});
const bar = vi.hoisted(() => ({ styles: [] as string[], dark: false }));
vi.mock('expo-router', () => ({ Stack: () => null, router: { replace: (href: string) => replace(href) } }));
vi.mock('expo', () => ({ reloadAppAsync: (reason?: string) => reload(reason) }));
vi.mock('expo-status-bar', () => ({ StatusBar: ({ style }: { style: string }) => { bar.styles.push(style); return null; } }));
vi.mock('expo-font', () => ({ useFonts: () => [true, null] }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../src/auth/provider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../src/ui/theme', () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>, useDarkMode: () => ({ darkMode: bar.dark }), usePalette: () => ({}) }));
vi.mock('../src/ui/primitives', () => ({
  Screen: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Skeleton: () => null,
  Title: ({ title }: { title: string }) => <h1>{title}</h1>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Button: ({ label, onPress }: { label: string; onPress(): void }) => <button onClick={onPress}>{label}</button>,
  ErrorCard: ({ message, retry }: { message: string; retry?: () => void }) => <section><p>{message}</p>{retry && <button onClick={retry}>Retry</button>}</section>,
}));

async function render(node: ReactNode) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'), root = createRoot(container);
  await act(async () => root.render(node));
  return { container, unmount: async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); } };
}

it('shows a friendly not-found screen for unknown sms-school:// links with a way back Home', async () => {
  const { default: NotFound } = await import('../src/app/+not-found');
  const view = await render(<NotFound />);
  try {
    expect(view.container.textContent).toContain("This link isn't available in the app");
    expect(view.container.textContent).not.toMatch(/Unmatched Route|Sitemap/);
    const home = [...view.container.querySelectorAll('button')].find(b => b.textContent === 'Go to Home');
    await act(async () => home?.click());
    expect(replace).toHaveBeenCalledWith('/');
  } finally { await view.unmount(); }
});

it('catches render errors at the root with fixed copy and a working Retry', async () => {
  const { ErrorBoundary } = await import('../src/app/_layout');
  const retry = vi.fn(async () => {});
  const view = await render(<ErrorBoundary error={new Error('TypeError: Cannot read property origin of undefined')} retry={retry} />);
  try {
    expect(view.container.textContent).toContain('Something went wrong on this screen');
    expect(view.container.textContent).not.toContain('origin of undefined');
    await act(async () => view.container.querySelector('button')?.click());
    expect(retry).toHaveBeenCalledOnce();
  } finally { await view.unmount(); }
});

it('offers a Go to Home exit from a repeating render error that reloads the app instead of using the crashed navigator', async () => {
  const { ErrorBoundary } = await import('../src/app/_layout');
  const retry = vi.fn(async () => {});
  const view = await render(<ErrorBoundary error={new Error('boom')} retry={retry} />);
  try {
    const home = [...view.container.querySelectorAll('button')].find(b => b.textContent === 'Go to Home');
    expect(home).toBeDefined();
    await act(async () => home?.click());
    expect(reload).toHaveBeenCalledOnce(); expect(retry).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  } finally { await view.unmount(); }
});

it('sets a readable status bar style on the root error screen for light and dark appearance', async () => {
  const { ErrorBoundary } = await import('../src/app/_layout');
  for (const [dark, style] of [[false, 'dark'], [true, 'light']] as const) {
    bar.dark = dark; bar.styles = [];
    const view = await render(<ErrorBoundary error={new Error('boom')} retry={async () => {}} />);
    try { expect(bar.styles.at(-1)).toBe(style); } finally { await view.unmount(); }
  }
  bar.dark = false;
});
