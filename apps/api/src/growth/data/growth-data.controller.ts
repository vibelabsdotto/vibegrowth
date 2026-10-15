import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common"
import { Actor } from "../../common/actor.decorator"
import { VGError } from "../../core/util"
import { AuditService } from "./audit.service"
import { ChannelsService } from "./channels.service"
import { CollectService } from "./collect.service"
import { CollectorsService } from "./collectors.service"
import { FunnelService } from "./funnel.service"
import { KpiService, normaliseDims } from "./kpi.service"
import { ProjectsService } from "./projects.service"
import { SearchService } from "./search.service"
import { queryBool, queryDate, queryInt } from "./validate"

type Q = Record<string, string | string[] | undefined>

/** First value of a query parameter (repeated parameters: the first wins). */
function q(query: Q, key: string): string | undefined {
  const v = query[key]
  return Array.isArray(v) ? v[0] : v
}

function required(query: Q, key: string): string {
  const v = q(query, key)?.trim()
  if (!v) throw new VGError("INVALID", `${key} fehlt`)
  return v
}

function optional(query: Q, key: string): string | undefined {
  return q(query, key)?.trim() || undefined
}

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Query() query: Q) {
    return this.projects.list({ status: optional(query, "status") })
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.projects.show(id)
  }

  @Post()
  create(@Body() body: unknown, @Actor() actor: string) {
    return this.projects.create(body, actor)
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Actor() actor: string
  ) {
    return this.projects.update(id, body, actor)
  }
}

@Controller("channels")
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  list(@Query() query: Q) {
    return this.channels.list(optional(query, "project"))
  }

  @Post()
  create(@Body() body: unknown, @Actor() actor: string) {
    return this.channels.create(body, actor)
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Actor() actor: string
  ) {
    return this.channels.update(id, body, actor)
  }
}

@Controller()
export class CollectorsController {
  constructor(
    private readonly collectors: CollectorsService,
    private readonly collect: CollectService
  ) {}

  @Get("collectors")
  list(@Query() query: Q) {
    return this.collectors.list(optional(query, "project"))
  }

  @Put("collectors/:project/:collector")
  set(
    @Param("project") project: string,
    @Param("collector") collector: string,
    @Body() body: unknown,
    @Actor() actor: string
  ) {
    return this.collectors.set(project, collector, body, actor)
  }

  @Get("collector-runs")
  runs(@Query() query: Q) {
    const ok = optional(query, "ok")
    return this.collectors.runs({
      project: optional(query, "project"),
      collector: optional(query, "collector"),
      limit: queryInt(q(query, "limit"), "limit", 50, 1000),
      ok: ok === undefined ? undefined : queryBool(ok),
    })
  }

  @Post("collect")
  @HttpCode(200)
  run(@Body() body: unknown, @Actor() actor: string) {
    return this.collect.collect(body, actor)
  }

  @Post("health-check")
  @HttpCode(200)
  health(@Body() body: unknown, @Actor() actor: string) {
    return this.collect.healthCheck(body, actor)
  }

  @Post("audit/run")
  @HttpCode(200)
  audit(@Body() body: unknown, @Actor() actor: string) {
    return this.collect.auditRun(body, actor)
  }
}

@Controller()
export class MetricsDataController {
  constructor(
    private readonly kpi: KpiService,
    private readonly search: SearchService,
    private readonly audit: AuditService,
    private readonly funnel: FunnelService
  ) {}

  @Get("kpi")
  list(@Query() query: Q) {
    const dims = q(query, "dims")
    return this.kpi.list({
      project: required(query, "project"),
      source: optional(query, "source"),
      metric: optional(query, "metric"),
      from: queryDate(q(query, "from"), "from"),
      to: queryDate(q(query, "to"), "to"),
      dims:
        dims === undefined
          ? undefined
          : dims === "" || dims === "total"
            ? ""
            : normaliseDims(dims),
      channel: optional(query, "channel"),
    })
  }

  @Post("kpi/ingest")
  @HttpCode(200)
  ingest(@Body() body: unknown, @Actor() actor: string) {
    return this.kpi.ingest(body, actor)
  }

  @Get("search")
  searchQuery(@Query() query: Q) {
    return this.search.query({
      project: required(query, "project"),
      source: optional(query, "source"),
      days: queryInt(q(query, "days"), "days", 28),
      end: queryDate(q(query, "end"), "end"),
      page: q(query, "page"),
      opportunities: queryBool(q(query, "opportunities")),
      limit: queryInt(q(query, "limit"), "limit", 500, 50_000),
    })
  }

  @Get("audit")
  auditShow(@Query() query: Q) {
    return this.audit.show(
      required(query, "project"),
      queryBool(q(query, "diff"))
    )
  }

  @Get("funnel")
  funnelShow(@Query() query: Q) {
    return this.funnel.funnel(
      required(query, "project"),
      queryInt(q(query, "days"), "days", 7, 365),
      queryDate(q(query, "end"), "end")
    )
  }
}
