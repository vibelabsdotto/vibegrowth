import { Module } from "@nestjs/common"
import { CollectorRegistry } from "./registry"

/**
 * Collector registry (CONTRACT §7.2): pure fetchers without DB access. Configuration, runs and
 * writing the results live in the growth data module (CollectorsService, CollectService).
 */
@Module({
  providers: [CollectorRegistry],
  exports: [CollectorRegistry],
})
export class CollectorsModule {}
