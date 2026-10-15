import { Module } from "@nestjs/common"
import { CollectorsModule } from "../../collectors/collectors.module"
import { GrowthWorkModule } from "../work/growth-work.module"
import { AuditService } from "./audit.service"
import { ChannelsService } from "./channels.service"
import { CollectService } from "./collect.service"
import { CollectorActionsController } from "./collector-actions.controller"
import { CollectorActionsService } from "./collector-actions.service"
import { CollectorsService } from "./collectors.service"
import { FunnelService } from "./funnel.service"
import {
  ChannelsController,
  CollectorsController,
  MetricsDataController,
  ProjectsController,
} from "./growth-data.controller"
import { KpiService } from "./kpi.service"
import { ProjectsService } from "./projects.service"
import { SearchService } from "./search.service"

/**
 * Lane growth-data: projects, channels, collectors, collect, kpi, search, audit, health, funnel,
 * collector actions (geo run, sitemap/bing submit, keywords, app setup, store check). Imports
 * GrowthWorkModule for GeoService/StoreService (collector results) and ChangesService (actions).
 * Exports the read services growth-work builds on (overview, context --project).
 */
@Module({
  imports: [CollectorsModule, GrowthWorkModule],
  controllers: [
    CollectorActionsController,
    ProjectsController,
    ChannelsController,
    CollectorsController,
    MetricsDataController,
  ],
  providers: [
    ProjectsService,
    ChannelsService,
    CollectorsService,
    CollectService,
    CollectorActionsService,
    KpiService,
    SearchService,
    AuditService,
    FunnelService,
  ],
  exports: [
    ProjectsService,
    ChannelsService,
    CollectorsService,
    KpiService,
    SearchService,
    AuditService,
    FunnelService,
  ],
})
export class GrowthDataModule {}
