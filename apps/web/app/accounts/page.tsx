import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { apiFetch, mediaUrl } from "@/lib/api"
import { ACCOUNT_STATUS_LABEL, CTA_LABEL, fmtNum } from "@/lib/labels"
import { listBrands } from "@/lib/server"
import type {
  AccountRow,
  AccountShow,
  CharacterRow,
  FormatRow,
  Horizon,
  PostRow,
} from "@/lib/types"
import { NewAccount } from "./new-account"

export const dynamic = "force-dynamic"
export const metadata = { title: "Accounts" }

export default async function AccountsPage() {
  const [brands, formats, characters, accounts, posts] = await Promise.all([
    listBrands(),
    apiFetch<FormatRow[]>("/formats"),
    apiFetch<CharacterRow[]>("/characters"),
    apiFetch<AccountRow[]>("/accounts"),
    apiFetch<PostRow[]>("/posts"),
  ])
  // Per account: show (active format, stats) and the 3-week horizon.
  const detail = new Map(
    await Promise.all(
      accounts.map(
        async (a) =>
          [
            a.id,
            await Promise.all([
              apiFetch<AccountShow>(`/accounts/${encodeURIComponent(a.id)}`),
              apiFetch<Horizon>("/plan/horizon", {
                query: { account: a.id, days: 21 },
              }),
            ]),
          ] as const
      )
    )
  )

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Accounts"
        description="Posting-Accounts mit Modus, CTA-Regel, Format und KI-Charakter."
        actions={
          <NewAccount
            brands={brands.map((b) => ({ value: b.id, label: b.name }))}
            formats={formats.map((f) => ({ value: f.id, label: f.name }))}
            characters={characters.map((ch) => ({
              value: ch.id,
              label: ch.name,
            }))}
          />
        }
      />
      {brands.map((b) => (
        <section key={b.id} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {b.name}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts
              .filter((a) => a.brandId === b.id)
              .map((a) => {
                const ch = characters.find((x) => x.id === a.characterId)
                const [show, h] = detail.get(a.id)!
                const stats = show.stats
                const active = show.activeFormat
                const postCount = posts.filter(
                  (p) => p.accountId === a.id
                ).length
                return (
                  <Link
                    key={a.id}
                    href={`/accounts/${a.id}`}
                    prefetch={false}
                    className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Card className="h-full transition-colors hover:bg-accent/40">
                      <CardHeader className="flex flex-row items-center gap-3">
                        <Avatar className="size-10">
                          {ch?.referenceImages[0] ? (
                            <AvatarImage
                              src={mediaUrl(ch.referenceImages[0])!}
                              alt=""
                            />
                          ) : null}
                          <AvatarFallback>{a.name.slice(0, 2)}</AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-col">
                          <CardTitle className="truncate">{a.name}</CardTitle>
                          <CardDescription className="truncate">
                            {a.handle ? `@${a.handle}` : "kein Handle"}
                          </CardDescription>
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3 text-sm">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge
                            variant={
                              a.status === "active" ? "default" : "outline"
                            }
                          >
                            {ACCOUNT_STATUS_LABEL[a.status] ?? a.status}
                          </Badge>
                          {a.mode ? (
                            <Badge variant="secondary">{a.mode}</Badge>
                          ) : null}
                          <Badge variant="outline">
                            {CTA_LABEL[a.ctaRule] ?? a.ctaRule}
                          </Badge>
                          {a.language ? (
                            <Badge variant="outline">{a.language}</Badge>
                          ) : null}
                        </div>
                        <dl className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <dt className="text-muted-foreground">Posts</dt>
                            <dd className="font-medium tabular-nums">
                              {postCount}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              Median Plays
                            </dt>
                            <dd className="font-medium tabular-nums">
                              {fmtNum(stats.median)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">
                              Plan 3 Wochen
                            </dt>
                            <dd className="font-medium tabular-nums">
                              {h.filledDays}/{h.days} Tage
                            </dd>
                          </div>
                        </dl>
                        <p className="truncate text-xs text-muted-foreground">
                          Aktives Format:{" "}
                          {active
                            ? `${active.name} · v${active.version}${active.source === "plan" ? " (heute laut Plan)" : ""}`
                            : "–"}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )
}
