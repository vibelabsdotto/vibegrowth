import { Body, Controller, HttpCode, Post } from "@nestjs/common"
import { Actor } from "../../common/actor.decorator"
import { GrowthImportService } from "./growth-import.service"

@Controller("import")
export class GrowthImportController {
  constructor(private readonly imports: GrowthImportService) {}

  /** POST /import/growth {db, sites, workspaceRoot?} → report {imported, updated, unchanged, skipped, warnings, mapping}. */
  @Post("growth")
  @HttpCode(200)
  growth(@Body() body: unknown, @Actor() actor: string) {
    return this.imports.run(body, actor)
  }
}
