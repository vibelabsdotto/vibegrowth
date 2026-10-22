import { Inbox } from "lucide-react"
import { FeatureRequestList } from "@/components/app-inbox/feature-request-list"
import { ReviewList } from "@/components/app-inbox/review-list"
import { inboxKey, replyType } from "@/components/growth/approval-app"
import {
  ApprovalInbox,
  type ApprovalContext,
} from "@/components/growth/approval-inbox"
import { CategoryTabs } from "@/components/growth/category"
import { APPROVAL_KIND_LABEL } from "@/components/growth/format"
import { load, projectScope, requestTime } from "@/components/growth/server"
import { ScopeLabel, ScopeLink } from "@/components/growth/scope"
import { SectionError } from "@/components/growth/status"
import { UrlFilter } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import { TestingTasks } from "@/components/growth/testing-tasks"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { parseCategory } from "@/lib/categories"
import type {
  AppInbox,
  Approval,
  BacklogItem,
  ContentItem,
  InboxFeatureRequest,
  InboxItem,
  InboxReview,
  ReplyPayload,
  TaskPayload,
} from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Wartet auf Max" }

const DECIDED = "approved,rejected,changes_requested,withdrawn"

type Search = {
  kind?: string
  category?: string
  item?: string
  task?: string
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const sp = await searchParams
  const category = parseCategory(sp.category)
  const scope = await projectScope()
  const { project, projects } = scope
  const filter = {
    project: project || undefined,
    kind: sp.kind,
    category: category || undefined,
  }
  const itemId = Number(sp.item)
  const showInbox = !sp.kind && (!category || category === "app")
  const taskId = Number(sp.task)
  const showTasks = !sp.kind
  const [res, decidedRes, pendingRes, openRes, testingRes, waitingRes] =
    await Promise.all([
      load<Approval[]>("/approvals", {
        ...filter,
        status: "pending",
        waiting: "exclude",
      }),
      load<Approval[]>("/approvals", { ...filter, status: DECIDED, limit: 15 }),
      // The note below says what the project filter hides.
      project
        ? load<Approval[]>("/approvals", {
            status: "pending",
            waiting: "exclude",
          })
        : null,
      // Inbox items no agent has suggested anything for yet: they must not get lost.
      showInbox
        ? load<AppInbox>("/app/inbox", {
            project: project || undefined,
            state: "open",
            limit: 500,
          })
        : null,
      // Tasks an agent delivered: Max says "Passt" or "Klappt nicht".
      showTasks
        ? load<BacklogItem[]>("/backlog", {
            project: project || undefined,
            category: category || undefined,
            status: "question,testing",
          })
        : null,
      // Replies held back until their tasks are done: only counted here.
      load<Approval[]>("/approvals", {
        ...filter,
        status: "pending",
        waiting: "only",
      }),
    ])
  const waitingCount = waitingRes.data?.length ?? 0
  const testing = testingRes?.data ?? []
  const linkedTask =
    Number.isInteger(taskId) &&
    taskId > 0 &&
    !testing.some((t) => t.id === taskId)
      ? (await load<BacklogItem>(`/backlog/${taskId}`)).data
      : null
  const shownTasks = linkedTask ? [...testing, linkedTask] : testing
  const taskSources: Record<string, InboxItem> = {}
  if (shownTasks.some((t) => t.sources?.length)) {
    const inbox = await load<AppInbox>("/app/inbox", {
      project: project || undefined,
      limit: 5000,
    })
    const want = new Set(
      shownTasks.flatMap((t) =>
        (t.sources ?? []).map((src) => `${t.projectId}|${src.type}|${src.id}`)
      )
    )
    for (const i of inbox.data?.items ?? [])
      if (want.has(`${i.projectId}|${i.type}|${i.itemId}`))
        taskSources[`${i.type}|${i.itemId}`] = i
  }
  const openItems = (openRes?.data?.items ?? []).filter(
    (i) => i.state === "open"
  )
  const openRequests = openItems.filter(
    (i): i is InboxFeatureRequest => i.type === "feature_request"
  )
  const openReviews = openItems.filter(
    (i): i is InboxReview => i.type === "review"
  )
  const rows = res.data ?? []
  const decided = decidedRes.data ?? []
  // Deep link (?item=<id>) to an approval outside the current filter or list.
  const known = [...rows, ...decided].some((a) => a.id === itemId)
  const linked =
    Number.isInteger(itemId) && itemId > 0 && !known
      ? (await load<Approval>(`/approvals/${itemId}`)).data
      : null
  const all = linked ? [...rows, ...decided, linked] : [...rows, ...decided]
  const elsewhere = (pendingRes?.data ?? []).filter(
    (a) => a.projectId !== project
  ).length
  const contexts = await loadContexts(all, project)
  const names = Object.fromEntries(projects.map((p) => [p.id, p.name]))
  const params = { kind: sp.kind, category: category || undefined }

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Wartet auf Max"
        description={
          <ScopeLabel project={project} name={scope.name}>
            Alles, was du entscheiden musst. Ein Klick öffnet den Vorschlag,
            deine Notiz geht an den Agent.
          </ScopeLabel>
        }
      />
      {elsewhere > 0 ? (
        <Alert role="status">
          <Inbox aria-hidden="true" />
          <AlertDescription>
            <p>
              {elsewhere === 1
                ? "1 weitere offene Freigabe"
                : `${elsewhere} weitere offene Freigaben`}{" "}
              in anderen Projekten.{" "}
              <ScopeLink path="/approvals" project="">
                Alle Projekte anzeigen
              </ScopeLink>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {testing.length || linkedTask ? (
        <section
          aria-labelledby="approvals-testing"
          className="flex flex-col gap-3"
        >
          {testing.length ? (
            <div className="flex flex-col gap-1">
              <h2 id="approvals-testing" className="text-base font-medium">
                Aufgaben für dich
              </h2>
              <p className="text-sm text-muted-foreground">
                Zum Testen: Bericht, Testschritte und Screenshots im Sheet, dann
                „Passt“ oder „Klappt nicht“ mit Grund. Rückfrage: Der Agent
                braucht eine Entscheidung, deine Antwort schickt die Aufgabe
                zurück an ihn.
              </p>
            </div>
          ) : null}
          <TestingTasks
            items={testing}
            linked={linkedTask}
            projectNames={names}
            sourceItems={taskSources}
          />
        </section>
      ) : null}
      <CategoryTabs value={category} params={params} />
      <div className="flex flex-wrap items-center gap-2">
        <UrlFilter
          param="kind"
          value={sp.kind ?? ""}
          params={params}
          label="Art"
          allLabel="Alle Arten"
          options={Object.entries(APPROVAL_KIND_LABEL).map(([value, l]) => ({
            value,
            label: l,
          }))}
        />
        {res.data ? (
          <span className="text-sm text-muted-foreground tabular-nums sm:ml-auto">
            {rows.length} offen
          </span>
        ) : null}
      </div>

      {res.error !== null ? (
        <SectionError title="Freigaben nicht geladen" error={res.error} />
      ) : (
        <ApprovalInbox
          pending={rows}
          decided={decided}
          linked={linked}
          contexts={contexts}
          projectNames={names}
          showProject={!project}
          emptyText={
            project
              ? `Für ${scope.name} wartet nichts auf dich.`
              : sp.kind || category
                ? "Für diese Filter wartet nichts auf dich."
                : "Sobald ein Agent etwas zur Freigabe stellt, erscheint es hier."
          }
        />
      )}

      {waitingCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {waitingCount === 1
            ? "1 Antwort wartet"
            : `${waitingCount} Antworten warten`}{" "}
          auf Aufgaben. Sind sie erledigt, schlägt der Agent hier eine neue
          Antwort vor.
        </p>
      ) : null}

      {openItems.length ? (
        <section
          aria-labelledby="approvals-open-inbox"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <h2 id="approvals-open-inbox" className="text-base font-medium">
              Noch ohne Vorschlag
            </h2>
            <p className="text-sm text-muted-foreground">
              Feature Requests und Bewertungen, zu denen der Agent noch nichts
              vorgeschlagen hat. Du kannst selbst antworten, eine Aufgabe
              erstellen oder sie als erledigt markieren.
            </p>
          </div>
          {openRequests.length ? (
            <FeatureRequestList
              items={openRequests}
              visible={openRequests.map((i) => i.itemId)}
              projectNames={project ? null : names}
              now={requestTime()}
              param="inbox"
            />
          ) : null}
          {openReviews.length ? (
            <ReviewList
              items={openReviews}
              visible={openReviews.map((i) => i.itemId)}
              projectNames={project ? null : names}
              param="inbox"
            />
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

/**
 * What the drawer shows next to a suggestion: the review or Featurama thread a reply
 * answers, the inbox items behind a task, and the content item of a content idea.
 */
async function loadContexts(rows: Approval[], project: string) {
  const out: Record<number, ApprovalContext> = {}
  const app = rows.filter((a) => a.kind === "reply" || a.kind === "task")
  const content = rows.filter((a) => a.refType === "content" && a.refId)
  const [inbox, items] = await Promise.all([
    app.length
      ? load<AppInbox>("/app/inbox", {
          project: project || undefined,
          limit: 5000,
        })
      : null,
    content.length
      ? load<ContentItem[]>("/content", { project: project || undefined })
      : null,
  ])
  const byKey = new Map<string, InboxItem>()
  for (const i of inbox?.data?.items ?? [])
    byKey.set(inboxKey(i.projectId, i.type, i.itemId), i)
  const contentById = new Map((items?.data ?? []).map((c) => [String(c.id), c]))
  for (const a of app) {
    if (a.kind === "reply") {
      const p = (a.payload ?? {}) as ReplyPayload
      out[a.id] = {
        item: byKey.get(inboxKey(a.projectId, replyType(p.target), p.itemId)),
      }
    } else {
      const p = (a.payload ?? {}) as TaskPayload
      const sources: Record<string, InboxItem> = {}
      for (const s of p.sources ?? []) {
        const item = byKey.get(inboxKey(a.projectId, s.type, s.id))
        if (item) sources[`${s.type}|${s.id}`] = item
      }
      out[a.id] = { sources }
    }
  }
  for (const a of content) {
    const c = contentById.get(a.refId ?? "")
    if (c) out[a.id] = { ...out[a.id], content: c }
  }
  return out
}
