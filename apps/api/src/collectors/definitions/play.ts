import { fromSource } from "../collector"
import { playCollector } from "../sources/play"

/** Play service account from GROWTH_PLAY_SA_JSON or ~/.playconsole-cli, not from secretsDir. */
export const play = fromSource(playCollector, { secrets: false })
