import { Module } from "@nestjs/common"
import { CollectorsModule } from "../../collectors/collectors.module"
import { AuditService } from "./audit.service"
import { ChannelsService } from "./channels.service"
import { CollectService } from "./collect.service"
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
 * Lane growth-data: projects, channels, collectors, collect, kpi, search, audit, health, funnel.
 * Exports the read services growth-work builds on (overview, context --project).
 */
@Module({
  imports: [CollectorsModule],
  controllers: [
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
