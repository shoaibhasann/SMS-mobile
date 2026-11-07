// @vitest-environment jsdom
import { act, type ReactNode, type EffectCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GateAlertPreferences } from '../src/ui/gate-alert-preferences';
import { GateAlertError, type GateAlertPreference } from '../src/data/gate-alerts';

const { load, save, switches } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), switches: new Map<string, (value: boolean) => void>() }));
vi.mock('../src/data/gate-alerts', async original => ({ ...await original<typeof import('../src/data/gate-alerts')>(), loadGateAlertPreferences: load, saveGateAlertPreferences: save }));
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return { useFocusEffect: (effect: EffectCallback) => useEffect(effect, [effect]) };
});
vi.mock('react-native', () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Switch: ({ accessibilityLabel, value, disabled, onValueChange }: { accessibilityLabel: string; value: boolean; disabled?: boolean; onValueChange(value: boolean): void }) => {
    switches.set(accessibilityLabel, onValueChange);
    return <input type="checkbox" aria-label={accessibilityLabel} checked={value} disabled={disabled} onChange={event => onValueChange(event.currentTarget.checked)} />;
  },
}));
vi.mock('../src/ui/theme', () => ({ usePalette: () => ({ muted: '#64748b', danger: '#b91c1c', border: '#cbd5e1', primary: '#2563eb' }) }));
vi.mock('../src/ui/primitives', () => ({
  Card: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children, accessibilityRole }: { children?: ReactNode; accessibilityRole?: string }) => <span role={accessibilityRole === 'header' ? 'heading' : accessibilityRole}>{children}</span>,
  Button: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress(): void }) => <button disabled={disabled} onClick={onPress}>{label}</button>,
  Skeleton: () => <span role="progressbar">Loading settings</span>,
  ErrorCard: ({ message, retry }: { message: string; retry?(): void }) => <div role="alert">{message}{retry && <button onClick={retry}>Retry</button>}</div>,
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uid = id(1), client = {} as SupabaseClient;
const first: GateAlertPreference = { student_id: id(2), preference_id: id(3), student_name: 'First pupil', arrival_enabled: false, exit_enabled: false, version: 0 };
const second = { ...first, student_id: id(4), preference_id: id(5), student_name: 'Second pupil' };
let root: Root | null, container: HTMLDivElement;
const changed = vi.fn();
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(complete => { resolve = complete; }), resolve }; }
const checkbox = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const refresh = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Refresh gate alert settings')!;
async function render() { await act(async () => { root!.render(<GateAlertPreferences client={client} userId={uid} onChanged={changed} />); }); }
async function toggle(label: string, value: boolean) { await act(async () => { switches.get(label)!(value); }); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetAllMocks(); switches.clear(); changed.mockReset(); load.mockResolvedValue([first, second]);
  save.mockResolvedValue({ ...first, arrival_enabled: true, version: 1 });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

describe('native gate preference UI behavior', () => {
  it('starts linked-child switches OFF and explains independent absence alerts without enabling delivery', async () => {
    await render();
    const controls = Array.from(container.querySelectorAll<HTMLInputElement>('input'));
    expect(controls).toHaveLength(4); expect(controls.every(input => !input.checked && !input.disabled)).toBe(true);
    expect(container.textContent).toContain('Absent attendance alerts remain available even when both options are off.');
    expect(container.textContent).toContain('They do not enable phone push or SMS.');
    expect(load.mock.calls[0][1]).toBe(uid); expect(save).not.toHaveBeenCalled();
  });
  it('blocks Refresh and queued same-event/cross-child saves until the pending save completes', async () => {
    const pending = deferred<GateAlertPreference>(); save.mockReturnValueOnce(pending.promise); await render();
    await act(async () => {
      switches.get('Arrival alerts for First pupil')!(true);
      switches.get('Exit alerts for First pupil')!(true);
      switches.get('Arrival alerts for Second pupil')!(true);
      refresh().click();
    });
    expect(save).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1); expect(refresh().disabled).toBe(true);
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input')).every(input => input.disabled)).toBe(true);
    expect(save.mock.calls[0][2]).toEqual({ ...first, arrival_enabled: true });
    await act(async () => { pending.resolve({ ...first, arrival_enabled: true, version: 1 }); });
    expect(changed).toHaveBeenCalledTimes(1); expect(checkbox('Arrival alerts for First pupil').checked).toBe(true); expect(refresh().disabled).toBe(false);
  });
  it('reloads authorized settings and removes a revoked child after an access-denied save', async () => {
    load.mockResolvedValueOnce([first, second]).mockResolvedValueOnce([second]);
    save.mockRejectedValueOnce(new GateAlertError('Current child access is required.', 'access'));
    await render(); await toggle('Arrival alerts for First pupil', true);
    expect(load).toHaveBeenCalledTimes(2); expect(container.textContent).not.toContain('First pupil');
    expect(checkbox('Arrival alerts for First pupil')).toBeNull(); expect(checkbox('Arrival alerts for Second pupil').disabled).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it.each(['unconfirmed', 'conflict'] as const)('keeps an %s save blocked until Refresh reads the saved state', async code => {
    load.mockResolvedValueOnce([first]).mockResolvedValueOnce([{ ...first, arrival_enabled: true, version: 1 }]);
    save.mockRejectedValueOnce(new GateAlertError('Refresh the saved choices.', code));
    await render(); await toggle('Arrival alerts for First pupil', true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Refresh the saved choices.');
    expect(checkbox('Arrival alerts for First pupil').disabled).toBe(true); expect(refresh().disabled).toBe(false);
    await toggle('Exit alerts for First pupil', true); expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { refresh().click(); });
    expect(load).toHaveBeenCalledTimes(2); expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(checkbox('Arrival alerts for First pupil').checked).toBe(true); expect(checkbox('Exit alerts for First pupil').disabled).toBe(false);
  });
  it('aborts the pending child request on unmount and suppresses its late callback', async () => {
    const pending = deferred<GateAlertPreference>(); save.mockReturnValueOnce(pending.promise); await render();
    await toggle('Arrival alerts for First pupil', true); const signal = save.mock.calls[0][3] as AbortSignal;
    await act(async () => { root!.unmount(); root = null; }); expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve({ ...first, arrival_enabled: true, version: 1 }); });
    expect(changed).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledTimes(1);
  });
});
