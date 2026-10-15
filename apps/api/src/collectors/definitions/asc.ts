import { fromSource } from "../collector"
import { ascCollector } from "../sources/asc"

/** Access through the asc CLI profile, not through secretsDir. */
export const asc = fromSource(ascCollector, { secrets: false })
