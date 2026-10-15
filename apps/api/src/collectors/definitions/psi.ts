import { fromSource, projectUrl } from "../collector"
import { psiCollector } from "../sources/psi"

export const psi = fromSource(psiCollector, {
  secrets: true,
  defaults: projectUrl,
})
