import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common"
import { Actor } from "../../common/actor.decorator"
import { VGError } from "../../core/util"
import { CollectorActionsService } from "./collector-actions.service"
import { queryBool } from "./validate"

type Q = Record<string, string | string[] | undefined>

function required(query: Q, key: string): string {
  const raw = query[key]
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  if (!v) throw new VGError("INVALID", `${key} fehlt`)
  return v
}

/** Repeated or comma-separated query values. */
function many(query: Q, key: string): string[] {
  const raw = query[key]
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]
  return list
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean)
}

/** Actions from growth.py: geo run, sitemap/bing submit, keywords, GA4 app setup, store check. */
@Controller()
export class CollectorActionsController {
  constructor(private readonly actions: CollectorActionsService) {}

  @Post("geo/run")
  @HttpCode(200)
  geoRun(@Body() body: unknown, @Actor() actor: string) {
    return this.actions.geoRun(body, actor)
  }

  @Post("search/sitemap-submit")
  @HttpCode(200)
  sitemapSubmit(@Body() body: unknown, @Actor() actor: string) {
    return this.actions.sitemapSubmit(body, actor)
  }

  @Post("search/bing-submit")
  @HttpCode(200)
  bingSubmit(@Body() body: unknown, @Actor() actor: string) {
    return this.actions.bingSubmit(body, actor)
  }

  @Get("search/keywords")
  keywords(@Query() query: Q) {
    const fast = query.fast
    return this.actions.keywords(
      required(query, "project"),
      many(query, "seed"),
      fast === undefined
        ? false
        : queryBool(Array.isArray(fast) ? fast[0] : fast)
    )
  }

  @Post("collectors/app/setup")
  @HttpCode(200)
  appSetup(@Body() body: unknown, @Actor() actor: string) {
    return this.actions.appSetup(body, actor)
  }

  @Get("collectors/stores/check")
  storesCheck(@Query() query: Q) {
    return this.actions.storesCheck(required(query, "project"))
  }
}
