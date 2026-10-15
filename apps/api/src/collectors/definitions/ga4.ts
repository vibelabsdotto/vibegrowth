import { fromSource } from "../collector"
import { ga4Collector } from "../sources/ga4"

export const ga4 = fromSource(ga4Collector, {
  secrets: true,
})
