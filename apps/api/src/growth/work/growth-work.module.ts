import { Module } from "@nestjs/common"
import { ApprovalsService } from "./approvals.service"
import { BacklogService } from "./backlog.service"
import { ChangesService } from "./changes.service"
import { ContentService } from "./content.service"
import { DataBridge } from "./data-bridge"
import { ExperimentsService } from "./experiments.service"
import { GeoService } from "./geo.service"
import { OverviewService } from "./overview.service"
import { ProjectContextService } from "./project-context.service"
import { StoreService } from "./store.service"
import {
  ApprovalsController,
  BacklogController,
  ChangesController,
  ContentController,
  ExperimentsController,
  GeoController,
  MentionsController,
  OverviewController,
  StoreController,
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
  ],
})
export class GrowthWorkModule {}
