"use client"

import { Plus } from "lucide-react"
import {
  createDecision,
  createHook,
  createHookVariant,
  createInspiration,
  createLearning,
  saveInspiration,
  setHookWinner,
  setLearningStatus,
} from "@/app/actions"
import { FormDrawer, type FieldSpec } from "@/components/form-drawer"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { INSPO_STATUS_LABEL, INSPO_TYPE_LABEL, options } from "@/lib/labels"

type Opt = { value: string; label: string }

const scopeFields = (accounts: Opt[], brands: Opt[]): FieldSpec[] => [
  {
    name: "scopeType",
    label: "Gilt für",
    type: "select",
    options: [
      { value: "account", label: "Account" },
      { value: "brand", label: "Projekt" },
      { value: "global", label: "alle" },
    ],
  },
  {
    name: "scopeId",
    label: "Account oder Projekt",
    type: "select",
    options: [
      { value: "", label: "–" },
      ...accounts,
      ...brands.map((b) => ({ ...b, label: `Projekt: ${b.label}` })),
    ],
  },
]

function AddButton({ label }: { label: string }) {
  function render(open: () => void) {
    return (
      <Button size="sm" onClick={open}>
        <Plus data-icon="inline-start" aria-hidden="true" />
        {label}
      </Button>
    )
  }
  return render
}

function report(res: { ok: boolean; error?: string }, ok: string) {
  toast.add(
    res.ok
      ? { title: ok, type: "success", timeout: 3000 }
      : { title: "Nicht gespeichert", description: res.error, type: "error" }
  )
}

export function NewLearning({
  accounts,
  brands,
  account,
  brand,
}: {
  accounts: Opt[]
  brands: Opt[]
  account?: string
  /** Project from the sidebar switcher: preselected when it has no account. */
  brand?: string
}) {
  const firstAccount = account ?? accounts[0]?.value
  return (
    <FormDrawer
      title="Learning hinzufügen"
      description="Jedes Learning braucht einen Beleg: welche Posts, welche Zahlen."
      trigger={AddButton({ label: "Learning" })}
      initial={
        firstAccount || !brand
          ? { scopeType: "account", scopeId: firstAccount ?? "" }
          : { scopeType: "brand", scopeId: brand }
      }
      fields={[
        ...scopeFields(accounts, brands),
        {
          name: "statement",
          label: "Aussage",
          type: "textarea",
          required: true,
          rows: 2,
        },
        {
          name: "evidence",
          label: "Beleg",
          type: "textarea",
          required: true,
          description: "Posts und Zahlen",
        },
        { name: "date", label: "Datum", type: "date" },
      ]}
      action={createLearning}
      successMessage="Learning gespeichert"
    />
  )
}

export function LearningStatusButton({
  id,
  status,
}: {
  id: number
  status: string
}) {
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={async () =>
        report(
          await setLearningStatus(
            id,
            status === "active" ? "outdated" : "active"
          ),
          status === "active" ? "Als überholt markiert" : "Wieder aktiv"
        )
      }
    >
      {status === "active" ? "Überholt" : "Wieder aktiv"}
    </Button>
  )
}

export function NewDecision({
  accounts,
  brands,
  brand,
}: {
  accounts: Opt[]
  brands: Opt[]
  /** Project from the sidebar switcher, preselected. */
  brand?: string
}) {
  return (
    <FormDrawer
      title="Entscheidung festhalten"
      description="Pivots sind Entscheidungen. Begründung ist Pflicht."
      trigger={AddButton({ label: "Entscheidung" })}
      initial={{
        scopeType: "brand",
        scopeId: brand ?? brands[0]?.value ?? "",
        pivot: false,
      }}
      fields={[
        ...scopeFields(accounts, brands),
        { name: "title", label: "Titel", required: true },
        {
          name: "rationale",
          label: "Begründung",
          type: "textarea",
          required: true,
          rows: 5,
        },
        { name: "pivot", label: "Pivot", type: "switch" },
        { name: "date", label: "Datum", type: "date" },
        { name: "source", label: "Quelle" },
      ]}
      action={createDecision}
      successMessage="Entscheidung gespeichert"
    />
  )
}

