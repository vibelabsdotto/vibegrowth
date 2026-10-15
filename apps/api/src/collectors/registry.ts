import { Injectable } from "@nestjs/common"
import { VGError } from "../core/util"
import type { CollectorDefinition } from "./collector"
import { app } from "./definitions/app"
import { asc } from "./definitions/asc"
import { audit } from "./definitions/audit"
import { bing } from "./definitions/bing"
import { ga4 } from "./definitions/ga4"
import { geoChatgpt } from "./definitions/geo-chatgpt"
import { gsc } from "./definitions/gsc"
import { health } from "./definitions/health"
import { play } from "./definitions/play"
import { psi } from "./definitions/psi"

/** All collectors in display order (CONTRACT §7.2). New collector: one file in definitions/ + one entry here. */
export const COLLECTORS: readonly CollectorDefinition[] = [
  health,
  audit,
  gsc,
  ga4,
  bing,
  psi,
  app,
  play,
  asc,
  geoChatgpt,
]

@Injectable()
export class CollectorRegistry {
  private readonly byId = new Map(COLLECTORS.map((c) => [c.id, c]))

  list(): readonly CollectorDefinition[] {
    return COLLECTORS
  }

  ids(): string[] {
    return COLLECTORS.map((c) => c.id)
  }

  find(id: string): CollectorDefinition | undefined {
    return this.byId.get(id)
  }

  /** Collector by id; unknown ids throw with the given code (path params NOT_FOUND, body fields INVALID). */
  get(
    id: string,
    code: "NOT_FOUND" | "INVALID" = "NOT_FOUND"
  ): CollectorDefinition {
    const def = this.byId.get(id)
    if (!def)
      throw new VGError(
        code,
        `Collector ${id} unbekannt (erlaubt: ${this.ids().join(", ")})`
      )
    return def
  }
}
