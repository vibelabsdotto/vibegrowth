"use client"

import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { createAccount } from "@/app/actions"
import { FormDrawer } from "@/components/form-drawer"
import { Button } from "@/components/ui/button"
import { ACCOUNT_STATUS_LABEL, CTA_LABEL, options } from "@/lib/labels"

type Opt = { value: string; label: string }

/** Guided account creation: record, folder structure (posts, persona, analysis, pulls) and optional new character. */
export function NewAccount({
  brands,
  brand,
  formats,
  characters,
}: {
  brands: Opt[]
  /** Project from the sidebar switcher, preselected. */
  brand?: string
  formats: Opt[]
  characters: Opt[]
}) {
  const router = useRouter()
  return (
    <FormDrawer
      title="Account anlegen"
      description="Legt den Datensatz und die Ordner posts, persona, analysis und pulls im Datenordner an. Referenzbilder hängt der Agent per CLI an."
      width="sm:w-[min(40rem,calc(100vw-3rem))]"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          Account anlegen
        </Button>
      )}
      initial={{
        brandId: brand ?? brands[0]?.value ?? "",
        status: "planned",
        ctaRule: "engagement",
        postsPerDay: "1",
        mode: "autopilot",
        characterId: "",
        newCharacter: false,
      }}
      fields={[
        {
          name: "brandId",
          label: "Projekt",
          type: "select",
          options: brands,
          required: true,
        },
        {
          name: "name",
          label: "Name",
          required: true,
          placeholder: "z. B. Lottie",
        },
        {
          name: "id",
          label: "ID / Ordner-Slug",
          placeholder: "leer = aus dem Namen",
          description: "Ordner wird <projekt>/<id>",
        },
        {
          name: "handle",
          label: "Plattform-Handle",
          placeholder: "@lottie.eats.plants",
        },
        { name: "language", label: "Sprache", placeholder: "DE, EN-UK …" },
        {
          name: "status",
          label: "Status",
          type: "select",
          options: options(ACCOUNT_STATUS_LABEL),
        },
        {
          name: "mode",
          label: "Modus",
          placeholder: "autopilot, manual, test",
        },
        {
          name: "formatId",
          label: "Aktives Format",
          type: "select",
          options: [{ value: "", label: "–" }, ...formats],
        },
        {
          name: "ctaRule",
          label: "CTA-Regel",
          type: "select",
          options: options(CTA_LABEL),
        },
        { name: "postsPerDay", label: "Posts pro Tag", type: "number" },
        {
          name: "characterId",
          label: "Bestehender Charakter",
          type: "select",
          options: [{ value: "", label: "keiner" }, ...characters],
        },
        {
          name: "newCharacter",
          label: "Neuen KI-Charakter anlegen",
          type: "switch",
        },
        { name: "characterName", label: "Name des Charakters" },
        { name: "persona", label: "Persona", type: "textarea" },
        { name: "voice", label: "Stimme", type: "textarea", rows: 2 },
        { name: "look", label: "Look", type: "textarea", rows: 2 },
      ]}
      action={createAccount}
      successMessage="Account angelegt"
      onSuccess={(data) => {
        const id = (data as { id?: string } | null)?.id
        if (id) router.push(`/accounts/${id}`)
      }}
    />
  )
}
