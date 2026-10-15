import { fromSource } from "../collector"
import { gscCollector } from "../sources/gsc"

export const gsc = fromSource(gscCollector, {
  secrets: true,
})
