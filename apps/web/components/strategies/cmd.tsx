import type { ReactNode } from "react"

/** CLI command inside running text (empty states, hints). */
export function Cmd({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] break-words text-foreground">
      {children}
    </code>
  )
}
