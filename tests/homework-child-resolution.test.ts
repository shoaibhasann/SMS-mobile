import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type { FamilyAccess, FamilyChild } from '../src/data/family';

const id = (n: number) => `63000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const linked = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('../src/data/family', () => ({ listChildren: vi.fn(async () => linked.ids.map(value => ({ id: value }))) }));
import { resolveHomeworkChild } from '../src/data/homework';

const access: FamilyAccess = { userId: id(1), schoolId: id(2), name: 'QA family', roles: ['parent'] };
const pupil = (n: number): FamilyChild => ({ id: id(n), school_id: id(2), admission_no: `QA-${n}`, first_name: `Child ${n}`, middle_name: null, last_name: null, roll_no: null, status: 'active' });
const [aman, zoya, ira] = [pupil(3), pupil(4), pupil(5)];
// Aman is withdrawn (no enrollment), Ira is in another class, Zoya's class holds the homework.
const classOf: Record<string, string | null> = { [aman.id]: null, [ira.id]: id(7), [zoya.id]: id(6) };
const homework = id(9);

function client() {
  return { from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder = {
      select: () => builder, or: () => builder, abortSignal: () => builder, maybeSingle: () => builder,
      eq: (column: string, value: unknown) => { filters[column] = value; return builder; },
      then: (resolve: (value: unknown) => unknown) => {
        const enrolledIn = classOf[filters.student_id as string];
        const data = table === 'academic_years' ? { id: id(10), school_id: id(2), is_current: true }
          : table === 'enrollments' ? enrolledIn ? { student_id: filters.student_id, academic_year_id: id(10), class_id: enrolledIn, section_id: id(8), status: 'active' } : null
            : filters['class_logs.class_id'] === id(6) && filters.id === homework ? { id: homework } : null;
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return builder;
  } } as unknown as SupabaseClient;
}

it('skips a withdrawn sibling and a sibling in another class to find the homework’s own child', async () => {
  linked.ids = [aman.id, ira.id, zoya.id];
  await expect(resolveHomeworkChild(client(), access, 'parent', [aman, ira, zoya], homework)).resolves.toBe(zoya);
});

it('says the homework is unavailable instead of blaming school access when no linked child can see it', async () => {
  linked.ids = [aman.id, ira.id];
  await expect(resolveHomeworkChild(client(), access, 'parent', [aman, ira], homework)).rejects.toMatchObject({
    code: 'unavailable', message: 'This homework is not available for your linked children. Refresh updates or contact your school.' });
});

it('still fails closed for an unlinked child or a malformed activity id', async () => {
  linked.ids = [];
  await expect(resolveHomeworkChild(client(), access, 'parent', [zoya], homework)).rejects.toMatchObject({ code: '42501' });
  await expect(resolveHomeworkChild(client(), access, 'parent', [zoya], 'bad')).rejects.toThrow('could not be verified');
});
