import type { SupabaseClient } from '@supabase/supabase-js';
import type { FamilyAccess, FamilyChild, FamilyRole } from './family';
import { getFamilyAssessmentResults, type FamilyAssessmentResult } from './results';

// The RPC pages 50 results by publish time, so the subject summary must read every page, not just the newest 50.
export async function loadAllPublishedResults(client: SupabaseClient, access: FamilyAccess, role: FamilyRole, pupil: FamilyChild, signal?: AbortSignal) {
  const rows: FamilyAssessmentResult[] = [], seen = new Set<string>();
  let offset = 0, total = 0;
  for (;;) {
    const page = await getFamilyAssessmentResults(client, access, role, pupil, offset, signal);
    total = page.total_count;
    // A result published between pages shifts later pages by one; keep the first copy.
    for (const row of page.rows) if (!seen.has(row.assessment_id)) { seen.add(row.assessment_id); rows.push(row); }
    offset += page.rows.length;
    if (!page.rows.length || offset >= total) return { rows, total_count: total };
  }
}

export function summarizePublishedResults(rows: readonly FamilyAssessmentResult[]) {
  const ordered = [...rows].sort((a, b) => b.metadata.assessment_date.localeCompare(a.metadata.assessment_date)
    || Date.parse(b.published_at) - Date.parse(a.published_at));
  const year = ordered[0]?.metadata;
  if (!year) return null;
  const subjects = new Map<string, { latest: FamilyAssessmentResult; previous: FamilyAssessmentResult | null }>();
  for (const row of ordered) {
    if (row.metadata.academic_year_id !== year.academic_year_id) continue;
    const subject = subjects.get(row.metadata.subject_id);
    if (!subject) subjects.set(row.metadata.subject_id, { latest: row, previous: null });
    else if (!subject.previous && row.metadata.assessment_date < subject.latest.metadata.assessment_date) subject.previous = row;
  }
  return { year: year.academic_year_name, subjects: Array.from(subjects.values()) };
}
