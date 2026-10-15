import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query as Q,
} from "@nestjs/common"
import { Actor } from "../common/actor.decorator"
import * as cat from "../core/catalog"
import { accountsUsingFormat } from "../core/context"
import { DatabaseService } from "../database/database.service"
import { brandOf, flag, Input, int, type Query } from "./params"

type FormatVersionBody = cat.FormatVersionInput & {
  changeNote: string
  carryRules?: boolean
}
type FormatPatchBody = cat.FormatVersionInput & { name?: string }
type RuleReplaceBody = { text: string; source: string; kind?: string }
type ImageErrorPatchBody = {
  title?: string
  countermeasure?: string
  detection?: string | null
  formatIds?: string[]
  status?: string
}

@Controller("formats")
export class FormatsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list() {
    return cat.listFormats(this.db.ctx)
  }

  /** `formats show` composition from the old CLI. */
  @Get(":id")
  show(@Param("id") id: string) {
    const c = this.db.ctx
    const f = cat.getFormat(c, id)
    return {
      ...f,
      activeAccounts: accountsUsingFormat(c, id),
      rules: cat.listRules(c, {
        scopeType: "format",
        scopeId: id,
        formatVersion: f.currentVersion,
      }),
      imageErrors: cat.listImageErrors(c, { formatId: id }),
    }
  }

  @Post()
  create(@Input() body: cat.FormatInput, @Actor() actor: string) {
    return this.db.tx(() => cat.createFormat(this.db.ctx, body, actor))
  }

  @Post(":id/versions")
  newVersion(
    @Param("id") id: string,
    @Input() body: FormatVersionBody,
    @Actor() actor: string
  ) {
    return this.db.tx(() => cat.newFormatVersion(this.db.ctx, id, body, actor))
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Input() body: FormatPatchBody,
    @Actor() actor: string
  ) {
    return this.db.tx(() => cat.updateFormat(this.db.ctx, id, body, actor))
  }
}

@Controller("rules")
export class RulesController {
  constructor(private readonly db: DatabaseService) {}

  /** Scope priority format > account > brand like `rules list`. */
  @Get()
  list(@Q() q: Query) {
    const brand = brandOf(q)
    const scope = q.format
      ? ["format", q.format]
      : q.account
        ? ["account", q.account]
        : brand
          ? ["brand", brand]
          : [undefined, undefined]
    return cat.listRules(this.db.ctx, {
      scopeType: scope[0],
      scopeId: scope[1],
      status: flag(q.all) ? undefined : "active",
    })
  }

  @Post()
  add(@Input() body: cat.RuleInput, @Actor() actor: string) {
    return this.db.tx(() => cat.addRule(this.db.ctx, body, actor))
  }

  @Post(":id/replace")
  replace(
    @Param("id") id: string,
    @Input() body: RuleReplaceBody,
    @Actor() actor: string
  ) {
    return this.db.tx(() => cat.replaceRule(this.db.ctx, int(id), body, actor))
  }

  @Post(":id/retire")
  @HttpCode(200)
  retire(@Param("id") id: string, @Actor() actor: string) {
    return this.db.tx(() => cat.retireRule(this.db.ctx, int(id), actor))
  }
}

@Controller("image-errors")
export class ImageErrorsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list(@Q() q: Query) {
    return cat.listImageErrors(this.db.ctx, {
      formatId: q.format,
      status: flag(q.all) ? undefined : "active",
    })
  }

  @Post()
  add(@Input() body: cat.ImageErrorInput, @Actor() actor: string) {
    return this.db.tx(() => cat.addImageError(this.db.ctx, body, actor))
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Input() body: ImageErrorPatchBody,
    @Actor() actor: string
  ) {
    return this.db.tx(() =>
      cat.updateImageError(this.db.ctx, int(id), body, actor)
    )
  }
}
