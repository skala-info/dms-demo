// core/dates.js — the only date formatting in the system.
//
// Dates with fiscal meaning (a donation date) are plain YYYY-MM-DD strings in the
// organization's timezone and are never converted through a Date object for display.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-08-27" -> "August 27, 2026" */
export function formatDateLong(isoDate) {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** English pluralisation for the small set of nouns the templates need. */
export const plural = (count, singular, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;
