import { createParamDecorator, type ExecutionContext } from "@nestjs/common"
import type { Request } from "express"

export const DEFAULT_ACTOR = "agent"

/** Acting user from the X-Actor header, "agent" when missing. The browser sends "max". */
export const Actor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const header = context.switchToHttp().getRequest<Request>().headers[
      "x-actor"
    ]
    const value = (Array.isArray(header) ? header[0] : header)?.trim()
    return value || DEFAULT_ACTOR
  }
)
