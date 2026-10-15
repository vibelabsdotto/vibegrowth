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
import * as know from "../core/knowledge"
import { getPost } from "../core/posts"
import { DatabaseService } from "../database/database.service"
import { brandOf, flag, Input, int, intOr, type Query } from "./params"

type LearningBody = Parameters<typeof know.addLearning>[1]
type DecisionBody = Parameters<typeof know.addDecision>[1]
type HookBody = Parameters<typeof know.addHook>[1] & {
  /** Origin post as ID or folder, resolved like `hook add --post`. */
  post?: string
}
type InspoBody = Parameters<typeof know.addInspiration>[1]
type InspoPatchBody = Parameters<typeof know.updateInspiration>[2]

@Controller("learnings")
export class LearningsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list(@Q() q: Query) {
    return know.listLearnings(this.db.ctx, {
      accountId: q.account,
      status: flag(q.all) ? undefined : "active",
    })
  }

  @Post()
  add(@Input() body: LearningBody, @Actor() actor: string) {
    return this.db.tx(() => know.addLearning(this.db.ctx, body, actor))
  }

  @Post(":id/outdate")
  @HttpCode(200)
  outdate(@Param("id") id: string, @Actor() actor: string) {
    return this.db.tx(() =>
      know.setLearningStatus(this.db.ctx, int(id), "outdated", actor)
    )
  }

  /** Web: reactivate or outdate (old setLearningStatus action). */
  @Post(":id/status")
  @HttpCode(200)
  status(
    @Param("id") id: string,
    @Input() body: { status: "active" | "outdated" },
    @Actor() actor: string
  ) {
    return this.db.tx(() =>
      know.setLearningStatus(this.db.ctx, int(id), body.status, actor)
    )
  }
}

@Controller("decisions")
export class DecisionsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list(@Q() q: Query) {
    return know.listDecisions(this.db.ctx, { accountId: q.account })
  }

  @Post()
  add(@Input() body: DecisionBody, @Actor() actor: string) {
    return this.db.tx(() => know.addDecision(this.db.ctx, body, actor))
  }
}

@Controller("hooks")
export class HooksController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list(@Q() q: Query) {
    return know.listHooks(this.db.ctx, {
      accountId: q.account,
      winners: flag(q.winners),
    })
  }

  @Post()
  add(@Input() body: HookBody, @Actor() actor: string) {
    const { post, ...input } = body
    return this.db.tx(() => {
      const c = this.db.ctx
      if (post !== undefined)
        input.originPostId = post ? getPost(c, post).id : null
      return know.addHook(c, input, actor)
    })
  }

  @Post(":id/winner")
  @HttpCode(200)
  winner(
    @Param("id") id: string,
    @Input() body: { winner?: boolean },
    @Actor() actor: string
  ) {
    return this.db.tx(() =>
      know.setHookWinner(this.db.ctx, int(id), body.winner !== false, actor)
    )
  }

  @Post(":id/variants")
  variant(
    @Param("id") id: string,
    @Input() body: { text: string; mechanism?: string | null },
    @Actor() actor: string
  ) {
    return this.db.tx(() =>
      know.addHookVariant(
        this.db.ctx,
        int(id),
        body.text,
        actor,
        body.mechanism
      )
    )
  }
}

@Controller("inspo")
export class InspoController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list(@Q() q: Query) {
    return know.listInspirations(this.db.ctx, {
      accountId: q.account,
      brandId: brandOf(q),
      status: q.status,
      type: q.type,
    })
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return know.getInspiration(this.db.ctx, int(id))
  }

  @Post()
  add(@Input() body: InspoBody, @Actor() actor: string) {
    return this.db.tx(() => know.addInspiration(this.db.ctx, body, actor))
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Input() body: InspoPatchBody,
    @Actor() actor: string
  ) {
    return this.db.tx(() =>
      know.updateInspiration(this.db.ctx, int(id), body, actor)
    )
  }
}

@Controller("history")
export class HistoryController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list(@Q() q: Query) {
    return know.listHistory(this.db.ctx, {
      entity: q.entity,
      entityId: q.id,
      actor: q.by,
      limit: intOr(q.limit, 50),
    })
  }
}
