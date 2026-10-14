import Link from "next/link"
import { notFound } from "next/navigation"
import {
  getAccount,
  getCharacter,
  listCharacters,
  listFormats,
  listRules,
} from "@/core/catalog"
import { activeFormat, CTA_MEANING } from "@/core/context"
import { listDecisions, listLearnings } from "@/core/knowledge"
import { accountStats } from "@/core/metrics"
import { horizon, nextEntry } from "@/core/plan"
import { listPosts, unregisteredPostDirs } from "@/core/posts"
import { VSError } from "@/core/util"
import { OpenFolderButton } from "@/components/open-folder-button"
import { PageHeader } from "@/components/page-header"
import { RulesCard } from "@/components/rules-card"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { localToday } from "@/lib/dates"
import {
  ACCOUNT_STATUS_LABEL,
  actorLabel,
  CTA_LABEL,
  fmtDate,
  fmtNum,
  fmtPct,
  PLAN_STATUS_LABEL,
} from "@/lib/labels"
import { ctx, mediaUrl } from "@/lib/server"
import { EditAccount, EditCharacter } from "./edit"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  try {
    return { title: getAccount(ctx(), id).name }
  } catch {
    return { title: "Account" }
  }
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const c = ctx()
  let account
  try {
    account = getAccount(c, id)
  } catch (e) {
    if (e instanceof VSError && e.code === "NOT_FOUND") notFound()
    throw e
  }
  const character = account.characterId
    ? getCharacter(c, account.characterId)
    : null
  const formats = listFormats(c)
  const today = localToday()
  const active = activeFormat(c, id, today)
  const accountFormat = formats.find((f) => f.id === account.defaultFormatId)
  const rules = listRules(c, {
    scopeType: "account",
    scopeId: id,
    status: "active",
  })
  const learnings = listLearnings(c, { accountId: id, status: "active" })
  const decisions = listDecisions(c, { accountId: id })
  const stats = accountStats(c, id)
  const posts = listPosts(c, { accountId: id })
  const h = horizon(c, id, today, 21)
  const day = nextEntry(c, id, today)
  const unregistered = unregisteredPostDirs(c, id)
  const statsByPost = new Map(
    stats.posts.filter((p) => p.postId).map((p) => [p.postId!, p])
  )

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title={account.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {account.handle ? `@${account.handle}` : "kein Handle"} ·{" "}
            {account.platform} ·{" "}
            <span className="font-mono text-xs">{account.dir}</span>
            <Badge
              variant={account.status === "active" ? "default" : "outline"}
            >
              {ACCOUNT_STATUS_LABEL[account.status] ?? account.status}
            </Badge>
          </span>
        }
        actions={
          <>
            <OpenFolderButton kind="account" id={account.id} />
            <EditAccount
              account={account}
              formats={formats.map((f) => ({ value: f.id, label: f.name }))}
              characters={listCharacters(c).map((ch) => ({
                value: ch.id,
                label: ch.name,
              }))}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["Modus", account.mode ?? "–"],
          ["CTA-Regel", CTA_LABEL[account.ctaRule] ?? account.ctaRule],
          [
            "Aktives Format",
            active.format ? (
              <Link
                href={`/formats/${active.format.id}`}
                className="underline-offset-4 hover:underline"
              >
                {active.format.name} · Version {active.format.currentVersion}
              </Link>
            ) : (
              "–"
            ),
            active.source === "plan"
              ? `Heute aus dem Planeintrag. Account: ${accountFormat?.name ?? "keins"}`
              : null,
          ],
          [
            "Plan nächste 3 Wochen",
            `${h.filledDays}/${h.days} Tage${h.firstGap ? ` · Lücke ab ${fmtDate(h.firstGap)}` : ""}`,
          ],
        ].map(([k, v, note]) => (
          <Card key={String(k)} size="sm">
            <CardHeader>
              <CardDescription>{k}</CardDescription>
              <CardTitle className="text-base">{v}</CardTitle>
              {note ? (
                <CardDescription className="text-xs">{note}</CardDescription>
              ) : null}
            </CardHeader>
          </Card>
        ))}
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        {CTA_MEANING[account.ctaRule]}
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Charakter</CardTitle>
            <CardDescription>
              {character
                ? character.name
                : "Dieser Account hat keinen KI-Charakter."}
            </CardDescription>
            {character ? (
              <CardAction>
                <EditCharacter character={character} />
              </CardAction>
            ) : null}
          </CardHeader>
          {character ? (
            <CardContent className="flex flex-col gap-4">
              {character.referenceImages.length ? (
                <div className="flex gap-2 overflow-x-auto">
                  {character.referenceImages.map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={src}
                      src={mediaUrl(src)!}
                      alt="Referenzbild"
                      loading="lazy"
                      className="h-40 w-auto rounded-md border object-cover"
                      title={src}
                    />
                  ))}
                </div>
              ) : null}
              {[
                ["Stimme", character.voice],
                ["Look", character.look],
                ["Do", character.dos],
                ["Don't", character.donts],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="text-sm">
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <p className="whitespace-pre-wrap">{v}</p>
                  </div>
                ))}
              {character.persona ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    Persona ({character.persona.length.toLocaleString("de-DE")}{" "}
                    Zeichen)
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto font-sans text-sm whitespace-pre-wrap">
                    {character.persona}
                  </pre>
                </details>
              ) : null}
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Heute</CardTitle>
            <CardDescription>{fmtDate(today)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {day.all.length === 0 ? (
              <p className="text-muted-foreground">
                Kein Eintrag. Der Morgenlauf wählt selbst und trägt das ein.
              </p>
            ) : null}
            {day.all.map((e) => (
              <div
                key={e.id}
                className="flex flex-col gap-1 rounded-md border p-3"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="outline">
                    {PLAN_STATUS_LABEL[e.status] ?? e.status}
                  </Badge>
                  <span className="font-medium">{e.topic}</span>
                </span>
                {e.hook ? (
                  <span className="text-muted-foreground">{e.hook}</span>
                ) : null}
              </div>
            ))}
            {unregistered.length ? (
              <p className="text-xs text-muted-foreground">
                {unregistered.length} Post-Ordner noch nicht registriert:{" "}
                {unregistered.map((d) => d.split("/").pop()).join(", ")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <RulesCard
        scopeType="account"
        scopeId={account.id}
        rules={rules}
        description="Gelten zusätzlich zu den Formatregeln. Von Max oder aus dem Journal übernommen."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Learnings</CardTitle>
            <CardDescription>
              <Link
                href={`/learnings?account=${account.id}`}
                className="underline-offset-4 hover:underline"
              >
                {learnings.length} aktiv
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3 text-sm">
              {learnings.slice(0, 6).map((l) => (
                <li key={l.id} className="flex flex-col gap-0.5">
                  <span>{l.statement}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(l.date)} · {actorLabel(l.actor)}
                  </span>
                </li>
              ))}
              {learnings.length === 0 ? (
                <li className="text-muted-foreground">Noch keine Learnings.</li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Entscheidungen</CardTitle>
            <CardDescription>
              <Link
                href="/decisions"
                className="underline-offset-4 hover:underline"
              >
                Zeitleiste
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3 text-sm">
              {decisions.slice(0, 6).map((d) => (
                <li key={d.id} className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    {d.kind === "pivot" ? "Pivot: " : ""}
                    {d.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(d.date)} · {actorLabel(d.actor)}
                  </span>
                </li>
              ))}
              {decisions.length === 0 ? (
                <li className="text-muted-foreground">
                  Noch keine Entscheidungen.
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Zahlen</CardTitle>
          <CardDescription>
            Median der letzten 10 Posts ab 24 h: {fmtNum(stats.median)} Plays ·
            Gewinner ab {fmtNum(stats.winnerThreshold)} (ab 48 h) · letzter
            Abruf {fmtDate(stats.lastPull)}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Post</TableHead>
                <TableHead>Live seit</TableHead>
                <TableHead className="text-right">Plays</TableHead>
                <TableHead className="text-right">24 h</TableHead>
                <TableHead className="text-right">48 h</TableHead>
                <TableHead className="text-right">7 T</TableHead>
                <TableHead className="text-right">Like-Rate</TableHead>
                <TableHead className="text-right">Save-Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.posts.map((s) => {
                const p = posts.find((x) => x.id === s.postId)
                return (
                  <TableRow key={s.tiktokId}>
                    <TableCell className="max-w-xs">
                      {p ? (
                        <Link
                          href={`/posts/${p.id}`}
                          className="line-clamp-1 whitespace-normal hover:underline"
                        >
                          {s.winner ? "★ " : ""}
                          {p.hook ?? p.slug}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          nicht zugeordnet ({s.tiktokId})
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{fmtDate(s.liveSince)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(s.latest.plays)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(s.plays24)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(s.plays48)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(s.plays7d)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtPct(s.likeRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtPct(s.saveRate)}
                    </TableCell>
                  </TableRow>
                )
              })}
              {stats.posts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    Noch keine Zahlen.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            {posts.length} Posts registriert, davon{" "}
            {posts.filter((p) => p.status === "posted").length} gepostet.{" "}
            {posts.filter((p) => statsByPost.has(p.id)).length} mit Zahlen.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
