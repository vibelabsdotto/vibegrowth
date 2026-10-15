import type { ReactNode } from "react"
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import {
  deltaTone,
  fmtDelta,
  label,
  LIGHT_LABEL,
  VERDICT_LABEL,
  type Tone,
} from "./format"

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-(--status-good)",
  warn: "text-(--status-warn)",
  bad: "text-(--status-bad)",
  neutral: "text-muted-foreground",
}

export const TONE_DOT: Record<Tone, string> = {
  good: "bg-(--status-good)",
  warn: "bg-(--status-warn)",
  bad: "bg-(--status-bad)",
  neutral: "bg-muted-foreground/50",
}

const LIGHT_TONE: Record<string, Tone> = {
  green: "good",
  yellow: "warn",
  red: "bad",
}

/** Traffic light as a status token: dot plus word, never colour alone. */
export function LightBadge({
  light,
  className,
}: {
  light: string
  className?: string
}) {
  const tone = LIGHT_TONE[light] ?? "neutral"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        TONE_TEXT[tone],
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])}
      />
      {label(LIGHT_LABEL, light)}
    </span>
  )
}

/** Relative change vs. previous window. */
export function Delta({
  value,
  invert = false,
  className,
  hideIcon = false,
}: {
  value: number | null | undefined
  invert?: boolean
  className?: string
  hideIcon?: boolean
}) {
  const tone = deltaTone(value, invert)
  const Icon =
    value === null || value === undefined || Math.abs(value) < 0.005
      ? ArrowRight
      : value > 0
        ? ArrowUpRight
        : ArrowDownRight
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs whitespace-nowrap tabular-nums",
        TONE_TEXT[tone],
        className
      )}
    >
      {!hideIcon && value !== null && value !== undefined ? (
        <Icon aria-hidden="true" className="size-3" />
      ) : null}
      {fmtDelta(value)}
    </span>
  )
}

const VERDICT_TONE: Record<string, Tone> = {
  win: "good",
  loss: "bad",
  neutral: "neutral",
  inconclusive: "warn",
}

export function VerdictToken({ verdict }: { verdict: string | null }) {
  if (!verdict) return null
  const tone = VERDICT_TONE[verdict] ?? "neutral"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        TONE_TEXT[tone]
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])}
      />
      {label(VERDICT_LABEL, verdict)}
    </span>
  )
}

export function SectionError({
  title = "Konnte nicht geladen werden",
  error,
}: {
  title?: string
  error: string
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  )
}

export function EmptyState({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <Empty className={cn("border", className)}>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {children}
    </Empty>
  )
}
