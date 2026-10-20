import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common"
import { Actor } from "../../common/actor.decorator"
import { VGError } from "../../core/util"
import { AppInboxService } from "./app-inbox.service"
import { AppPublishService } from "./app-publish.service"
import { ApprovalsService } from "./approvals.service"
import { BacklogService } from "./backlog.service"
import { CalendarService } from "./calendar.service"
import { ChangesService } from "./changes.service"
import { ContentService } from "./content.service"
import {
  ApprovalCreateDto,
  ApprovalDecideDto,
  BacklogCreateDto,
  BacklogPatchDto,
  BacklogReleaseDto,
  TaskAcceptDto,
  TaskCommentDto,
  TaskReportDto,
  ChangeCreateDto,
  ContentCreateDto,
  ContentPatchDto,
  EvaluateDto,
  ExperimentCreateDto,
  ExperimentPatchDto,
  GeoChecksDto,
  GeoQuestionCreateDto,
  AppPublishDto,
  GeoQuestionPatchDto,
  InboxNoReplyDto,
  InboxReplyDto,
  KnowledgePatchDto,
  MentionPatchDto,
  StrategyCreateDto,
  StrategyPatchDto,
} from "./dto"
import { ExperimentsService } from "./experiments.service"
import { GeoService } from "./geo.service"
import { KnowledgeService } from "./knowledge.service"
import { OverviewService } from "./overview.service"
import { ProjectContextService } from "./project-context.service"
import { boolParam, idParam, intParam } from "./shared"
import { StoreService } from "./store.service"
import { StrategiesService } from "./strategies.service"

@Controller("approvals")
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(
    @Query("project") project?: string,
    @Query("status") status?: string,
    @Query("kind") kind?: string,
    @Query("account") account?: string,
    @Query("limit") limit?: string,
    @Query("category") category?: string,
    @Query("waiting") waiting?: string
  ) {
    return this.approvals.list({
      project,
      status,
      kind,
      account,
      limit: intParam(limit, "limit"),
      category,
      waiting,
    })
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.approvals.get(idParam(id, "Freigabe"))
  }

  @Post()
  add(@Body() body: ApprovalCreateDto, @Actor() actor: string) {
    return this.approvals.add(body, actor)
  }

  @Post(":id/decide")
  @HttpCode(200)
  decide(
    @Param("id") id: string,
    @Body() body: ApprovalDecideDto,
    @Actor() actor: string
  ) {
    return this.approvals.decide(idParam(id, "Freigabe"), body, actor)
  }

  @Post(":id/withdraw")
  @HttpCode(200)
  withdraw(@Param("id") id: string, @Actor() actor: string) {
    return this.approvals.withdraw(idParam(id, "Freigabe"), actor)
  }
}

@Controller("content")
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list(
    @Query("project") project?: string,
    @Query("status") status?: string,
    @Query("kind") kind?: string,
    @Query("category") category?: string
  ) {
    return this.content.list({ project, status, kind, category })
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.content.get(idParam(id, "Content"))
  }

  @Post()
  add(@Body() body: ContentCreateDto, @Actor() actor: string) {
    return this.content.add({ ...body, title: body.title ?? "" }, actor)
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: ContentPatchDto,
    @Actor() actor: string
  ) {
    return this.content.update(idParam(id, "Content"), body, actor)
  }
}

@Controller("backlog")
export class BacklogController {
  constructor(private readonly backlog: BacklogService) {}

  @Get()
  list(
    @Query("project") project?: string,
    @Query("status") status?: string,
    @Query("kind") kind?: string,
    @Query("category") category?: string,
    @Query("assignee") assignee?: string
  ) {
    return this.backlog.list({ project, status, kind, category, assignee })
  }

  @Post("release")
  @HttpCode(200)
  release(@Body() body: BacklogReleaseDto, @Actor() actor: string) {
    return this.backlog.release(body, actor)
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.backlog.get(idParam(id, "Backlog-Eintrag"))
  }

  @Post()
  add(@Body() body: BacklogCreateDto, @Actor() actor: string) {
    return this.backlog.add({ ...body, title: body.title ?? "" }, actor)
  }

  @Post(":id/comments")
  comment(
    @Param("id") id: string,
    @Body() body: TaskCommentDto,
    @Actor() actor: string
  ) {
    return this.backlog.comment(idParam(id, "Backlog-Eintrag"), body, actor)
  }

