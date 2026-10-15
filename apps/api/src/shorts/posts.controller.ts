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
import { folderFor, openPath, renderPost } from "../core/files"
import { accountStats, postStats, pullMetrics } from "../core/metrics"
import * as plan from "../core/plan"
import {
  getPost,
  listPosts,
  markPosted,
  registerPost,
  updatePost,
  type RegisterInput,
} from "../core/posts"
import { VSError } from "../core/util"
import { DatabaseService } from "../database/database.service"
import { Input, type Query } from "./params"

type PostedBody = {
  tiktokId?: string | null
  url?: string | null
  postedAt?: string | null
}
type PostPatchBody = {
  hook?: string | null
  angle?: string | null
  notes?: string | null
}
type RenderBody = {
  post: string
  video?: boolean
  finalize?: { stem: string; zip: string }
}
const OPEN_KINDS = ["post", "account", "inspo"] as const
type OpenBody = { kind: string; id: string }

@Controller("posts")
export class PostsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list(@Q() q: Query) {
    return listPosts(this.db.ctx, { accountId: q.account, status: q.status })
  }

  @Post("register")
  @HttpCode(200)
  register(@Input() body: RegisterInput, @Actor() actor: string) {
    return this.db.tx(() => registerPost(this.db.ctx, body, actor))
  }

  /** `post show` composition from the old CLI. */
  @Get(":idOrDir")
  show(@Param("idOrDir") idOrDir: string) {
    const c = this.db.ctx
    const p = getPost(c, idOrDir)
    return {
      ...p,
      metrics: postStats(c, p.id),
      planEntry: p.planEntryId ? plan.getEntry(c, p.planEntryId) : null,
    }
  }

  /** Web: hook/angle/notes of a post (old savePost action). */
  @Patch(":idOrDir")
  update(
    @Param("idOrDir") idOrDir: string,
    @Input() body: PostPatchBody,
    @Actor() actor: string
  ) {
    return this.db.tx(() => {
      const c = this.db.ctx
      return updatePost(c, getPost(c, idOrDir).id, body, actor)
    })
  }

  @Post(":idOrDir/posted")
  @HttpCode(200)
  posted(
    @Param("idOrDir") idOrDir: string,
    @Input() body: PostedBody,
    @Actor() actor: string
  ) {
    return this.db.tx(() => markPosted(this.db.ctx, idOrDir, body, actor))
  }
}

@Controller("metrics")
export class MetricsController {
  constructor(private readonly db: DatabaseService) {}

  /** No outer transaction, like the CLI: the pull locks per account itself. */
  @Post("pull")
  @HttpCode(200)
  pull(
    @Input() body: { account?: string; force?: boolean },
    @Actor() actor: string
  ) {
    return pullMetrics(
      this.db.ctx,
      { accountId: body.account, force: body.force },
      actor
    )
  }

  @Get()
  show(@Q() q: Query) {
    const c = this.db.ctx
    if (q.post) return postStats(c, getPost(c, q.post).id)
    if (q.account) return accountStats(c, q.account)
    return cat
      .listAccounts(c, { status: "active" })
      .map((a) => accountStats(c, a.id))
  }
}

@Controller()
export class FilesController {
  constructor(private readonly db: DatabaseService) {}

  /** Renderer runs synchronously like in the CLI, without an outer transaction. */
  @Post("render")
  @HttpCode(200)
  render(@Input() body: RenderBody, @Actor() actor: string) {
    if (body.finalize && !body.finalize.zip)
      throw new VSError("INVALID", "--finalize braucht --zip <name>.zip")
    return renderPost(
      this.db.ctx,
      body.post,
      { video: body.video, finalize: body.finalize },
      actor
    )
  }

  @Post("open")
  @HttpCode(200)
  open(@Input() body: OpenBody) {
    const kind = body.kind as (typeof OPEN_KINDS)[number]
    if (!OPEN_KINDS.includes(kind))
      throw new VSError("INVALID", "kind muss post, account oder inspo sein")
    const c = this.db.ctx
    return openPath(c, folderFor(c, kind, String(body.id)))
  }
}
