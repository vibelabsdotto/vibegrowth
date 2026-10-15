import { Module } from "@nestjs/common"
import { GrowthDataModule } from "./data/growth-data.module"
import { GrowthWorkModule } from "./work/growth-work.module"

/** Growth module (contract §7). Each lane owns one submodule. */
@Module({ imports: [GrowthDataModule, GrowthWorkModule] })
export class GrowthModule {}