  @Post(":id/report")
  @HttpCode(200)
  report(
    @Param("id") id: string,
    @Body() body: TaskReportDto,
    @Actor() actor: string
  ) {
    return this.backlog.report(idParam(id, "Backlog-Eintrag"), body, actor)
  }

  @Post(":id/accept")
  @HttpCode(200)
  accept(
    @Param("id") id: string,
    @Body() body: TaskAcceptDto,
    @Actor() actor: string
  ) {
    return this.backlog.accept(idParam(id, "Backlog-Eintrag"), body, actor)
  }

  @Post(":id/reopen")
  @HttpCode(200)
  reopen(
    @Param("id") id: string,
    @Body() body: TaskCommentDto,
    @Actor() actor: string
  ) {
    return this.backlog.reopen(idParam(id, "Backlog-Eintrag"), body, actor)
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: BacklogPatchDto,
    @Actor() actor: string
  ) {
    return this.backlog.update(idParam(id, "Backlog-Eintrag"), body, actor)
  }
}

@Controller("experiments")
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get()
  list(
    @Query("project") project?: string,
    @Query("status") status?: string,
    @Query("category") category?: string
  ) {
    return this.experiments.list({ project, status, category })
  }

  @Post("evaluate")
  @HttpCode(200)
  evaluate(@Body() body: EvaluateDto, @Actor() actor: string) {
    return this.experiments.evaluate(body, actor)
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.experiments.get(idParam(id, "Experiment"))
  }

  @Post()
  add(@Body() body: ExperimentCreateDto, @Actor() actor: string) {
    return this.experiments.add(body, actor)
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: ExperimentPatchDto,
    @Actor() actor: string
  ) {
    return this.experiments.update(idParam(id, "Experiment"), body, actor)
  }
}

@Controller("changes")
export class ChangesController {
  constructor(private readonly changes: ChangesService) {}

  @Get()
  list(
    @Query("project") project?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("kind") kind?: string,
    @Query("experiment") experiment?: string,
    @Query("limit") limit?: string,
    @Query("category") category?: string
  ) {
    return this.changes.list({
      category,
      project,
      from,
      to,
      kind,
      experiment: experiment ? idParam(experiment, "Experiment") : undefined,
      limit: intParam(limit, "limit"),
    })
  }

  @Post()
  add(@Body() body: ChangeCreateDto, @Actor() actor: string) {
    return this.changes.add(body, actor)
  }
}

@Controller("geo")
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get("questions")
  questions(@Query("project") project?: string, @Query("all") all?: string) {
    return this.geo.listQuestions({ project, all: boolParam(all) })
  }

  @Post("questions")
  addQuestion(@Body() body: GeoQuestionCreateDto, @Actor() actor: string) {
    return this.geo.addQuestion(body, actor)
  }

  @Patch("questions/:id")
  updateQuestion(
    @Param("id") id: string,
    @Body() body: GeoQuestionPatchDto,
    @Actor() actor: string
  ) {
    return this.geo.updateQuestion(idParam(id, "GEO-Frage"), body, actor)
  }

  @Post("checks")
  @HttpCode(200)
  record(@Body() body: GeoChecksDto, @Actor() actor: string) {
    return this.geo.recordChecks(body.checks, actor)
  }

  @Get("checks")
  checks(
    @Query("project") project?: string,
    @Query("date") date?: string,
    @Query("engine") engine?: string,
    @Query("question") question?: string,
    @Query("limit") limit?: string
  ) {
    return this.geo.listChecks({
      project,
      date,
      engine,
      question: question ? idParam(question, "GEO-Frage") : undefined,
      limit: intParam(limit, "limit"),
    })
  }

  @Get("summary")
  summary(@Query("project") project?: string) {
    if (!project) throw new VGError("INVALID", "project fehlt")
    return this.geo.summary(project)
  }
}

@Controller("mentions")
export class MentionsController {
  constructor(private readonly geo: GeoService) {}

  @Get()
  list(
    @Query("project") project?: string,
    @Query("status") status?: string,
    @Query("kind") kind?: string
  ) {
    return this.geo.listMentions({ project, status, kind })
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: MentionPatchDto,
    @Actor() actor: string
  ) {
    return this.geo.updateMention(idParam(id, "Erwähnungs-Ziel"), body, actor)
  }
}

