import { ContentBoard } from "@/components/growth/content-board"
import { load, projectScope } from "@/components/growth/server"
import { ScopeLabel } from "@/components/growth/scope"
import { SectionError } from "@/components/growth/status"
import { PageHeader } from "@/components/page-header"
import type { Approval, ContentDetail, ContentItem } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Content" }

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>
}) {
  const sp = await searchParams
  const scope = await projectScope()
  const { project, projects } = scope
  const itemId = /^\d+$/.test(sp.item ?? "") ? Number(sp.item) : null
  const [res, pending, opened] = await Promise.all([
    load<ContentItem[]>("/content", { project: project || undefined }),
    // Ideas waiting for Max: the decision happens in Wartet auf Max, not by moving the status.
    load<Approval[]>("/approvals", {
      status: "pending",
      kind: "content,blog_topic",
      project: project || undefined,
    }),
    // Deep link /content?item=<id> (e.g. from the calendar) opens the drawer.
    itemId !== null
      ? load<ContentDetail>(`/content/${itemId}`)
      : Promise.resolve(null),
  ])

  // content id -> id of its pending approval
  const waiting: Record<number, number> = {}
  const pendingIds = new Set((pending.data ?? []).map((a) => a.id))
  for (const a of pending.data ?? [])
    if (a.refType === "content" && a.refId && /^\d+$/.test(a.refId))
      waiting[Number(a.refId)] ??= a.id
  for (const c of res.data ?? [])
    if (c.approvalId !== null && pendingIds.has(c.approvalId))
      waiting[c.id] ??= c.approvalId
  // A deep-linked item can lie outside the project scope; its detail names its approvals.
  const openPending = opened?.data?.approvals?.find(
    (a) => a.status === "pending"
  )
  if (opened?.data && openPending) waiting[opened.data.id] ??= openPending.id

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Content"
        description={
          <ScopeLabel project={project} name={scope.name}>
            Blogartikel, Landingpages und Store-Texte von der Idee bis live.
          </ScopeLabel>
        }
      />
      {res.error !== null ? (
        <SectionError title="Content nicht geladen" error={res.error} />
      ) : (
        <ContentBoard
          items={res.data}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          project={project}
          waiting={waiting}
          initialOpen={opened?.data ?? null}
        />
      )}
    </div>
  )
}
