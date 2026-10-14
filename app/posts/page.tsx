import Link from "next/link"
import { listAccounts } from "@/core/catalog"
import { accountStats } from "@/core/metrics"
import { listPosts } from "@/core/posts"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
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
  fmtNum,
  fmtPct,
  options,
  POST_STATUS_LABEL,
} from "@/lib/labels"
import { ctx, mediaUrl } from "@/lib/server"
import { UrlSelect } from "@/components/url-select"
import { Suspense } from "react"

export const dynamic = "force-dynamic"
export const metadata = { title: "Posts" }

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; status?: string }>
}) {
  const sp = await searchParams
  const c = ctx()
  const accounts = listAccounts(c)
  const name = Object.fromEntries(accounts.map((a) => [a.id, a.name]))
  const posts = listPosts(c, {
    accountId: sp.account || undefined,
    status: sp.status || undefined,
  })
  const stats = new Map(
    accounts.flatMap((a) =>
      accountStats(c, a.id)
        .posts.filter((p) => p.postId)
        .map((p) => [p.postId!, p] as const)
    )
  )

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Posts"
        description="Alle Post-Ordner mit Hook, Slides und Zahlen. Mediendateien bleiben, wo sie sind."
        actions={
          <Suspense>
            <UrlSelect
              param="account"
              label="Account"
              allLabel="Alle Accounts"
              value={sp.account ?? ""}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            />
            <UrlSelect
              param="status"
              label="Status"
              allLabel="Alle Status"
              value={sp.status ?? ""}
              options={options(POST_STATUS_LABEL)}
            />
          </Suspense>
        }
      />
      {posts.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Keine Posts</EmptyTitle>
            <EmptyDescription>
              Posts entstehen per „vibeshorts post register“ oder über den
              Import.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Slide 1</TableHead>
                <TableHead>Hook</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Plays</TableHead>
                <TableHead className="text-right">Saves</TableHead>
                <TableHead className="text-right">Save-Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((p) => {
                const s = stats.get(p.id)
                const thumb = mediaUrl(p.slides[0])
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumb}
                          alt=""
                          loading="lazy"
                          className="h-14 w-10 rounded object-cover"
                        />
                      ) : (
                        <div className="h-14 w-10 rounded bg-muted" />
                      )}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <Link
                        href={`/posts/${p.id}`}
                        prefetch={false}
                        className="line-clamp-2 font-medium whitespace-normal hover:underline"
                      >
                        {p.hook ?? p.slug}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {p.slug}
                      </span>
                    </TableCell>
                    <TableCell>{name[p.accountId] ?? p.accountId}</TableCell>
                    <TableCell>{fmtDate(p.postedAt ?? p.date)}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1">
                        <Badge
                          variant={
                            p.status === "posted"
                              ? "default"
                              : p.status === "delivered"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {POST_STATUS_LABEL[p.status] ?? p.status}
                        </Badge>
                        {s?.winner ? (
                          <Badge variant="outline">★ Gewinner</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(s?.latest.plays)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(s?.latest.saves)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtPct(s?.saveRate)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
