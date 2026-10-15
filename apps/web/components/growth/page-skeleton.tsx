import { Skeleton } from "@/components/ui/skeleton"

/** Loading state for growth pages: header, filter row, content blocks. */
export function PageSkeleton({
  blocks = 3,
  wide = true,
}: {
  blocks?: number
  wide?: boolean
}) {
  return (
    <div
      className={`mx-auto flex w-full ${wide ? "max-w-7xl" : "max-w-4xl"} min-w-0 flex-col gap-6`}
      aria-busy="true"
      aria-label="Wird geladen"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-8 w-72 max-w-full" />
      {Array.from({ length: blocks }, (_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  )
}
