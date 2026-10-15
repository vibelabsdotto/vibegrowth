import { fromSource, projectUrl } from "../collector"
import { bingCollector } from "../sources/bing"

export const bing = fromSource(bingCollector, {
  secrets: true,
  defaults: projectUrl,
})
