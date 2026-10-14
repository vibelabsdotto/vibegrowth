"use client"

import { saveAccount, saveCharacter } from "@/app/actions"
import { FormDrawer } from "@/components/form-drawer"
import { Button } from "@/components/ui/button"
import { ACCOUNT_STATUS_LABEL, CTA_LABEL, options } from "@/lib/labels"
import type { AccountRow } from "@/lib/types"

type Opt = { value: string; label: string }

export function EditAccount({
  account,
  formats,
  characters,
}: {
  account: AccountRow
  formats: Opt[]
  characters: Opt[]
}) {
  return (
    <FormDrawer
      title={`${account.name} bearbeiten`}
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Bearbeiten
        </Button>
      )}
      initial={{
        name: account.name,
        handle: account.handle ?? "",
        language: account.language ?? "",
        status: account.status,
        mode: account.mode ?? "",
        formatId: account.defaultFormatId ?? "",
        ctaRule: account.ctaRule,
        postsPerDay: String(account.postsPerDay),
        characterId: account.characterId ?? "",
        notes: account.notes ?? "",
      }}
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "handle", label: "Plattform-Handle" },
        { name: "language", label: "Sprache" },
        {
          name: "status",
          label: "Status",
          type: "select",
          options: options(ACCOUNT_STATUS_LABEL),
        },
        {
          name: "mode",
          label: "Modus",
          description: "z. B. autopilot, manual, test",
        },
        {
          name: "formatId",
          label: "Standardformat",
          type: "select",
          options: [{ value: "", label: "–" }, ...formats],
        },
        {
          name: "ctaRule",
          label: "CTA-Regel",
          type: "select",
          options: options(CTA_LABEL),
          description:
            "Engagement (Fragen, „send this to“, „save this“) zählt nicht als CTA. Den App-CTA setzt Max.",
        },
        { name: "postsPerDay", label: "Posts pro Tag", type: "number" },
        {
          name: "characterId",
          label: "Charakter",
          type: "select",
          options: [{ value: "", label: "keiner" }, ...characters],
        },
        { name: "notes", label: "Notizen", type: "textarea" },
      ]}
      action={(v) => saveAccount(account.id, v)}
      successMessage="Account gespeichert"
    />
  )
}

export function EditCharacter({
  character,
}: {
  character: {
    id: string
    name: string
    persona: string | null
    voice: string | null
    look: string | null
    dos: string | null
    donts: string | null
  }
}) {
  return (
    <FormDrawer
      title={`Charakter ${character.name}`}
      width="sm:w-[min(54rem,calc(100vw-3rem))]"
      trigger={(open) => (
        <Button size="sm" variant="outline" onClick={open}>
          Bearbeiten
        </Button>
      )}
      initial={{
        name: character.name,
        persona: character.persona ?? "",
        voice: character.voice ?? "",
        look: character.look ?? "",
        dos: character.dos ?? "",
        donts: character.donts ?? "",
      }}
      fields={[
        { name: "name", label: "Name", required: true },
        { name: "voice", label: "Stimme", type: "textarea", rows: 2 },
        { name: "look", label: "Look", type: "textarea", rows: 3 },
        { name: "dos", label: "Do", type: "textarea", rows: 3 },
        { name: "donts", label: "Don't", type: "textarea", rows: 3 },
        { name: "persona", label: "Persona", type: "textarea", rows: 14 },
      ]}
      action={(v) => saveCharacter(character.id, v)}
      successMessage="Charakter gespeichert"
    />
  )
}
