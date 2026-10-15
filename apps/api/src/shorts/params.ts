import { createParamDecorator, type ExecutionContext } from "@nestjs/common"
import type { Request } from "express"
import { VSError } from "../core/util"

/**
 * JSON body as plain object, {} when the request has none. Shorts bodies are the
 * core input objects; core validates them (VSError INVALID), so no DTO class and
 * no ValidationPipe here (custom decorators skip global pipes).
 */
export const Input = createParamDecorator(
  (_data: unknown, context: ExecutionContext): unknown => {
    const body = context.switchToHttp().getRequest<Request>().body as unknown
    return body !== null && typeof body === "object" ? body : {}
  }
)

/** Query string values as Express hands them over. */
export type Query = Record<string, string | undefined>

/** Same as `int` in the old CLI: whole numbers only, otherwise INVALID. */
export function int(v: string): number {
  const n = Number(v)
  if (!Number.isInteger(n))
    throw new VSError("INVALID", `Keine ganze Zahl: ${v}`)
  return n
}

/** Optional numeric query with the CLI default. */
export function intOr(v: string | undefined, fallback: number): number {
  return v === undefined ? fallback : int(v)
}

/** Boolean query flag: "true" or "1" set it, anything else leaves it unset like a missing CLI flag. */
export function flag(v: string | undefined): true | undefined {
  return v === "true" || v === "1" ? true : undefined
}

/** `--project` is an alias for `--brand` on shorts commands (contract §5). */
export function brandOf(q: Query): string | undefined {
  return q.brand ?? q.project
}

/** Required query/body value (the old CLI enforced these with requiredOption). */
export function need(v: string | undefined, name: string): string {
  if (!v) throw new VSError("INVALID", `${name} fehlt`)
  return v
}
