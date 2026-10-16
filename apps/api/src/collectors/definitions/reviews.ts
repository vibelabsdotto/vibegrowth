import type { CollectorDefinition } from "../collector"
import { collectReviews, configSchema } from "../sources/reviews"

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null

/**
 * Store reviews with reply status (Google Play API + CSVs, App Store via asc CLI). Package, bucket
 * and app id default to the configs of play and asc.
 */
export const reviews: CollectorDefinition = {
  id: "reviews",
  label: "Store-Bewertungen",
  channelKinds: ["ios", "android"],
  configSchema,
  secrets: false,
  run: (_project, config, options) =>
    collectReviews(
      {
        package: str(config.package) ?? str(options.peers?.play?.package),
        gcsBucket: str(config.gcsBucket) ?? str(options.peers?.play?.gcsBucket),
        appId: str(config.appId) ?? str(options.peers?.asc?.appId),
        ascProfile: str(config.ascProfile),
        csvMonths:
          typeof config.csvMonths === "number" ? config.csvMonths : undefined,
        answered: options.answeredReviews,
      },
      {
        days: options.days,
        secretsDir: options.secretsDir ?? "",
        today: options.today,
      }
    ),
}
