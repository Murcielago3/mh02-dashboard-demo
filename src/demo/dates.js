// All demo dates are generated relative to "now" so the demo always looks live:
// the current timesheet week is open, some deadlines are upcoming, a few overdue.
export const NOW = new Date()

export function iso(d) {
  // YYYY-MM-DD in local time (no TZ shift from toISOString()).
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isoDateTime(d) {
  return iso(d) + 'T' + d.toTimeString().slice(0, 8)
}

export function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function addMonths(d, n) {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

// Monday of the week containing d (ISO week start).
export function mondayOf(d) {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7 // 0 = Monday
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return x
}

// "YYYY-MM" month key
export function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// The Monday date-strings for the last `n` weeks, oldest first, including this week.
export function recentWeekStarts(n) {
  const thisMon = mondayOf(NOW)
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(iso(addDays(thisMon, -7 * i)))
  return out
}
