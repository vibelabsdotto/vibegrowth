"use client"

import * as React from "react"
import { RefreshCw, Settings2 } from "lucide-react"
import { collectNow, setCollector } from "@/app/growth-actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import type { CollectorState, ConfigField } from "@/lib/growth-types"
import { cn } from "@/lib/utils"
import { COLLECTOR_LABEL, fmtAgo, fmtDateTime, json, label } from "./format"
import { TONE_DOT } from "./status"

type Config = Record<string, unknown>

function toText(field: ConfigField, v: unknown) {
  if (v === undefined || v === null) return ""
  if (field.type === "string" || field.type === "number") return String(v)
  if (field.type === "string[]" && Array.isArray(v)) return v.join("\n")
  return JSON.stringify(v, null, 2)
}

function placeholderOf(field: ConfigField, fallback?: unknown) {
  const v = fallback ?? field.example ?? field.default
  if (v === undefined || v === null) return undefined
  return typeof v === "string" ? v : JSON.stringify(v)
}

/** Text → config value. Empty means "remove the key" (null), contract §7.5. */
function parse(key: string, field: ConfigField, text: string): unknown {
  const t = text.trim()
  if (t === "") return null
  if (field.type === "string") return t
  if (field.type === "number") {
    const n = Number(t.replace(",", "."))
    if (Number.isNaN(n)) throw new Error(`${key}: keine Zahl`)
    return n
  }
  if (field.type === "string[]" && !t.startsWith("["))
    return t
      .split(/\n/)
      .map((x) => x.trim())
      .filter(Boolean)
  try {
    return JSON.parse(t) as unknown
  } catch {
    throw new Error(`${key}: kein gültiges JSON`)
  }
}

export function CollectorPanel({
  project,
  collectors,
  now,
}: {
  project: string
  collectors: CollectorState[]
  /** Server time for "vor X Std." (same value on server and client render). */
  now: number
}) {
  const [editing, setEditing] = React.useState<string | null>(null)
  const opener = React.useRef<HTMLElement | null>(null)
  const current = collectors.find((c) => c.collector === editing) ?? null

  return (
    <>
      <ul className="flex flex-col divide-y">
        {collectors.map((c) => (
          <CollectorRow
            key={c.collector}
            project={project}
            c={c}
            now={now}
            onEdit={(el) => {
              opener.current = el
              setEditing(c.collector)
            }}
          />
        ))}
      </ul>
      {current ? (
        <ConfigDrawer
          key={current.collector}
          project={project}
          c={current}
          open={editing !== null}
          onClose={() => {
            setEditing(null)
            requestAnimationFrame(() => opener.current?.focus())
          }}
        />
      ) : null}
    </>
  )
}

function useCollect(project: string, c: CollectorState) {
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  async function run() {
    setRunning(true)
    setError(null)
    const res = await collectNow(project, c.collector).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }))
    setRunning(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const r = res.data.runs?.[0]
    if (!r) {
      setError(
        "Kein Lauf gestartet. Nur eingeschaltete Collectors werden abgerufen."
      )
      return
    }
    if (!r.ok) {
      setError(r.error ?? r.summary ?? "Abruf fehlgeschlagen")
      return
    }
    toast.add({
      title: `${c.label ?? label(COLLECTOR_LABEL, c.collector)} abgerufen`,
      description: r.summary ?? undefined,
      type: "success",
      timeout: 5000,
    })
  }
  return { running, error, run }
}

function CollectorRow({
  project,
  c,
  now,
  onEdit,
}: {
  project: string
  c: CollectorState
  now: number
  onEdit: (el: HTMLElement) => void
}) {
  const [override, setOverride] = React.useState<{
    value: boolean
    base: boolean
  } | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [toggleError, setToggleError] = React.useState<string | null>(null)
  const { running, error, run } = useCollect(project, c)
  // A newer server value wins over the local toggle.
  const enabled =
    override && override.base === c.enabled ? override.value : c.enabled
  const name = c.label ?? label(COLLECTOR_LABEL, c.collector)
  const switchId = React.useId()
  const last = c.lastRun

  async function toggle(next: boolean) {
    setSaving(true)
    setToggleError(null)
    setOverride({ value: next, base: c.enabled })
    const res = await setCollector(project, c.collector, {
      enabled: next,
    }).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }))
    setSaving(false)
    if (!res.ok) {
      setOverride(null)
      setToggleError(res.error)
      return
    }
    toast.add({
      title: `${name} ${next ? "eingeschaltet" : "ausgeschaltet"}`,
      type: "success",
      timeout: 3000,
    })
  }

  const tone = !last ? "neutral" : last.ok ? "good" : "bad"
  return (
    <li className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <Switch
          id={switchId}
          checked={enabled}
          disabled={saving}
          onCheckedChange={(v) => void toggle(v)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <label htmlFor={switchId} className="truncate text-sm font-medium">
            {name}
          </label>
          <span
            className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
            title={last?.error ?? last?.summary ?? undefined}
          >
            <span
              aria-hidden="true"
              className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])}
            />
            <span className="truncate">
              {!last
                ? "noch nie abgerufen"
                : `${last.ok ? "ok" : "Fehler"} ${fmtAgo(last.finishedAt ?? last.startedAt, now)}${
                    last.ok
                      ? last.summary
                        ? ` · ${last.summary}`
                        : ""
                      : last.error
                        ? ` · ${last.error}`
                        : ""
                  }`}
            </span>
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} jetzt abrufen`}
          title="Jetzt abrufen"
          disabled={!enabled || running || saving}
          onClick={() => void run()}
        >
          {running ? <Spinner aria-hidden="true" /> : <RefreshCw />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} konfigurieren`}
          title="Konfigurieren"
          onClick={(e) => onEdit(e.currentTarget)}
        >
          <Settings2 />
        </Button>
      </div>
      {toggleError || error ? (
        <p className="text-xs text-destructive" role="alert">
          {toggleError ?? error}
        </p>
      ) : null}
    </li>
  )
}

