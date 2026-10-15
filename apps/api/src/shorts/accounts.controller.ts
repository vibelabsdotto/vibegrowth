import { Controller, Get, Param, Patch, Post, Query as Q } from "@nestjs/common"
import { Actor } from "../common/actor.decorator"
import * as cat from "../core/catalog"
import { activeFormat } from "../core/context"
import * as know from "../core/knowledge"
import { accountStats } from "../core/metrics"
import { unregisteredPostDirs } from "../core/posts"
import { VSError } from "../core/util"
import { DatabaseService } from "../database/database.service"
import { brandOf, Input, type Query } from "./params"

type AccountCreateBody = cat.AccountInput & {
  /** Web: create the character in the same transaction and link it. */
  newCharacter?: cat.CharacterInput
}
type AccountPatchBody = Partial<Omit<cat.AccountInput, "id" | "brandId">> & {
  reason?: string | null
}
type CharacterBody = cat.CharacterInput & { account?: string }
type CharacterPatchBody = Partial<Omit<cat.CharacterInput, "id" | "sourceKey">>

@Controller("accounts")
export class AccountsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list(@Q() q: Query) {
    return cat.listAccounts(this.db.ctx, {
      brandId: brandOf(q),
      status: q.status,
    })
  }

  /** `accounts show` composition from the old CLI. */
  @Get(":id")
  show(@Param("id") id: string) {
    const c = this.db.ctx
    const a = cat.getAccount(c, id)
    const active = activeFormat(c, id)
    return {
      ...a,
      activeFormat: active.format
        ? {
            id: active.format.id,
            name: active.format.name,
            version: active.format.currentVersion,
            source: active.source,
          }
        : null,
      character: a.characterId ? cat.getCharacter(c, a.characterId) : null,
      rules: cat.listRules(c, {
        scopeType: "account",
        scopeId: id,
        status: "active",
      }),
      learnings: know.listLearnings(c, { accountId: id, status: "active" }),
      stats: accountStats(c, id),
      unregisteredPostDirs: unregisteredPostDirs(c, id),
    }
  }

  @Post()
  create(@Input() body: AccountCreateBody, @Actor() actor: string) {
    const { newCharacter, ...input } = body
    return this.db.tx(() => {
      const c = this.db.ctx
      if (newCharacter)
        input.characterId = cat.createCharacter(c, newCharacter, actor).id
      return cat.createAccount(c, input, actor)
    })
  }

  /** `accounts update`: format switch as pivot (reason), then the remaining fields. */
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Input() body: AccountPatchBody,
    @Actor() actor: string
  ) {
    const { defaultFormatId, reason, ...rest } = body
    return this.db.tx(() => {
      const c = this.db.ctx
      if (reason !== undefined && defaultFormatId === undefined)
        throw new VSError("INVALID", "--reason gehört zu --format")
      const pivot =
        defaultFormatId === undefined
          ? null
          : know.setActiveFormat(c, id, defaultFormatId, reason, actor)
      const account = cat.updateAccount(c, id, rest, actor)
      return pivot ? { ...account, pivot } : account
    })
  }
}

@Controller("characters")
export class CharactersController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list() {
    return cat.listCharacters(this.db.ctx)
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return cat.getCharacter(this.db.ctx, id)
  }

  /** `characters add [--account]`: create, optionally link to an account. */
  @Post()
  create(@Input() body: CharacterBody, @Actor() actor: string) {
    const { account, ...input } = body
    return this.db.tx(() => {
      const c = this.db.ctx
      const ch = cat.createCharacter(c, input, actor)
      if (account) cat.updateAccount(c, account, { characterId: ch.id }, actor)
      return ch
    })
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Input() body: CharacterPatchBody,
    @Actor() actor: string
  ) {
    return this.db.tx(() => cat.updateCharacter(this.db.ctx, id, body, actor))
  }

  @Post(":id/images")
  addImage(
    @Param("id") id: string,
    @Input() body: { path: string },
    @Actor() actor: string
  ) {
    return this.db.tx(() =>
      cat.addCharacterImage(this.db.ctx, id, body.path, actor)
    )
  }
}
