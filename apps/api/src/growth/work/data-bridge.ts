import { Injectable, type Type } from "@nestjs/common"
import { ModuleRef } from "@nestjs/core"
import { and, desc, eq } from "drizzle-orm"
import { collectorRuns, collectors } from "../../core/schema"
import { DatabaseService } from "../../database/database.service"
import { AuditService } from "../data/audit.service"
import { ChannelsService } from "../data/channels.service"
import { CollectorsService } from "../data/collectors.service"
import { FunnelService, type Funnel } from "../data/funnel.service"
import { KpiService } from "../data/kpi.service"
import { SearchService } from "../data/search.service"

/**
 * Read access to the growth-data lane (funnel, channels, collectors, search, audit) for overview and
 * context. Resolves the providers lazily from the whole app (strict: false), so GrowthWorkModule needs
 * no import of GrowthDataModule (the collectors there write through GeoService/StoreService of this
 * module, an import both ways would be a cycle). Stateless services without registration are created
 * directly on the shared DatabaseService.
 */
@Injectable()
export class DataBridge {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly database: DatabaseService
  ) {}

  private resolve<T>(cls: Type<T>): T | null {
    try {
      return this.moduleRef.get(cls, { strict: false })
    } catch {
      return null
    }
  }

  funnel(projectId: string, days: number, end?: string): Funnel {
    const svc =
      this.resolve(FunnelService) ??
      new FunnelService(
        this.database,
        this.resolve(KpiService) ?? new KpiService(this.database)
      )
    return svc.funnel(projectId, days, end)
  }

  channels(projectId: string) {
    return (
      this.resolve(ChannelsService) ?? new ChannelsService(this.database)
    ).list(projectId)
  }

  /** Every collector type with enabled flag and last run; without registered CollectorsService only the configured ones. */
  collectors(projectId: string) {
    const svc = this.resolve(CollectorsService)
    if (svc) return svc.summary(projectId)
    const ctx = this.database.ctx
    return ctx.db
      .select()
      .from(collectors)
      .where(eq(collectors.projectId, projectId))
      .all()
      .map((c) => {
        const r = ctx.db
          .select()
          .from(collectorRuns)
          .where(
            and(
              eq(collectorRuns.projectId, projectId),
              eq(collectorRuns.collector, c.collector)
            )
          )
          .orderBy(desc(collectorRuns.startedAt), desc(collectorRuns.id))
          .limit(1)
          .get()
        return {
          collector: c.collector,
          label: c.collector,
          enabled: c.enabled,
          lastRun: r
            ? {
                id: r.id,
                startedAt: r.startedAt,
                finishedAt: r.finishedAt,
                ok: r.ok,
                summary: r.summary,
                error: r.error,
              }
            : null,
        }
      })
  }

  /** Top search opportunities (position 4–20 with impressions) of the last 28 days. */
  opportunities(projectId: string, end: string, limit = 20) {
    return (
      this.resolve(SearchService) ?? new SearchService(this.database)
    ).query({
      project: projectId,
      days: 28,
      end,
      opportunities: true,
      limit,
    }).rows
  }

  audit(projectId: string) {
    return (
      this.resolve(AuditService) ?? new AuditService(this.database)
    ).latest(projectId)
  }
}
