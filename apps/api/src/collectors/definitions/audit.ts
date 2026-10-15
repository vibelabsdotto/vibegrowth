import { fromSource, projectUrl } from "../collector"
import { auditCollector } from "../sources/audit"

export const audit = fromSource(auditCollector, {
  secrets: false,
  defaults: projectUrl,
})
