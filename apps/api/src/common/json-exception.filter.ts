import {
  BadRequestException,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
  type ValidationError,
} from "@nestjs/common"
import type { Request, Response } from "express"
import { ConfigError } from "../core/config"
import { VSError, type ErrorCode } from "../core/util"

type Code = ErrorCode | "CONFIG" | "ERROR"

const STATUS: Record<ErrorCode, number> = {
  INVALID: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  LOCKED: 423,
  EXTERNAL: 502,
}

function codeForStatus(status: number): Code {
  if (status === 404) return "NOT_FOUND"
  if (status === 409) return "CONFLICT"
  if (status === 423) return "LOCKED"
  if (status === 502) return "EXTERNAL"
  if (status >= 400 && status < 500) return "INVALID"
  return "ERROR"
}

function flatten(errors: ValidationError[], parent = ""): string[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property
    const own = Object.values(e.constraints ?? {})
    return [
      ...(own.length ? [`${field}: ${own.join(", ")}`] : []),
      ...flatten(e.children ?? [], field),
    ]
  })
}

/** ValidationPipe exceptionFactory: one readable message instead of an array. */
export function validationError(errors: ValidationError[]) {
  return new BadRequestException(
    flatten(errors).join("; ") || "Ungültige Eingabe"
  )
}

function httpMessage(exception: HttpException): string {
  const raw = exception.getResponse()
  if (typeof raw === "string") return raw
  const message = (raw as { message?: unknown }).message
  if (Array.isArray(message)) return message.map(String).join("; ")
  if (typeof message === "string") return message
  return exception.message
}

/** Body-parser errors (invalid JSON, too large) are no HttpException but carry status and expose. */
function clientErrorStatus(exception: unknown): number | null {
  if (typeof exception !== "object" || exception === null) return null
  const e = exception as { status?: unknown; expose?: unknown }
  return e.expose === true && typeof e.status === "number" && e.status < 500
    ? e.status
    : null
}

/**
 * Every error becomes {"error":{"code","message"}} (contract §4):
 * VGError/VSError with its code, ConfigError → CONFIG 500, Nest validation → INVALID 400, rest ERROR 500.
 */
@Catch()
export class JsonExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("JsonExceptionFilter")

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const response = http.getResponse<Response>()
    const request = http.getRequest<Request>()
    let status: number
    let code: Code
    let message: string
    if (exception instanceof VSError) {
      code = exception.code
      status = STATUS[exception.code] ?? 500
      message = exception.message
    } else if (exception instanceof ConfigError) {
      code = "CONFIG"
      status = HttpStatus.INTERNAL_SERVER_ERROR
      message = exception.message
    } else if (exception instanceof HttpException) {
      status = exception.getStatus()
      code = codeForStatus(status)
      message = httpMessage(exception)
    } else if (clientErrorStatus(exception) !== null) {
      status = clientErrorStatus(exception)!
      code = codeForStatus(status)
      message = (exception as Error).message
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR
      code = "ERROR"
      message =
        exception instanceof Error ? exception.message : String(exception)
    }
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} → ${code}`,
        exception instanceof Error ? exception.stack : String(exception)
      )
    }
    response.status(status).json({ error: { code, message } })
  }
}
