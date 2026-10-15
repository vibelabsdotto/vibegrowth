/** Date helpers on plain YYYY-MM-DD strings (UTC arithmetic, no timezone drift). Client- and server-safe. */

export function parse(d: string) {
  const [y, m, day] = d.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}

export function iso(dt: Date) {
  return dt.toISOString().slice(0, 10)
}

export function plusDays(d: string, n: number) {
  const dt = parse(d)
  dt.setUTCDate(dt.getUTCDate() + n)
  return iso(dt)
}

export function localToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

/** Monday of the week containing d */
export function weekStart(d: string) {
  const dt = parse(d)
  const dow = (dt.getUTCDay() + 6) % 7
  return plusDays(d, -dow)
}

export function isoWeek(d: string) {
  const dt = parse(d)
  const day = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4))
  return (
    1 +
    Math.round(
      ((dt.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    )
  )
}

export function range(from: string, days: number) {
  return Array.from({ length: days }, (_, i) => plusDays(from, i))
}

/** Full weeks (Mon-Sun) covering the month of d */
export function monthGrid(d: string) {
  const first = `${d.slice(0, 7)}-01`
  const start = weekStart(first)
  const dt = parse(first)
  dt.setUTCMonth(dt.getUTCMonth() + 1)
  dt.setUTCDate(0)
  const last = iso(dt)
  const end = plusDays(weekStart(last), 6)
  const days =
    Math.round((parse(end).getTime() - parse(start).getTime()) / 86400000) + 1
  return range(start, days)
}

const WEEKDAY = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
const MONTH = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
]

export function weekday(d: string) {
  return WEEKDAY[(parse(d).getUTCDay() + 6) % 7]
}

export function dayMonth(d: string) {
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.`
}

export function monthLabel(d: string) {
  return `${MONTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
}

export function plusMonths(d: string, n: number) {
  const dt = parse(`${d.slice(0, 7)}-01`)
  dt.setUTCMonth(dt.getUTCMonth() + n)
  return iso(dt)
}

export function isDate(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s))
  )
}
