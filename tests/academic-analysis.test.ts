import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type { FamilyAccess, FamilyChild } from '../src/data/family';
import type { FamilyAssessmentResult } from '../src/data/results';

const pages = vi.hoisted(() => new Map<number, { rows: unknown[]; total_count: number }>());
const fetchPage = vi.hoisted(() => vi.fn(async (_client: unknown, _access: unknown, _role: unknown, _pupil: unknown, offset: number, _signal?: AbortSignal) => pages.get(offset) ?? { rows: [], total_count: 0 }));
vi.mock('../src/data/results', () => ({ getFamilyAssessmentResults: fetchPage }));
import { loadAllPublishedResults, summarizePublishedResults } from '../src/data/academic-analysis';

const access = { userId: 'u', schoolId: 's', name: 'QA', roles: ['parent'] } as FamilyAccess, pupil = { id: 'p' } as FamilyChild, client = {} as SupabaseClient;
const result = (n: number, subject: string, date: string) => ({ id: `r${n}`, assessment_id: `a${n}`, percentage: 70, published_at: `${date}T10:00:00Z`,
  metadata: { academic_year_id: 'y', academic_year_name: '2026–27', subject_id: subject, subject_name: subject, assessment_date: date, name: `Test ${n}` } }) as unknown as FamilyAssessmentResult;

it('summarizes subjects published only beyond the newest 50 results', async () => {
  const recent = Array.from({ length: 50 }, (_, n) => result(n, n % 2 ? 'Maths' : 'English', `2026-11-${String(1 + (n % 28)).padStart(2, '0')}`));
  pages.clear(); pages.set(0, { rows: recent, total_count: 51 }); pages.set(50, { rows: [result(50, 'Sanskrit', '2026-07-15')], total_count: 51 });
  const signal = new AbortController().signal;
  const all = await loadAllPublishedResults(client, access, 'parent', pupil, signal);
  expect(fetchPage.mock.calls.map(call => [call[4], call[5]])).toEqual([[0, signal], [50, signal]]);
  expect(all.rows).toHaveLength(51); expect(all.total_count).toBe(51);
  expect(summarizePublishedResults(all.rows)?.subjects.map(subject => subject.latest.metadata.subject_id).sort()).toEqual(['English', 'Maths', 'Sanskrit']);
});

it('stops on an empty page and drops a result repeated across shifted pages', async () => {
  fetchPage.mockClear(); pages.clear();
  pages.set(0, { rows: [result(1, 'Maths', '2026-11-01'), result(2, 'Maths', '2026-10-01')], total_count: 5 });
  pages.set(2, { rows: [result(2, 'Maths', '2026-10-01'), result(3, 'Hindi', '2026-09-01')], total_count: 5 });
  const all = await loadAllPublishedResults(client, access, 'parent', pupil);
  expect(fetchPage.mock.calls.map(call => call[4])).toEqual([0, 2, 4]);
  expect(all.rows.map(row => row.assessment_id)).toEqual(['a1', 'a2', 'a3']);
});
