import { Logger } from "@nestjs/common"
import type { CollectorDefinition } from "../collector"
import { collectGeoChatgpt, configSchema, type GeoConfig } from "../sources/geo"

const logger = new Logger("geo-chatgpt")

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null

/** GEO check in ChatGPT via the shared automation Chrome; questions from geo_questions (active). */
export const geoChatgpt: CollectorDefinition = {
  id: "geo-chatgpt",
  label: "GEO-Check ChatGPT",
  channelKinds: ["website", "other"],
  configSchema,
  secrets: false,
  run: (project, config, options) => {
    const c = config as GeoConfig
    return collectGeoChatgpt(
      {
        ...c,
        appStoreId: str(c.appStoreId) ?? str(options.peers?.asc?.appId),
        playPackage: str(c.playPackage) ?? str(options.peers?.play?.package),
      },
      {
        project: {
          id: project.id,
          url: project.url,
          workspace: project.workspace,
        },
        questions: options.questions ?? [],
        limit: options.limit,
        today: options.today,
        log: (line) => logger.log(`${project.id} ${line}`),
      }
    )
  },
}
