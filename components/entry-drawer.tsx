"use client"

import Link from "next/link"
import * as React from "react"
import {
  createEntry,
  deleteEntry,
  saveEntry,
  skipEntry,
  type ActionResult,
} from "@/app/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { actorLabel, fmtDateTime, PLAN_STATUS_LABEL } from "@/lib/labels"
import type { InspoLite, Lite, PlanEntryRow } from "@/lib/types"

export type EntryTarget =
  | { mode: "edit"; entry: PlanEntryRow }
  | { mode: "create"; defaults: { accountId?: string; date?: string | null } }

type Values = {
  accountId: string
  date: string
  formatId: string
  topic: string
  angle: string
  hookDirection: string
  hook: string
  rationale: string
  status: string
  inspirationId: string
  comment: string
  locked: boolean
}

function toValues(
  t: EntryTarget,
  accounts: (Lite & { defaultFormatId: string | null })[]
): Values {
  if (t.mode === "edit") {
    const e = t.entry
    return {
      accountId: e.accountId,
      date: e.date ?? "",
      formatId: e.formatId ?? "",
      topic: e.topic,
      angle: e.angle ?? "",
      hookDirection: e.hookDirection ?? "",
      hook: e.hook ?? "",
      rationale: e.rationale ?? "",
      status: e.status,
      inspirationId: e.inspirationId ? String(e.inspirationId) : "",
      comment: e.comment ?? "",
      locked: e.locked,
    }
  }
  const accountId = t.defaults.accountId ?? accounts[0]?.id ?? ""
  return {
    accountId,
    date: t.defaults.date ?? "",
    formatId: "",
    topic: "",
    angle: "",
    hookDirection: "",
    hook: "",
    rationale: "",
    status: t.defaults.date ? "planned" : "idea",
    inspirationId: "",
    comment: "",
    locked: false,
  }
}