@Controller("store")
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Get("summary")
  summary(
    @Query("project") project?: string,
    @Query("days") days?: string,
    @Query("end") end?: string
  ) {
    if (!project) throw new VGError("INVALID", "project fehlt")
    return this.store.summary(
      project,
      intParam(days, "days", 28),
      end || undefined
    )
  }

  @Get("reviews")
  reviews(
    @Query("project") project?: string,
    @Query("store") store?: string,
    @Query("rating") rating?: string,
    @Query("limit") limit?: string,
    @Query("needsReply") needsReply?: string
  ) {
    if (!project) throw new VGError("INVALID", "project fehlt")
    return this.store.reviews({
      project,
      store,
      rating: intParam(rating, "rating"),
      limit: intParam(limit, "limit", 50),
      needsReply:
        needsReply === undefined || needsReply === ""
          ? undefined
          : boolParam(needsReply),
    })
  }
}

@Controller("strategies")
export class StrategiesController {
  constructor(private readonly strategies: StrategiesService) {}

  @Get()
  list(
    @Query("project") project?: string,
    @Query("category") category?: string,
    @Query("status") status?: string
  ) {
    return this.strategies.list({ project, category, status })
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return this.strategies.get(id)
  }

  @Post()
  add(@Body() body: StrategyCreateDto, @Actor() actor: string) {
    return this.strategies.add(body, actor)
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: StrategyPatchDto,
    @Actor() actor: string
  ) {
    return this.strategies.update(id, body, actor)
  }
}

/** Growth view of learnings and decisions with category (the shorts routes stay unchanged). */
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(
    @Query("project") project?: string,
    @Query("category") category?: string,
    @Query("type") type?: string,
    @Query("status") status?: string
  ) {
    return this.knowledge.list({ project, category, type, status })
  }

  @Patch(":type/:id")
  setCategory(
    @Param("type") type: string,
    @Param("id") id: string,
    @Body() body: KnowledgePatchDto,
    @Actor() actor: string
  ) {
    return this.knowledge.setCategory(
      type,
      idParam(id, type === "decision" ? "Entscheidungs" : "Learning"),
      body.category,
      actor
    )
  }
}

@Controller("app")
export class AppController {
  constructor(
    private readonly inbox: AppInboxService,
    private readonly publisher: AppPublishService
  ) {}

  @Get("inbox")
  list(
    @Query("project") project?: string,
    @Query("type") type?: string,
    @Query("needsReply") needsReply?: string,
    @Query("limit") limit?: string,
    @Query("state") state?: string
  ) {
    return this.inbox.inbox({
      project,
      type,
      state,
      needsReply:
        needsReply === undefined || needsReply === ""
          ? undefined
          : boolParam(needsReply),
      limit: intParam(limit, "limit"),
    })
  }

  @Post("inbox/reply")
  reply(@Body() body: InboxReplyDto, @Actor() actor: string) {
    return this.inbox.reply(body, actor)
  }

  @Post("inbox/no-reply")
  @HttpCode(200)
  noReply(@Body() body: InboxNoReplyDto, @Actor() actor: string) {
    return this.inbox.noReply(body, actor)
  }

  @Post("publish")
  @HttpCode(200)
  publish(@Body() body: AppPublishDto, @Actor() actor: string) {
    return this.publisher.publish(body, actor)
  }
}

/** Shortform plan and dated content in one list (the shorts plan routes stay unchanged). */
@Controller("calendar")
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  calendar(
    @Query("project") project?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("category") category?: string
  ) {
    return this.calendarService.calendar({ project, from, to, category })
  }
}

@Controller()
export class OverviewController {
  constructor(
    private readonly overviewService: OverviewService,
    private readonly context: ProjectContextService
  ) {}

  @Get("overview")
  overview(@Query("days") days?: string) {
    return this.overviewService.overview(intParam(days, "days", 7))
  }

  /** `context --project`. The CLI calls this path; GET /context?project= lands here too (see below). */
  @Get("context/project")
  projectContext(
    @Query("project") project?: string,
    @Query("date") date?: string
  ) {
    if (!project) throw new VGError("INVALID", "project fehlt")
    return this.context.build(project, date || undefined)
  }

  /**
   * GET /context?project= (contract §7.5). The shorts handler for GET /context?account= is
   * registered first and hands requests without account but with project over to this route.
   */
  @Get("context")
  contextByProject(
    @Query("project") project?: string,
    @Query("date") date?: string
  ) {
    return this.projectContext(project, date)
  }
}
