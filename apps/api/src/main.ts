import "reflect-metadata"
import { ValidationPipe } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { AppModule } from "./app.module"
import {
  JsonExceptionFilter,
  validationError,
} from "./common/json-exception.filter"
import { env } from "./core/config"

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.set("x-powered-by", false)
  app.setGlobalPrefix("api")
  app.useBodyParser("json", { limit: "5mb" })
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationError,
    })
  )
  app.useGlobalFilters(new JsonExceptionFilter())
  app.enableShutdownHooks()
  const port = Number(env("API_PORT")) || 4311
  // Local tool without login: loopback only.
  await app.listen(port, "127.0.0.1")
}

void bootstrap()