export function NewHook({ accounts }: { accounts: Opt[] }) {
  return (
    <FormDrawer
      title="Hook hinzufügen"
      trigger={AddButton({ label: "Hook" })}
      initial={{ accountId: accounts[0]?.value ?? "", winner: false }}
      fields={[
        {
          name: "accountId",
          label: "Account",
          type: "select",
          options: accounts,
        },
        {
          name: "text",
          label: "Hook",
          type: "textarea",
          required: true,
          rows: 2,
        },
        { name: "mechanism", label: "Mechanismus", type: "textarea", rows: 2 },
        { name: "winner", label: "Gewinner", type: "switch" },
      ]}
      action={createHook}
      successMessage="Hook gespeichert"
    />
  )
}

export function HookActions({
  id,
  winner,
  variants,
}: {
  id: number
  winner: boolean
  variants: number
}) {
  return (
    <div className="flex gap-1">
      <Button
        size="xs"
        variant="ghost"
        onClick={async () =>
          report(
            await setHookWinner(id, !winner),
            winner ? "Kein Gewinner mehr" : "Als Gewinner markiert"
          )
        }
      >
        {winner ? "Gewinner entfernen" : "Als Gewinner"}
      </Button>
      {variants < 3 ? (
        <FormDrawer
          title="Variante hinzufügen"
          description="Gleicher Mechanismus, anderes Thema. Höchstens drei pro Gewinner."
          trigger={(open) => (
            <Button size="xs" variant="ghost" onClick={open}>
              Variante
            </Button>
          )}
          fields={[
            {
              name: "text",
              label: "Hook",
              type: "textarea",
              required: true,
              rows: 2,
            },
            { name: "mechanism", label: "Mechanismus (leer = wie Gewinner)" },
          ]}
          action={(v) => createHookVariant(id, v)}
          successMessage="Variante gespeichert"
        />
      ) : null}
    </div>
  )
}

export function NewInspiration({
  accounts,
  brands,
  brand,
}: {
  /** Accounts of the project from the switcher (all for "Alle Projekte"). */
  accounts: Opt[]
  brands: Opt[]
  /** Project from the sidebar switcher, preselected. */
  brand?: string
}) {
  return (
    <FormDrawer
      title="Inspiration speichern"
      description="Link einfügen, Rest ist optional."
      trigger={AddButton({ label: "Link speichern" })}
      initial={{ type: "format", brandId: brand ?? "", accountId: "" }}
      fields={[
        {
          name: "url",
          label: "Link",
          type: "url",
          required: true,
          placeholder: "https://www.tiktok.com/@…",
        },
        {
          name: "type",
          label: "Typ",
          type: "select",
          options: options(INSPO_TYPE_LABEL),
        },
        {
          name: "brandId",
          label: "Projekt",
          type: "select",
          options: [{ value: "", label: "projektübergreifend" }, ...brands],
          description: "Leer und ohne Account: für alle Projekte offen",
        },
        {
          name: "accountId",
          label: "Für Account",
          type: "select",
          options: [{ value: "", label: "noch offen" }, ...accounts],
        },
        { name: "note", label: "Notiz", type: "textarea", rows: 3 },
        { name: "tags", label: "Tags", description: "Kommagetrennt" },
      ]}
      action={createInspiration}
      successMessage="Inspiration gespeichert"
    />
  )
}

export function EditInspiration({
  item,
  accounts,
}: {
  item: {
    id: number
    status: string
    type: string
    note: string | null
    tags: string[]
    accountId: string | null
  }
  accounts: Opt[]
}) {
  return (
    <FormDrawer
      title="Inspiration bearbeiten"
      trigger={(open) => (
        <Button size="xs" variant="ghost" onClick={open}>
          Bearbeiten
        </Button>
      )}
      initial={{
        status: item.status,
        type: item.type,
        note: item.note ?? "",
        tags: item.tags.join(", "),
        accountId: item.accountId ?? "",
      }}
      fields={[
        {
          name: "status",
          label: "Status",
          type: "select",
          options: options(INSPO_STATUS_LABEL),
        },
        {
          name: "type",
          label: "Typ",
          type: "select",
          options: options(INSPO_TYPE_LABEL),
        },
        {
          name: "accountId",
          label: "Für Account",
          type: "select",
          options: [{ value: "", label: "noch offen" }, ...accounts],
        },
        { name: "note", label: "Notiz", type: "textarea", rows: 3 },
        { name: "tags", label: "Tags" },
      ]}
      action={(v) => saveInspiration(item.id, v)}
      successMessage="Inspiration gespeichert"
    />
  )
}
