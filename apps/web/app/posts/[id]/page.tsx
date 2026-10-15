import { ExternalLink } from "lucide-react"
import Link from "next/link"
import { CopyButton } from "@/components/copy-button"
import { OpenFolderButton } from "@/components/open-folder-button"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
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
import {
  fmtDate,
  fmtDateTime,
  fmtNum,
  fmtPct,
  PLAN_STATUS_LABEL,
  POST_STATUS_LABEL,
} from "@/lib/labels"
import { apiFetch, mediaUrl } from "@/lib/api"
import { orNotFound } from "@/lib/server"
import type { AccountRow, PostShow } from "@/lib/types"
import { PostActions } from "./post-actions"

export const dynamic = "force-dynamic"

const postPath = (id: string) => `/posts/${encodeURIComponent(id)}`

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  try {
    return { title: (await apiFetch<PostShow>(postPath(id))).slug }
  } catch {
    return { title: "Post" }
  }
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const {
    metrics: m,
    planEntry: entry,
    ...post
  } = await orNotFound(apiFetch<PostShow>(postPath(id)))
  const accounts = await apiFetch<AccountRow[]>("/accounts")
  const account = accounts.find((a) => a.id === post.accountId) ?? {
    id: post.accountId,
    name: post.accountId,
  }
  const s = m.stats
  const video = mediaUrl(post.mp4)

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title={post.hook ?? post.slug}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link
              href={`/accounts/${account.id}`}
              className="underline-offset-4 hover:underline"
            >
              {account.name}
            </Link>
            · {fmtDate(post.date)} ·{" "}
            <span className="font-mono text-xs">{post.dir}</span>
            <Badge variant={post.status === "posted" ? "default" : "secondary"}>
              {POST_STATUS_LABEL[post.status] ?? post.status}
            </Badge>
            {s?.winner ? <Badge variant="outline">★ Gewinner</Badge> : null}
          </span>
        }
        actions={
          <>
            <OpenFolderButton kind="post" id={post.id} />
            {post.tiktokUrl ? (
              <a
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={post.tiktokUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink data-icon="inline-start" aria-hidden="true" />
                TikTok
              </a>
            ) : null}
            <PostActions
              id={post.id}
              accountId={post.accountId}
              dir={post.dir}
              posted={post.status === "posted"}
            />
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Slides</CardTitle>
          <CardDescription>
            {post.slideCount
              ? `${post.slideCount} Slides aus ${post.slides[0]?.split("/").slice(0, -1).join("/")}`
              : "Keine gerenderten Slides gefunden"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {post.slides.length ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {post.slides.map((src, i) => (
                <a
                  key={src}
                  href={mediaUrl(src)!}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mediaUrl(src)!}
                    alt={`Slide ${i + 1}`}
                    loading="lazy"
                    className="h-80 w-auto rounded-md border object-contain"
                  />
                  <span className="mt-1 block text-center text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Mit „vibegrowth render --post {post.id}“ rendern.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Caption</CardTitle>
            {post.caption ? (
              <CardAction>
                <CopyButton text={post.caption} label="Caption kopieren" />
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            {post.caption ? (
              <pre className="max-h-96 overflow-auto font-sans text-sm whitespace-pre-wrap">
                {post.caption}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                Keine caption.txt im Ordner.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Zahlen</CardTitle>
            <CardDescription>
              {s
                ? `Stand ${fmtDateTime(s.latest.pulledAt)}, Alter ${Math.round(s.latest.ageH)} h · Account-Median ${fmtNum(m.median)}`
                : "Noch keine Zahlen zu diesem Post."}
            </CardDescription>
          </CardHeader>
          {s ? (
            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                {[
                  ["Plays", s.latest.plays],
                  ["Likes", s.latest.likes],
                  ["Saves", s.latest.saves],
                  ["Komm.", s.latest.comments],
                  ["Shares", s.latest.shares],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md border p-2">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {fmtNum(v as number)}
                    </dd>
                  </div>
                ))}
              </dl>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ["24 h", fmtNum(s.plays24)],
                  ["48 h", fmtNum(s.plays48)],
                  ["7 Tage", fmtNum(s.plays7d)],
                  ["Like-Rate", fmtPct(s.likeRate)],
                  ["Save-Rate", fmtPct(s.saveRate)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="font-medium tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          ) : null}
        </Card>
      </div>

      {video ? (
        <Card>
          <CardHeader>
            <CardTitle>Vorschau-Video</CardTitle>
            <CardDescription className="font-mono text-xs">
              {post.mp4}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <video
              src={video}
              controls
              preload="metadata"
              className="max-h-[32rem] rounded-md border"
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Planeintrag</CardTitle>
            <CardDescription>
              {entry
                ? `${fmtDate(entry.date)} · ${PLAN_STATUS_LABEL[entry.status] ?? entry.status}`
                : "Kein Planeintrag verknüpft."}
            </CardDescription>
          </CardHeader>
          {entry ? (
            <CardContent className="flex flex-col gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Thema</div>
                {entry.topic}
              </div>
              {entry.hookDirection ? (
                <div>
                  <div className="text-xs text-muted-foreground">
                    Hook-Richtung
                  </div>
                  {entry.hookDirection}
                </div>
              ) : null}
              {entry.rationale ? (
                <div>
                  <div className="text-xs text-muted-foreground">
                    Begründung
                  </div>
                  <p className="whitespace-pre-wrap">{entry.rationale}</p>
                </div>
              ) : null}
              <Link
                className="text-sm underline underline-offset-4"
                href={`/calendar?date=${entry.date ?? ""}`}
              >
                Im Kalender zeigen
              </Link>
            </CardContent>
          ) : null}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dateien</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 font-mono text-xs">
            <div>Ordner: {post.dir}</div>
            <div>Kontaktbogen: {post.contactSheet ?? "–"}</div>
            <div>MP4: {post.mp4 ?? "–"}</div>
            <div>ZIP: {post.zip ?? "–"}</div>
            <div>TikTok-ID: {post.tiktokId ?? "–"}</div>
            <div>Geliefert: {fmtDateTime(post.deliveredAt)}</div>
            <div>Gepostet: {fmtDateTime(post.postedAt)}</div>
          </CardContent>
        </Card>
      </div>

      {m.history.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Zahlen-Verlauf</CardTitle>
            <CardDescription>{m.history.length} Abrufe</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Abruf</TableHead>
                  <TableHead className="text-right">Alter</TableHead>
                  <TableHead className="text-right">Plays</TableHead>
                  <TableHead className="text-right">Likes</TableHead>
                  <TableHead className="text-right">Saves</TableHead>
                  <TableHead className="text-right">Komm.</TableHead>
                  <TableHead className="text-right">Shares</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{fmtDateTime(h.pulledAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Math.round(h.ageH)} h
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(h.plays)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(h.likes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(h.saves)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(h.comments)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(h.shares)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
