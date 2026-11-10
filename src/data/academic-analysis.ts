import type { FamilyAssessmentResult } from './results';

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