export function EntryDrawer({
  target,
  onClose,
  accounts,
  formats,
  inspirations,
  postLink,
}: {
  target: EntryTarget | null
  onClose: () => void
  accounts: (Lite & { defaultFormatId: string | null })[]
  formats: Lite[]
  inspirations: InspoLite[]
  postLink?: { id: number; label: string } | null
}) {
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<Values | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [shown, setShown] = React.useState<EntryTarget | null>(null)
  const formId = React.useId()

  if (target !== shown) {
    setShown(target)
    if (target) {
      setValues(toValues(target, accounts))
      setError(null)
      setOpen(true)
    } else setOpen(false)
  }

  const entry = shown?.mode === "edit" ? shown.entry : null
  const activeFormatId = accounts.find(
    (a) => a.id === values?.accountId
  )?.defaultFormatId
  const activeName = formats.find((f) => f.id === activeFormatId)?.name
  const set = <K extends keyof Values>(k: K, v: Values[K]) =>
    setValues((prev) => (prev ? { ...prev, [k]: v } : prev))

  async function run(fn: () => Promise<ActionResult>, message: string) {
    setPending(true)
    setError(null)
    const res = await fn().catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }))
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return false
    }
    toast.add({ title: message, type: "success", timeout: 4000 })
    setOpen(false)
    return true
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!values) return
    if (entry)
      await run(() => saveEntry(entry.id, values), "Eintrag gespeichert")
    else await run(() => createEntry(values), "Eintrag angelegt")
  }

  const id = (name: string) => `${formId}-${name}`

  return (
    <Drawer
      open={open}
      swipeDirection="right"
      onOpenChange={(next, details) => {
        if (!next && pending) {
          details.cancel()
          return
        }
        setOpen(next)
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent className="h-dvh w-full max-w-full sm:w-[min(40rem,calc(100vw-3rem))]">
        <DrawerHeader>
          <DrawerTitle>
            {entry ? "Planeintrag" : "Eintrag hinzufügen"}
          </DrawerTitle>
          <DrawerDescription>
            {entry ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">
                  {PLAN_STATUS_LABEL[entry.status] ?? entry.status}
                </Badge>
                <Badge
                  variant={entry.origin === "max" ? "default" : "secondary"}
                >
                  {entry.origin === "max" ? "von Max" : "vom Agent"}
                </Badge>
                {entry.locked ? <Badge>gesperrt</Badge> : null}
                <span className="text-xs">
                  angelegt von {actorLabel(entry.createdBy)} · geändert{" "}
                  {fmtDateTime(entry.updatedAt)}
                </span>
              </span>
            ) : (
              "Von Max angelegte Einträge überschreibt der Agent nie."
            )}
          </DrawerDescription>
        </DrawerHeader>
        {values ? (
          <form
            id={formId}
            onSubmit={submit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <DrawerBody>
              {postLink ? (
                <Alert role="note">
                  <AlertDescription>
                    Post zu diesem Eintrag:{" "}
                    <Link
                      className="underline underline-offset-4"
                      href={`/posts/${postLink.id}`}
                    >
                      {postLink.label}
                    </Link>
                  </AlertDescription>
                </Alert>
              ) : null}
              <FieldGroup>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={id("account")}>Account</FieldLabel>
                    <NativeSelect
                      id={id("account")}
                      value={values.accountId}
                      disabled={!!entry || pending}
                      onChange={(e) => set("accountId", e.target.value)}
                    >
                      {accounts.map((a) => (
                        <NativeSelectOption key={a.id} value={a.id}>
                          {a.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={id("date")}>Datum</FieldLabel>
                    <Input
                      id={id("date")}
                      type="date"
                      value={values.date}
                      disabled={pending}
                      onChange={(e) => set("date", e.target.value)}
                    />
                    <FieldDescription>Leer = Ideen-Pool</FieldDescription>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor={id("topic")}>
                    Thema <span className="text-muted-foreground">*</span>
                  </FieldLabel>
                  <Input
                    id={id("topic")}
                    required
                    value={values.topic}
                    disabled={pending}
                    onChange={(e) => set("topic", e.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={id("angle")}>Angle</FieldLabel>
                    <Input
                      id={id("angle")}
                      value={values.angle}
                      disabled={pending}
                      onChange={(e) => set("angle", e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={id("format")}>Format</FieldLabel>
                    <NativeSelect
                      id={id("format")}
                      value={values.formatId}
                      disabled={pending}
                      onChange={(e) => set("formatId", e.target.value)}
                    >
                      <NativeSelectOption value="">
                        Aktives Format{activeName ? ` (${activeName})` : ""}
                      </NativeSelectOption>
                      {formats.map((f) => (
                        <NativeSelectOption key={f.id} value={f.id}>
                          {f.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor={id("hookDirection")}>
                    Hook-Richtung
                  </FieldLabel>
                  <Input
                    id={id("hookDirection")}
                    value={values.hookDirection}
                    disabled={pending}
                    onChange={(e) => set("hookDirection", e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={id("hook")}>Hook</FieldLabel>
                  <Textarea
                    id={id("hook")}
                    rows={2}
                    value={values.hook}
                    disabled={pending}
                    onChange={(e) => set("hook", e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={id("rationale")}>Begründung</FieldLabel>
                  <Textarea
                    id={id("rationale")}
                    rows={4}
                    value={values.rationale}
                    disabled={pending}
                    onChange={(e) => set("rationale", e.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={id("status")}>Status</FieldLabel>
                    <NativeSelect
                      id={id("status")}
                      value={values.status}
                      disabled={pending}
                      onChange={(e) => set("status", e.target.value)}
                    >
                      {Object.entries(PLAN_STATUS_LABEL).map(
                        ([value, label]) => (
                          <NativeSelectOption key={value} value={value}>
                            {label}
                          </NativeSelectOption>
                        )
                      )}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={id("inspiration")}>
                      Inspiration
                    </FieldLabel>
                    <NativeSelect
                      id={id("inspiration")}
                      value={values.inspirationId}
                      disabled={pending}
                      onChange={(e) => set("inspirationId", e.target.value)}
                    >
                      <NativeSelectOption value="">–</NativeSelectOption>
                      {inspirations.map((i) => (
                        <NativeSelectOption key={i.id} value={String(i.id)}>
                          {i.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor={id("comment")}>
                    Kommentar von Max
                  </FieldLabel>
                  <Textarea
                    id={id("comment")}
                    rows={2}
                    value={values.comment}
                    disabled={pending}
                    onChange={(e) => set("comment", e.target.value)}
                  />
                </Field>
                <Field orientation="horizontal">
                  <Switch
                    id={id("locked")}
                    checked={values.locked}
                    disabled={pending}
                    onCheckedChange={(v) => set("locked", v)}
                  />
                  <FieldLabel htmlFor={id("locked")}>
                    Sperren: der Agent darf den Eintrag nicht ändern
                  </FieldLabel>
                </Field>
              </FieldGroup>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </DrawerBody>
            <DrawerFooter className="justify-between">
              <div className="flex flex-wrap gap-2">
                {entry ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Löschen
                    </Button>
                    {entry.status !== "skipped" ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => skipEntry(entry.id), "Eintrag übersprungen")
                        }
                      >
                        Überspringen
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                >
                  Abbrechen
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : null}
                  {entry ? "Speichern" : "Anlegen"}
                </Button>
              </div>
            </DrawerFooter>
          </form>
        ) : null}
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Eintrag löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                Der Eintrag verschwindet aus dem Plan. Der Verlauf behält den
                alten Stand.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>
                Abbrechen
              </AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={async () => {
                  if (!entry) return
                  const ok = await run(
                    () => deleteEntry(entry.id),
                    "Eintrag gelöscht"
                  )
                  setConfirmDelete(false)
                  if (!ok) return
                }}
              >
                Löschen
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DrawerContent>
    </Drawer>
  )
}