function ConfigDrawer({
  project,
  c,
  open,
  onClose,
}: {
  project: string
  c: CollectorState
  open: boolean
  onClose: () => void
}) {
  const schema = c.configSchema ?? {}
  const config = json<Config>(c.config, {})
  const keys = [
    ...Object.keys(schema),
    ...Object.keys(config).filter((k) => !(k in schema)),
  ]
  const fieldOf = (k: string): ConfigField =>
    schema[k] ?? {
      type: typeof config[k] === "string" ? "string" : "object",
      description: "Nicht im Schema",
    }
  const initial = Object.fromEntries(
    keys.map((k) => [k, toText(fieldOf(k), config[k])])
  )
  const [values, setValues] = React.useState<Record<string, string>>(initial)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const { running, error: collectError, run } = useCollect(project, c)
  const formId = React.useId()
  const name = c.label ?? label(COLLECTOR_LABEL, c.collector)
  const dirty = keys.some((k) => values[k] !== initial[k])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    let patch: Config
    try {
      patch = Object.fromEntries(
        keys
          .filter((k) => values[k] !== initial[k])
          .map((k) => [k, parse(k, fieldOf(k), values[k] ?? "")])
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    setSaving(true)
    const res = await setCollector(project, c.collector, {
      config: patch,
    }).catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }))
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    toast.add({
      title: `${name}: Konfiguration gespeichert`,
      type: "success",
      timeout: 4000,
    })
    onClose()
  }

  const busy = saving || running
  return (
    <Drawer
      open={open}
      swipeDirection="right"
      onOpenChange={(next, details) => {
        if (!next && busy) {
          details.cancel()
          return
        }
        if (!next) onClose()
      }}
    >
      <DrawerContent className="h-dvh w-full max-w-full sm:w-[min(34rem,calc(100vw-3rem))]">
        <DrawerHeader>
          <DrawerTitle>{name}</DrawerTitle>
          <DrawerDescription>
            {c.enabled ? "Eingeschaltet" : "Ausgeschaltet"}
            {c.lastRun
              ? ` · letzter Lauf ${fmtDateTime(c.lastRun.startedAt)} (${c.lastRun.ok ? "ok" : "Fehler"})`
              : " · noch nie abgerufen"}
          </DrawerDescription>
        </DrawerHeader>
        <form
          id={formId}
          onSubmit={save}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DrawerBody>
            {keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Dieser Collector braucht keine Konfiguration.
              </p>
            ) : (
              <FieldGroup>
                {keys.map((k) => {
                  const f = fieldOf(k)
                  const id = `${formId}-${k}`
                  const multiline = f.type !== "string" && f.type !== "number"
                  return (
                    <Field key={k}>
                      <FieldLabel htmlFor={id} className="font-mono">
                        {k}
                        {f.required ? (
                          <span className="text-muted-foreground"> *</span>
                        ) : null}
                        {f.type ? (
                          <Badge variant="outline" className="font-sans">
                            {f.type === "string[]" ? "Liste" : f.type}
                          </Badge>
                        ) : null}
                      </FieldLabel>
                      {multiline ? (
                        <Textarea
                          id={id}
                          rows={f.type === "string[]" ? 3 : 4}
                          className="font-mono text-xs"
                          value={values[k] ?? ""}
                          placeholder={placeholderOf(f, c.defaults?.[k])}
                          disabled={busy}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [k]: e.target.value }))
                          }
                        />
                      ) : (
                        <Input
                          id={id}
                          className="font-mono text-xs"
                          inputMode={
                            f.type === "number" ? "decimal" : undefined
                          }
                          value={values[k] ?? ""}
                          placeholder={placeholderOf(f, c.defaults?.[k])}
                          disabled={busy}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [k]: e.target.value }))
                          }
                        />
                      )}
                      {f.description ? (
                        <FieldDescription>
                          {f.description}
                          {f.type === "string[]"
                            ? " Ein Eintrag pro Zeile."
                            : f.type === "object" || f.type === "array"
                              ? " JSON."
                              : ""}
                        </FieldDescription>
                      ) : null}
                    </Field>
                  )
                })}
              </FieldGroup>
            )}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Nicht gespeichert</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {collectError ? (
              <Alert variant="destructive">
                <AlertTitle>Abruf fehlgeschlagen</AlertTitle>
                <AlertDescription>{collectError}</AlertDescription>
              </Alert>
            ) : null}
            {c.lastRun?.error && !collectError ? (
              <Alert>
                <AlertTitle>Letzter Fehler</AlertTitle>
                <AlertDescription>{c.lastRun.error}</AlertDescription>
              </Alert>
            ) : null}
          </DrawerBody>
          <DrawerFooter className="justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !c.enabled || dirty}
              title={
                !c.enabled
                  ? "Erst einschalten"
                  : dirty
                    ? "Erst speichern"
                    : undefined
              }
              onClick={() => void run()}
            >
              {running ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : (
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
              )}
              Jetzt abrufen
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                Schließen
              </Button>
              {keys.length ? (
                <Button type="submit" disabled={busy || !dirty}>
                  {saving ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : null}
                  Konfiguration speichern
                </Button>
              ) : null}
            </div>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
