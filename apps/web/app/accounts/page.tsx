import Link from "next/link"
import {
  listAccounts,
  listBrands,
  listCharacters,
  listFormats,
} from "@/core/catalog"
import { activeFormat } from "@/core/context"
import { accountStats } from "@/core/metrics"
import { horizon } from "@/core/plan"
import { listPosts } from "@/core/posts"
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
import { localToday } from "@/lib/dates"
import { ACCOUNT_STATUS_LABEL, CTA_LABEL, fmtNum } from "@/lib/labels"
import { ctx, mediaUrl } from "@/lib/server"
import { NewAccount } from "./new-account"

export const dynamic = "force-dynamic"
export const metadata = { title: "Accounts" }

export default function AccountsPage() {
  const c = ctx()
  const brands = listBrands(c)
  const formats = listFormats(c)
  const characters = listCharacters(c)
  const accounts = listAccounts(c)
  const today = localToday()

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
                const stats = accountStats(c, a.id)
                const h = horizon(c, a.id, today, 21)
                const active = activeFormat(c, a.id, today)
                const postCount = listPosts(c, { accountId: a.id }).length
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
                          {active.format
                            ? `${active.format.name} · v${active.format.currentVersion}${active.source === "plan" ? " (heute laut Plan)" : ""}`
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
