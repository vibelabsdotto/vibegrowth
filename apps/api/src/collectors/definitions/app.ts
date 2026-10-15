import { fromSource } from "../collector"
import { appCollector } from "../sources/app"

export const app = fromSource(appCollector, { secrets: true })
