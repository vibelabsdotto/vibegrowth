import { fromSource, projectUrl } from "../collector"
import { healthCollector } from "../sources/health"

export const health = fromSource(healthCollector, {
  secrets: false,
  defaults: projectUrl,
})
