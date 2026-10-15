import { Module } from "@nestjs/common"
import { CollectorsModule } from "./collectors/collectors.module"
import { DatabaseModule } from "./database/database.module"
import { GrowthModule } from "./growth/growth.module"
import { HealthController } from "./health.controller"
import { ShortsModule } from "./shorts/shorts.module"

@Module({
  imports: [DatabaseModule, ShortsModule, GrowthModule, CollectorsModule],
  controllers: [HealthController],
})
export class AppModule {}
