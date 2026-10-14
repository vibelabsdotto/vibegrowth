"use client"

import * as React from "react"
import type { ActionResult } from "@/app/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
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

export type FieldSpec = {
  name: string
  label: string
  type?: "text" | "textarea" | "select" | "date" | "number" | "switch" | "url"
  options?: { value: string; label: string }[]
  required?: boolean
  placeholder?: string
  description?: string
  rows?: number
}

export type FormValues = Record<string, string | boolean>

export function FormDrawer({
  title,
  description,
  trigger,
  fields,
  initial = {},
  submitLabel = "Speichern",
  successMessage,
  action,
  onSuccess,
  open: openProp,
  onOpenChange,
  width = "sm:w-[min(32rem,calc(100vw-3rem))]",
  children,
}: {
  title: string
  description?: string
  trigger?: (open: () => void) => React.ReactNode
  fields: FieldSpec[]
  initial?: FormValues
  submitLabel?: string
  successMessage?: string
  action: (values: FormValues) => Promise<ActionResult>
  onSuccess?: (data: unknown) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  width?: string
  children?: React.ReactNode
}) {
  const [innerOpen, setInnerOpen] = React.useState(false)
  const open = openProp ?? innerOpen
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInnerOpen(next)
    onOpenChange?.(next)
  }
  const [values, setValues] = React.useState<FormValues>(initial)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const formId = React.useId()

  const show = () => {
    setValues(initial)
    setError(null)
    setOpen(true)
  }

  // Reset the form whenever a controlled drawer is opened from outside.
  const [lastOpen, setLastOpen] = React.useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setValues(initial)
      setError(null)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await action(values).catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }))
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    toast.add({
      title: successMessage ?? "Gespeichert",
      type: "success",
      timeout: 4000,
    })
    setOpen(false)
    onSuccess?.(res.data)
  }

  const set = (name: string, v: string | boolean) =>
    setValues((prev) => ({ ...prev, [name]: v }))

  return (
    <>
      {trigger?.(show)}
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
      >
        <DrawerContent className={`h-dvh w-full max-w-full ${width}`}>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            {description ? (
              <DrawerDescription>{description}</DrawerDescription>
            ) : null}
          </DrawerHeader>
          <form
            id={formId}
            onSubmit={submit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <DrawerBody>
              {children}
              <FieldGroup>
                {fields.map((f) => {
                  const id = `${formId}-${f.name}`
                  const value = values[f.name]
                  if (f.type === "switch") {
                    return (
                      <Field key={f.name} orientation="horizontal">
                        <Switch
                          id={id}
                          checked={value === true}
                          onCheckedChange={(v) => set(f.name, v)}
                          disabled={pending}
                        />
                        <FieldLabel htmlFor={id}>{f.label}</FieldLabel>
                        {f.description ? (
                          <FieldDescription>{f.description}</FieldDescription>
                        ) : null}
                      </Field>
                    )
                  }
                  return (
                    <Field key={f.name}>
                      <FieldLabel htmlFor={id}>
                        {f.label}
                        {f.required ? (
                          <span className="text-muted-foreground"> *</span>
                        ) : null}
                      </FieldLabel>
                      {f.type === "textarea" ? (
                        <Textarea
                          id={id}
                          rows={f.rows ?? 4}
                          value={String(value ?? "")}
                          placeholder={f.placeholder}
                          required={f.required}
                          disabled={pending}
                          onChange={(e) => set(f.name, e.target.value)}
                        />
                      ) : f.type === "select" ? (
                        <NativeSelect
                          id={id}
                          value={String(value ?? "")}
                          required={f.required}
                          disabled={pending}
                          onChange={(e) => set(f.name, e.target.value)}
                        >
                          {f.options?.map((o) => (
                            <NativeSelectOption key={o.value} value={o.value}>
                              {o.label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      ) : (
                        <Input
                          id={id}
                          type={f.type ?? "text"}
                          value={String(value ?? "")}
                          placeholder={f.placeholder}
                          required={f.required}
                          disabled={pending}
                          onChange={(e) => set(f.name, e.target.value)}
                        />
                      )}
                      {f.description ? (
                        <FieldDescription>{f.description}</FieldDescription>
                      ) : null}
                    </Field>
                  )
                })}
              </FieldGroup>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </DrawerBody>
            <DrawerFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : null}
                {submitLabel}
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    </>
  )
}
