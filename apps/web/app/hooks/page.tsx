import { HookActions, NewHook } from "@/components/knowledge-forms"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Card,
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
import Link from "next/link"
import { fmtDate } from "@/lib/labels"
import { NoAccounts, ScopedDescription } from "@/components/scope-badge"
import { apiFetch } from "@/lib/api"
import { projectScope } from "@/lib/server"
import type { AccountRow, HookRow, PostRow } from "@/lib/types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Hooks" }

export default async function HooksPage() {
  const [{ projects, project }, everyAccount, allHooks, allPosts] =
    await Promise.all([
      projectScope(),
      apiFetch<AccountRow[]>("/accounts"),
      apiFetch<HookRow[]>("/hooks"),
      apiFetch<PostRow[]>("/posts"),
    ])
  // Hooks belong to an account; the project from the switcher keeps its accounts' hooks.
  const accounts = everyAccount.filter(
    (a) => !project || a.brandId === project.id
  )
  const ids = new Set(accounts.map((a) => a.id))
  const hooks = allHooks.filter((h) => ids.has(h.accountId))
  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? id
  const accountLabel = (id: string) => {
    const a = accounts.find((x) => x.id === id)
    if (!a) return id
    return project ? a.name : `${a.name} · ${projectName(a.brandId)}`
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Hooks"
        description={
          <ScopedDescription project={project}>
            Gewinner (ab 48 h mindestens das Doppelte des Account-Medians) mit
            bis zu drei Varianten. Darunter alle Hooks aus den Posts.
          </ScopedDescription>
        }
        actions={
          accounts.length ? (
            <NewHook
              accounts={accounts.map((a) => ({ value: a.id, label: a.name }))}
            />
          ) : null
        }
      />
      {project && !accounts.length ? (
        <NoAccounts project={project} what="gibt es keine Hooks" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Bibliothek</CardTitle>
            <CardDescription>
              {hooks.length
                ? `${hooks.filter((h) => h.winner).length} Gewinner, ${hooks.length} Hooks`
                : "Noch keine gespeicherten Hooks. Gewinner trägt der Agent per „hook add --winner“ ein."}
            </CardDescription>
          </CardHeader>
          {hooks.length ? (
            <CardContent className="flex flex-col gap-4">
              {hooks.map((h) => (
                <div
                  key={h.id}
                  className="flex flex-col gap-2 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {h.winner ? <Badge>★ Gewinner</Badge> : null}
                        <Badge variant="outline">
                          {accountLabel(h.accountId)}
                        </Badge>
                      </span>
                      <p className="font-medium">{h.text}</p>
                      {h.mechanism ? (
                        <p className="text-sm text-muted-foreground">
                          Mechanismus: {h.mechanism}
                        </p>
                      ) : null}
                    </div>
                    <HookActions
                      id={h.id}
                      winner={h.winner}
                      variants={h.variants.length}
                    />
                  </div>
                  {h.variants.length ? (
                    <ul className="ml-4 flex flex-col gap-1 border-l pl-3 text-sm">
                      {h.variants.map((v) => (
                        <li key={v.id}>{v.text}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </CardContent>
          ) : null}
        </Card>
      )}

      {accounts.map((a) => {
        const posts = allPosts.filter((p) => p.accountId === a.id && p.hook)
        if (!posts.length) return null
        return (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle>{a.name}</CardTitle>
              <CardDescription>
                {project ? "" : `${projectName(a.brandId)} · `}
                {posts.length} produzierte Hooks
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Hook</TableHead>
                    <TableHead>Angle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap">
                        {fmtDate(p.date)}
                      </TableCell>
                      <TableCell className="max-w-xl whitespace-normal">
                        <Link
                          href={`/posts/${p.id}`}
                          className="hover:underline"
                        >
                          {p.hook}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {p.angle ?? "–"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
