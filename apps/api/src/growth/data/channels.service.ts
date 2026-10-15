import { Injectable } from "@nestjs/common"
import { asc, eq } from "drizzle-orm"
import { accounts, channels } from "../../core/schema"
import { getById, patchRow, recordHistory, VGError } from "../../core/util"
import { DatabaseService } from "../../database/database.service"
import {
  CHANNEL_KINDS,
  CHANNEL_STATUSES,
  channelView,
  requireProject,
  virtualChannels,
  type ChannelView,
} from "./rows"
import {
  assertId,
  body,
  oneOf,
  onlyKeys,
  optOneOf,
  optString,
  reqString,
} from "./validate"

const FIELDS = ["name", "url", "handle", "externalId", "notes"] as const

@Injectable()
export class ChannelsService {
  constructor(private readonly database: DatabaseService) {}

  private get ctx() {
    return this.database.ctx
  }

  /** Stored channels plus TikTok accounts as virtual channels. */
  list(projectId?: string): ChannelView[] {
    if (projectId) requireProject(this.ctx, projectId)
    const q = this.ctx.db.select().from(channels)
    const real = (projectId ? q.where(eq(channels.projectId, projectId)) : q)
      .orderBy(asc(channels.projectId), asc(channels.id))
      .all()
      .map(channelView)
    return [...real, ...virtualChannels(this.ctx, projectId)]
  }

  get(id: string): ChannelView {
    const virtual = virtualChannels(this.ctx).find((c) => c.id === id)
    const row = this.ctx.db
      .select()
      .from(channels)
      .where(eq(channels.id, id))
      .get()
    if (row) return channelView(row)
    if (virtual) return virtual
    throw new VGError("NOT_FOUND", `Kanal ${id} nicht gefunden`)
  }

  create(raw: unknown, actor: string): ChannelView {
    const input = body(raw)
    onlyKeys(input, ["id", "project", "kind", "status", ...FIELDS])
    const id = assertId(reqString(input, "id"))
    const projectId = reqString(input, "project")
    const kind = oneOf(input.kind, CHANNEL_KINDS, "kind")
    const status = optOneOf(input, "status", CHANNEL_STATUSES) ?? "active"
    const values = {
      id,
      projectId,
      kind,
      status,
      name: optString(input, "name") ?? null,
      url: optString(input, "url") ?? null,
      handle: optString(input, "handle") ?? null,
      externalId: optString(input, "externalId") ?? null,
      notes: optString(input, "notes") ?? null,
    }
    return this.database.tx(() => {
      requireProject(this.ctx, projectId)
      const exists =
        this.ctx.db.select().from(channels).where(eq(channels.id, id)).get() ??
        this.ctx.db.select().from(accounts).where(eq(accounts.id, id)).get()
      if (exists)
        throw new VGError(
          "CONFLICT",
          `Kanal oder Account ${id} existiert bereits`
        )
      this.ctx.db.insert(channels).values(values).run()
      const row = getById(this.ctx, channels, id, "Kanal")
      recordHistory(this.ctx, {
        actor,
        entity: "channel",
        entityId: id,
        action: "create",
        after: values,
      })
      return channelView(row)
    })
  }

  update(id: string, raw: unknown, actor: string): ChannelView {
    const input = body(raw)
    onlyKeys(input, ["kind", "status", ...FIELDS])
    const patch: Record<string, unknown> = {
      kind: optOneOf(input, "kind", CHANNEL_KINDS),
      status: optOneOf(input, "status", CHANNEL_STATUSES),
    }
    for (const f of FIELDS) patch[f] = optString(input, f)
    return this.database.tx(() => {
      const row = this.ctx.db
        .select()
        .from(channels)
        .where(eq(channels.id, id))
        .get()
      if (!row) {
        if (virtualChannels(this.ctx).some((c) => c.id === id))
          throw new VGError(
            "INVALID",
            `${id} ist ein TikTok-Account; Änderungen über accounts update`
          )
        throw new VGError("NOT_FOUND", `Kanal ${id} nicht gefunden`)
      }
      return channelView(
        patchRow(this.ctx, channels, "channel", id, patch, actor)
      )
    })
  }
}
