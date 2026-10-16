import { Star } from "lucide-react"
import { cn } from "@/lib/utils"

/** Star rating as on /store: low ratings in the bad tone, text for screen readers. */
export function Stars({ value }: { value: number | null }) {
  if (value === null) return null
  return (
    <span
      className="inline-flex items-center gap-0.5"
      title={`${value} von 5 Sternen`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={cn(
            "size-3.5",
            i <= value
              ? value <= 2
                ? "fill-(--status-bad) text-(--status-bad)"
                : "fill-foreground text-foreground"
              : "text-muted-foreground/40"
          )}
        />
      ))}
      <span className="sr-only">{value} von 5 Sternen</span>
    </span>
  )
}
