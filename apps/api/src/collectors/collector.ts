import type {
  ChannelKind,
  CollectorResult,
  ConfigSchema,
  SourceCollector,
} from "./sources"

/** Project fields a collector may use (defaults, labels). */
export interface CollectorProject {
  id: string
  name: string
  url: string | null
  kind: string
  language: string | null
  config: Record<string, unknown>
}

export interface CollectorRunOptions {
  days: number
  actor: string
  /** CONTRACT §3 secretsDir; null when not configured. */
  secretsDir: string | null
  /** Override "today" (YYYY-MM-DD). */
  today?: string
}

/**
 * One collector (CONTRACT §7.2). Pure: fetches and returns normalised rows, never touches the DB.
 * The growth CollectService writes the result through the growth services (kpi, search, audit).
 * A new collector is one file in definitions/ plus one entry in registry.ts.
 */
export interface CollectorDefinition {
  id: string
  label: string
  channelKinds: ChannelKind[]
  configSchema: ConfigSchema
  /** Needs files from secretsDir (run fails with a clear message when secretsDir is not set). */
  secrets: boolean
  /** Config values derived from the project, overridden by the stored config. */
  defaults?: (project: CollectorProject) => Record<string, unknown>
  run(
    project: CollectorProject,
    config: Record<string, unknown>,
    options: CollectorRunOptions
  ): Promise<CollectorResult>
}

/** Wraps a ported source from sources/ as a collector definition. */
export function fromSource<C>(
  source: SourceCollector<C>,
  extra: Pick<CollectorDefinition, "secrets" | "defaults">
): CollectorDefinition {
  return {
    id: source.id,
    label: source.label,
    channelKinds: source.channelKinds,
    configSchema: source.configSchema,
    ...extra,
    run: (_project, config, options) =>
      source.collect(config as C, {
        days: options.days,
        secretsDir: options.secretsDir ?? "",
        today: options.today,
      }),
  }
}

/** Placeholder until the source is ported: every run ends with ok:false. */
export function notPorted(
  def: Omit<CollectorDefinition, "run" | "secrets"> & { secrets?: boolean }
): CollectorDefinition {
  return {
    secrets: false,
    ...def,
    run: () => {
      const error = "noch nicht portiert"
      return Promise.resolve({
        ok: false,
        kpi: [],
        summary: `${def.label}: ${error}`,
        stats: {},
        errors: [error],
      })
    },
  }
}

/** Default config key "url" from the project URL (websites). */
export const projectUrl = (project: CollectorProject) =>
  project.url ? { url: project.url } : {}
