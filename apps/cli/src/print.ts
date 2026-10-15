/** Compact human-readable output. Agents use --json; this is for Max at the terminal. */

const MAX_COL = 48

function scalar(v: unknown) {
  return (
    v === null ||
    v === undefined ||
    ["string", "number", "boolean"].includes(typeof v)
  )
}

function cell(v: unknown) {
  if (v === null || v === undefined) return "–"
  const s = String(v).replace(/\s+/g, " ")
  return s.length > MAX_COL ? s.slice(0, MAX_COL - 1) + "…" : s
}

const PREFERRED = [
  "id",
  "date",
  "accountId",
  "name",
  "handle",
  "status",
  "topic",
  "hook",
  "title",
  "text",
  "statement",
  "url",
  "kind",
  "plays",
  "dir",
]
const HIDDEN = new Set([
  "createdAt",
  "updatedAt",
  "sourceKey",
  "slides",
  "caption",
  "persona",
  "before",
  "after",
  "evidence",
  "rationale",
])

function table(rows: Record<string, unknown>[]) {
  const keys = new Set<string>()
  for (const r of rows)
    for (const [k, v] of Object.entries(r))
      if (scalar(v) && !HIDDEN.has(k)) keys.add(k)
  const cols = [...keys]
    .sort((a, b) => {
      const ia = PREFERRED.indexOf(a)
      const ib = PREFERRED.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    .slice(0, 7)
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => cell(r[c]).length))
  )
  const line = (vals: string[]) =>
    vals.map((v, i) => v.padEnd(widths[i])).join("  ")
  console.log(line(cols))
  console.log(widths.map((w) => "-".repeat(w)).join("  "))
  for (const r of rows) console.log(line(cols.map((c) => cell(r[c]))))
  console.log(`(${rows.length})`)
}

export function printHuman(value: unknown, indent = ""): void {
  if (Array.isArray(value)) {
    if (!value.length) return console.log(`${indent}(leer)`)
    if (value.every((v) => v && typeof v === "object" && !Array.isArray(v)))
      return table(value as Record<string, unknown>[])
    for (const v of value)
      console.log(`${indent}- ${scalar(v) ? cell(v) : JSON.stringify(v)}`)
    return
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (scalar(v)) console.log(`${indent}${k}: ${v ?? "–"}`)
      else if (Array.isArray(v)) {
        console.log(`${indent}${k}: ${v.length} Einträge`)
        if (v.length && v.length <= 12 && !indent) {
          for (const item of v) {
            if (scalar(item)) console.log(`  - ${cell(item)}`)
            else {
              const o = item as Record<string, unknown>
              const label = [
                "id",
                "date",
                "topic",
                "title",
                "text",
                "statement",
                "hook",
                "dir",
              ]
                .map((x) => o[x])
                .filter((x) => x !== undefined && x !== null)
              console.log(`  - ${label.map(cell).join(" · ")}`)
            }
          }
        }
      } else if (v && typeof v === "object" && !indent) {
        console.log(`${k}:`)
        printHuman(v, "  ")
      } else console.log(`${indent}${k}: {…}`)
    }
    return
  }
  console.log(String(value))
}
