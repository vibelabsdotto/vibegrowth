import { Cmd } from "@/components/strategies/cmd"
import { NewFormat } from "@/app/formats/new-format"
import { CategoryTabs } from "@/components/growth/category"
import { load, projectScope } from "@/components/growth/server"
import { ScopeLabel } from "@/components/growth/scope"
import { EmptyState, SectionError } from "@/components/growth/status"
import { UrlToggle } from "@/components/growth/url-filter"
import { PageHeader } from "@/components/page-header"
import { NewStrategy } from "@/components/strategies/strategy-forms"
import { FormatList, StrategyList } from "@/components/strategies/strategy-list"
import { CATEGORY_LABEL, parseCategory, type Category } from "@/lib/categories"
import type { Strategy } from "@/lib/growth-types"

export const dynamic = "force-dynamic"
export const metadata = { title: "Strategien" }

/** Section order on the page; shortform last because it lists formats. */
const SECTIONS: Category[] = ["web", "app", "general", "shortform"]

const DESCRIPTION =
  "Wie ein Agent je Bereich vorgeht. Shortform-Strategien sind die Formate."

export default async function StrategiesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; status?: string }>
}) {
  const sp = await searchParams
  const category = parseCategory(sp.category)
  const status = sp.status === "active" ? "active" : ""
  const scope = await projectScope()
  const { project, projects } = scope
  const res = await load<Strategy[]>("/strategies", {
    project: project || undefined,
    category: category || undefined,
    status: status || undefined,
  })

  const names = new Map(projects.map((p) => [p.id, p.name]))
  for (const p of scope.projectsRes.data ?? [])
    if (!names.has(p.id)) names.set(p.id, p.name)
  const projectName = (id: string) => names.get(id) ?? id
  const options = projects.map((p) => ({ value: p.id, label: p.name }))
  const items = [...(res.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, "de")
  )
  const sections = category ? [category] : SECTIONS
  const params = {
    category: category || undefined,
    status: status || undefined,
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <PageHeader
        title="Strategien"
        description={
          <ScopeLabel project={project} name={scope.name}>
            {DESCRIPTION}
            {project ? " Dazu die Strategien für alle Projekte." : ""}
          </ScopeLabel>
        }
        actions={
          <NewStrategy
            projects={options}
            project={project}
            category={category}
          />
        }
      />

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <CategoryTabs value={category} params={params} />
        <UrlToggle
          param="status"
          value={status || "all"}
          params={params}
          label="Status"
          options={[
            { value: "all", label: "Alle" },
            { value: "active", label: "Aktiv" },
          ]}
        />
      </div>

      {res.error !== null ? (
        <SectionError title="Strategien nicht geladen" error={res.error} />
      ) : (
        sections.map((c) => {
          const rows = items.filter((s) => s.category === c)
          const formats = c === "shortform"
          return (
            <section
              key={c}
              aria-labelledby={`section-${c}`}
              className="flex min-w-0 flex-col gap-3"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h2 id={`section-${c}`} className="text-base font-semibold">
                  {CATEGORY_LABEL[c]}
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {rows.length}
                  </span>
                </h2>
                {formats ? (
                  <NewFormat brands={options} brand={project} />
                ) : null}
              </div>
              {rows.length === 0 ? (
                <EmptyState
                  title={
                    formats
                      ? status
                        ? "Keine aktiven Formate"
                        : "Keine Formate"
                      : `Keine ${status ? "aktiven " : ""}Strategien für ${CATEGORY_LABEL[c]}`
                  }
                  description={
                    formats ? (
                      <>
                        Formate legt ein Agent mit{" "}
                        <Cmd>vibegrowth formats add</Cmd> an, oder hier über
                        „Format anlegen“.
                      </>
                    ) : (
                      <>
                        Ein Agent legt sie mit{" "}
                        <Cmd>
                          vibegrowth strategies add --category {c} --name …
                        </Cmd>{" "}
                        an, oder hier über „Strategie anlegen“.
                      </>
                    )
                  }
                />
              ) : formats ? (
                <FormatList items={rows} projectName={projectName} />
              ) : (
                <StrategyList items={rows} projectName={projectName} />
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
