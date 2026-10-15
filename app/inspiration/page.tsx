import { ExternalLink } from "lucide-react"
import { Suspense } from "react"
import { listAccounts } from "@/core/catalog"
import { listInspirations } from "@/core/knowledge"
import { EditInspiration, NewInspiration } from "@/components/knowledge-forms"
import { OpenFolderButton } from "@/components/open-folder-button"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { UrlSelect } from "@/components/url-select"
import Link from "next/link"
import {
  actorLabel,
  fmtDate,
  INSPO_STATUS_LABEL,
  INSPO_TYPE_LABEL,
  options,
} from "@/lib/labels"
import { ctx, mediaUrl } from "@/lib/server"

export const dynamic = "force-dynamic"
export const metadata = { title: "Inspiration" }

export default async function InspirationPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; status?: string; type?: string }>
}) {
  const sp = await searchParams
  const c = ctx()
  const accounts = listAccounts(c)
  const accOpts = accounts.map((a) => ({ value: a.id, label: a.name }))
  const items = listInspirations(c, {
    accountId: sp.account || undefined,
    status: sp.status || undefined,
    type: sp.type || undefined,
  })

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Inspiration"
        description="Links, Trends und analysierte Referenzen. Daraus geplante Einträge stehen am Link."
        actions={
          <>
            <Suspense>
              <UrlSelect
                param="account"
                label="Account"
                allLabel="Alle Accounts"
                value={sp.account ?? ""}
                options={accOpts}
              />
              <UrlSelect
                param="status"
                label="Status"
                allLabel="Alle Status"
                value={sp.status ?? ""}
                options={options(INSPO_STATUS_LABEL)}
              />
              <UrlSelect
                param="type"
                label="Typ"
                allLabel="Alle Typen"
                value={sp.type ?? ""}
                options={options(INSPO_TYPE_LABEL)}
              />
            </Suspense>
            <NewInspiration accounts={accOpts} />
          </>
        }
      />
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nichts gespeichert</EmptyTitle>
            <EmptyDescription>
              Links per „vibegrowth inspo add &lt;url&gt;“ oder über „Link
              speichern“.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => {
            const thumb = mediaUrl(i.files[0])
            return (
              <Card key={i.id} size="sm" className="overflow-hidden">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt=""
                    loading="lazy"
                    className="-mt-3 h-40 w-full border-b object-cover"
                  />
                ) : null}
                <CardContent className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={i.status === "adapted" ? "default" : "outline"}
                    >
                      {INSPO_STATUS_LABEL[i.status] ?? i.status}
                    </Badge>
                    <Badge variant="secondary">
                      {INSPO_TYPE_LABEL[i.type] ?? i.type}
                    </Badge>
                    {i.accountId ? (
                      <Badge variant="outline">
                        {accounts.find((a) => a.id === i.accountId)?.name}
                      </Badge>
                    ) : null}
                    {i.tags.map((t) => (
                      <Badge key={t} variant="outline">
                        #{t}
                      </Badge>
                    ))}
                  </div>
                  <a
                    href={i.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-sm font-medium break-all hover:underline"
                  >
                    {i.note ?? i.url}
                    <ExternalLink
                      className="size-3 shrink-0"
                      aria-hidden="true"
                    />
                  </a>
                  {i.note ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {i.url}
                    </span>
                  ) : null}
                  {i.planEntries.length ? (
                    <div className="text-xs">
                      <span className="text-muted-foreground">
                        Daraus geplant:{" "}
                      </span>
                      {i.planEntries.map((e, n) => (
                        <span key={e.id}>
                          {n ? ", " : ""}
                          <Link
                            href={`/?date=${e.date ?? ""}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {fmtDate(e.date)} {e.topic}
                          </Link>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(i.createdAt)} · {actorLabel(i.actor)}
                    </span>
                    <div className="flex gap-1">
                      {i.briefingPath || i.files.length ? (
                        <OpenFolderButton
                          kind="inspo"
                          id={i.id}
                          label="Ordner"
                        />
                      ) : null}
                      <EditInspiration item={i} accounts={accOpts} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
