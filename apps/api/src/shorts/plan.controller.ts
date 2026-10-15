import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query as Q,
} from "@nestjs/common"
import { Actor } from "../common/actor.decorator"
import * as plan from "../core/plan"
import { VSError } from "../core/util"
import { DatabaseService } from "../database/database.service"
import { brandOf, flag, Input, int, intOr, need, type Query } from "./params"

type EntryPatchBody = plan.EntryPatch & {
  /** Web: lock/unlock in the same transaction (old saveEntry action). */
  locked?: boolean
}
type FillBody = {
  account: string
  weeks?: number
  from?: string
  entries?: Omit<plan.EntryInput, "accountId" | "date">[]
}

@Controller("plan")
export class PlanController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list(@Q() q: Query) {
    return plan.listPlan(this.db.ctx, {
      accountId: q.account,
      brandId: brandOf(q),
      from: q.from,
      to: q.to,
      status: q.status,
      ideas: flag(q.ideas),
    })
  }

  @Get("next")
  next(@Q() q: Query) {
    return plan.nextEntry(this.db.ctx, need(q.account, "account"), q.date)
  }

  @Get("horizon")
  horizon(@Q() q: Query) {
    return plan.horizon(
      this.db.ctx,
      need(q.account, "account"),
      undefined,
      intOr(q.days, 21)
    )
  }

  @Post("fill")
  @HttpCode(200)
  fill(@Input() body: FillBody, @Actor() actor: string) {
    const { account, weeks = 3, from, entries } = body
    return this.db.tx(() => {
      if (entries !== undefined && !Array.isArray(entries))
        throw new VSError("INVALID", "--file muss eine JSON-Liste sein")
      return plan.fillPlan(
        this.db.ctx,
        need(account, "account"),
        { weeks, from, entries },
        actor
      )
    })
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return plan.getEntry(this.db.ctx, int(id))
  }

  @Post()
  add(@Input() body: plan.EntryInput, @Actor() actor: string) {
    return this.db.tx(() => plan.addEntry(this.db.ctx, body, actor))
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Input() body: EntryPatchBody,
    @Actor() actor: string
  ) {
    const { locked, ...patch } = body
    return this.db.tx(() => {
      const c = this.db.ctx
      const n = int(id)
      const before = locked === undefined ? null : plan.getEntry(c, n)
      const row = plan.updateEntry(c, n, patch, actor)
      if (typeof locked === "boolean" && before && locked !== before.locked)
        return plan.lockEntry(c, n, locked, actor)
      return row
    })
  }

  @Post(":id/move")
  @HttpCode(200)
  move(
    @Param("id") id: string,
    @Input() body: { date: string },
    @Actor() actor: string
  ) {
    return this.db.tx(() =>
      plan.moveEntry(this.db.ctx, int(id), body.date, actor)
    )
  }

  @Post(":id/lock")
  @HttpCode(200)
  lock(
    @Param("id") id: string,
    @Input() body: { locked?: boolean },
    @Actor() actor: string
  ) {
    return this.db.tx(() =>
      plan.lockEntry(this.db.ctx, int(id), body.locked !== false, actor)
    )
  }

  @Post(":id/skip")
  @HttpCode(200)
  skip(
    @Param("id") id: string,
    @Input() body: { reason?: string },
    @Actor() actor: string
  ) {
    return this.db.tx(() =>
      plan.skipEntry(this.db.ctx, int(id), body.reason, actor)
    )
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Actor() actor: string) {
    return this.db.tx(() => plan.deleteEntry(this.db.ctx, int(id), actor))
  }
}
