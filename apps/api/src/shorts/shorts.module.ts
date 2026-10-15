import { Module } from "@nestjs/common"
import { AccountsController, CharactersController } from "./accounts.controller"
import {
  FormatsController,
  ImageErrorsController,
  RulesController,
} from "./catalog.controller"
import { ContextController } from "./context.controller"
import {
  DecisionsController,
  HistoryController,
  HooksController,
  InspoController,
  LearningsController,
} from "./knowledge.controller"
import { MediaController } from "./media.controller"
import { PlanController } from "./plan.controller"
import {
  FilesController,
  MetricsController,
  PostsController,
} from "./posts.controller"

/**
 * Shorts endpoints 1:1 to the old CLI commands (docs/api-shorts.md). Controllers
 * call the core functions directly; DatabaseService.tx wraps every write.
 */
@Module({
  controllers: [
    ContextController,
    AccountsController,
    CharactersController,
    FormatsController,
    RulesController,
    ImageErrorsController,
    PlanController,
    PostsController,
    MetricsController,
    LearningsController,
    DecisionsController,
    HooksController,
    InspoController,
    HistoryController,
    FilesController,
    MediaController,
  ],
})
export class ShortsModule {}
