import { Module } from "@nestjs/common"
import { CollectorsModule } from "../../collectors/collectors.module"
import { GrowthDataModule } from "../data/growth-data.module"
import { GrowthWorkModule } from "../work/growth-work.module"
import { GrowthImportController } from "./growth-import.controller"
import { GrowthImportService } from "./growth-import.service"

/** Lane import-growth: one-off, idempotent import of the website-growth system. */
@Module({
  imports: [CollectorsModule, GrowthDataModule, GrowthWorkModule],
  controllers: [GrowthImportController],
  providers: [GrowthImportService],
})
export class GrowthImportModule {}
