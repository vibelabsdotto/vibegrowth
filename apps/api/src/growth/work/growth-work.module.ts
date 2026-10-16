import { Module } from "@nestjs/common"
import { AppInboxService } from "./app-inbox.service"
import { AppPublishService } from "./app-publish.service"
import { ApprovalsService } from "./approvals.service"
import { BacklogService } from "./backlog.service"
import { CalendarService } from "./calendar.service"
import { ChangesService } from "./changes.service"
import { ContentService } from "./content.service"
import { DataBridge } from "./data-bridge"
import { ExperimentsService } from "./experiments.service"
import { GeoService } from "./geo.service"
import { KnowledgeService } from "./knowledge.service"
import { OverviewService } from "./overview.service"
import { ProjectContextService } from "./project-context.service"
import { StoreService } from "./store.service"
import { StrategiesService } from "./strategies.service"
import {
  AppController,
  ApprovalsController,
  BacklogController,
  CalendarController,
  ChangesController,
  ContentController,
  ExperimentsController,
  GeoController,
  KnowledgeController,
  MentionsController,
  OverviewController,
  StoreController,
  StrategiesController,
} from "./work.controllers"

/**
 * Lane growth-work: approvals, content, backlog, experiments, changes, geo, mentions, store,
 * overview, context --project. Exports GeoService (recordChecks) and StoreService (upsertReviews)
 * for the collectors geo-chatgpt, play and asc.
 */
@Module({
  controllers: [
    ApprovalsController,
    ContentController,
    BacklogController,
    ExperimentsController,
    ChangesController,
    GeoController,
    MentionsController,
    StoreController,
    StrategiesController,
    KnowledgeController,
    AppController,
    CalendarController,
    OverviewController,
  ],
  providers: [
    DataBridge,
    ApprovalsService,
    ContentService,
    BacklogService,
    ExperimentsService,
    ChangesService,
    GeoService,
    StoreService,
    OverviewService,
    ProjectContextService,
    StrategiesService,
    KnowledgeService,
    AppInboxService,
    AppPublishService,
    CalendarService,
  ],
  exports: [
    ApprovalsService,
    ContentService,
    BacklogService,
    ExperimentsService,
    ChangesService,
    GeoService,
    StoreService,
    OverviewService,
    ProjectContextService,
    StrategiesService,
    AppInboxService,
  ],
})
export class GrowthWorkModule {}
