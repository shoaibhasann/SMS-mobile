// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChildPicker, FamilyProvider, useFamily } from '../src/ui/family';

const { load, auth } = vi.hoisted(() => ({ load: vi.fn(), auth: { role: 'parent', access: { userId: 'account' }, client: {} } }));
vi.mock('../src/data', () => ({ listChildren: load }));
vi.mock('../src/auth/provider', () => ({ useAuth: () => auth }));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({ primary: '#2563eb', muted: '#475569', surface: '#fff', border: '#cbd5e1', soft: '#eff6ff' }) }));
vi.mock('../src/ui/primitives', () => ({ Text: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock('lucide-react-native', () => ({ Check: () => null, ChevronDown: () => null, UserRound: () => null }));
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, accessibilityLabel, accessibilityState, disabled, onPress }: {
    children: ReactNode; accessibilityLabel: string; accessibilityState: { expanded?: boolean; selected?: boolean }; disabled?: boolean; onPress(): void;
  }) => <button aria-label={accessibilityLabel} aria-expanded={accessibilityState.expanded} aria-selected={accessibilityState.selected} disabled={disabled} onClick={onPress}>{children}</button>,
}));

const first = { id: 'a', first_name: 'Asha', last_name: 'Sharma', admission_no: 'QA-01' };
const second = { id: 'b', first_name: 'Dev', last_name: 'Sharma', admission_no: 'QA-02' };
function CurrentStudent() {
  const family = useFamily();
  return <><output>{family.selected?.id}</output><button onClick={family.refresh}>Refresh school access</button></>;
}
const roots: ReturnType<typeof createRoot>[] = [];
async function render(role: string, students: (typeof first)[], disabled = false) {
  auth.role = role;
  load.mockReset().mockResolvedValue(students);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'), root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<FamilyProvider><ChildPicker disabled={disabled} /><CurrentStudent /></FamilyProvider>));
  return container;
}
const trigger = (container: HTMLDivElement) => container.querySelector<HTMLButtonElement>('button[aria-expanded]');
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()); });
  vi.unstubAllGlobals();
});

describe('native child picker', () => {
  it.each(['parent', 'student'])('renders no switcher for one verified %s profile', async role => {
    const container = await render(role, [first]);
    expect(trigger(container)).toBeNull();
    expect(container.querySelector('output')?.textContent).toBe(first.id);
  });

  it('keeps options collapsed, switches the shared pupil and hides after a link is removed', async () => {
    const container = await render('parent', [first, second]);
    expect(trigger(container)?.getAttribute('aria-label')).toContain('Asha Sharma');
    expect(container.textContent).not.toContain('Dev Sharma');
    await act(async () => trigger(container)?.click());
    expect(trigger(container)?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('button[aria-selected="true"]')?.textContent).toContain('QA-01');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Select Dev Sharma, admission QA-02"]')?.click());
    expect(container.querySelector('output')?.textContent).toBe(second.id);
    expect(trigger(container)?.getAttribute('aria-expanded')).toBe('false');
    load.mockResolvedValueOnce([first]);
    await act(async () => container.querySelector<HTMLButtonElement>('button:not([aria-expanded])')?.click());
    expect(container.querySelector('output')?.textContent).toBe(first.id);
    expect(trigger(container)).toBeNull();
    expect(container.textContent).not.toContain('Dev Sharma');
  });

  it('keeps switching disabled during a protected leave request', async () => {
    const container = await render('parent', [first, second], true);
    expect(trigger(container)?.disabled).toBe(true);
    await act(async () => trigger(container)?.click());
    expect(container.querySelector('button[aria-selected]')).toBeNull();
  });
});
