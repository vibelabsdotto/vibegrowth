import { Type } from "class-transformer"
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from "class-validator"

/**
 * Request bodies of the growth work endpoints. Field names follow the stored rows (projectId,
 * channelId …). Enums and references are checked in the services (INVALID/NOT_FOUND), here only
 * types. IsOptional lets null through: nullable fields clear the value, non-nullable fields are
 * rejected in the service.
 */

// ---------- approvals ----------

export class ApprovalCreateDto {
  @IsString() @IsNotEmpty() projectId!: string
  @IsOptional() @IsString() accountId?: string | null
  @IsOptional() @IsString() kind?: string
  @IsString() @IsNotEmpty() title!: string
  @IsOptional() @IsString() body?: string | null
  @IsOptional() @IsObject() payload?: Record<string, unknown>
  @IsOptional() @IsString() refType?: string | null
  @IsOptional()
  @ValidateIf((_, v) => typeof v !== "number")
  @IsString()
  refId?: string | number | null
  @IsOptional() @IsString() category?: string | null
}

export class ApprovalDecideDto {
  @IsString() @IsNotEmpty() decision!: string
  @IsOptional() @IsString() note?: string | null
  /** Changed reply text (kind reply, with approve) */
  @IsOptional() @IsString() text?: string | null
  /** kind reply with reject: "no reply needed" for the item's lastSeen */
  @IsOptional() @IsBoolean() noReply?: boolean | null
}

export class ApprovalReopenDto {
  /** New reply text (kind reply) */
  @IsOptional() @IsString() text?: string | null
  /** New body (kind other) */
  @IsOptional() @IsString() body?: string | null
  /** Why it is open again (shown to Max) */
  @IsOptional() @IsString() note?: string | null
}

export class InboxReplyDto {
  @IsString() @IsNotEmpty() project!: string
  @IsString() @IsNotEmpty() target!: string
  @IsString() @IsNotEmpty() itemId!: string
  @IsString() @IsNotEmpty() text!: string
}

export class InboxNoReplyDto {
  @IsString() @IsNotEmpty() project!: string
  @IsString() @IsNotEmpty() target!: string
  @IsString() @IsNotEmpty() itemId!: string
}

// ---------- content ----------

export class ContentPatchDto {
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() kind?: string
  @IsOptional() @IsString() channelId?: string | null
  @IsOptional() @IsString() keyword?: string | null
  @IsOptional() @IsString() intent?: string | null
  @IsOptional() @IsString() brief?: string | null
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsString() draftPath?: string | null
  @IsOptional() @IsString() urlPath?: string | null
  @IsOptional() @IsString() liveDate?: string | null
  @IsOptional() @IsString() plannedDate?: string | null
  @IsOptional() @IsInt() approvalId?: number | null
  @IsOptional() @IsString() notes?: string | null
  @IsOptional() @IsInt() position?: number
  @IsOptional() @IsString() category?: string | null
}

export class ContentCreateDto extends ContentPatchDto {
  @IsString() @IsNotEmpty() projectId!: string
  @IsOptional() @IsString() sourceKey?: string | null
}

// ---------- backlog ----------

export class BacklogPatchDto {
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() detail?: string | null
  @IsOptional() @IsString() kind?: string
  @IsOptional() @IsInt() impact?: number
  @IsOptional() @IsInt() effort?: number
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsString() source?: string | null
  @IsOptional() @IsString() doneRef?: string | null
  @IsOptional() @IsInt() position?: number
  @IsOptional() @IsString() category?: string | null
  @IsOptional() @IsString() notionUrl?: string | null
  @IsOptional() @IsString() assignee?: string | null
  /** [{type: feature_request|review, id}], checked in the service */
  @IsOptional() @IsArray() sources?:
    { type: "feature_request" | "review"; id: string }[] | null
}

export class BacklogCreateDto extends BacklogPatchDto {
  @IsString() @IsNotEmpty() projectId!: string
  @IsOptional() @IsString() sourceKey?: string | null
}

export class TaskCommentDto {
  @IsString() @IsNotEmpty() body!: string
  /** absolute file paths, copied into the data dir */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  attachments?: string[]
}

export class TaskReportDto extends TaskCommentDto {
  @IsOptional() @IsString() doneRef?: string | null
}

export class TaskAcceptDto {
  @IsOptional() @IsString() body?: string | null
}

export class BacklogReleaseDto {
  @IsString() @IsNotEmpty() projectId!: string
  @IsString() @IsNotEmpty() version!: string
  @IsOptional() @IsArray() @IsInt({ each: true }) ids?: number[]
}

// ---------- experiments & changes ----------

export class ExperimentPatchDto {
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() hypothesis?: string | null
  @IsOptional() @IsString() channelId?: string | null
  @IsOptional() @IsString() targetType?: string
  @IsOptional() @IsString() target?: string | null
  @IsOptional() @IsString() metric?: string
  @IsOptional() @IsString() startDate?: string
  @IsOptional() @IsInt() baselineDays?: number
  @IsOptional() @IsInt() evalDays?: number
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsString() verdict?: string | null
  @IsOptional() @IsString() category?: string | null
}

export class ExperimentCreateDto {
  @IsString() @IsNotEmpty() projectId!: string
  @IsOptional() @IsString() channelId?: string | null
  @IsString() @IsNotEmpty() title!: string
  @IsOptional() @IsString() hypothesis?: string | null
  @IsOptional() @IsString() targetType?: string
  @IsOptional() @IsString() target?: string | null
  @IsString() @IsNotEmpty() metric!: string
  @IsOptional() @IsString() startDate?: string
  @IsOptional() @IsInt() baselineDays?: number
  @IsOptional() @IsInt() evalDays?: number
  @IsOptional() @IsString() sourceKey?: string | null
  @IsOptional() @IsString() category?: string | null
}

export class EvaluateDto {
  @IsOptional() @IsString() project?: string
}

export class ChangeCreateDto {
  @IsString() @IsNotEmpty() projectId!: string
  @IsOptional() @IsString() channelId?: string | null
  @IsOptional() @IsString() date?: string
  @IsOptional() @IsString() kind?: string
  @IsString() @IsNotEmpty() summary!: string
  @IsOptional() @IsString() ref?: string | null
  @IsOptional() @IsInt() experimentId?: number | null
  @IsOptional() @IsString() sourceKey?: string | null
  @IsOptional() @IsString() category?: string | null
}

// ---------- strategies & knowledge ----------

export class StrategyPatchDto {
  @IsOptional() @IsString() projectId?: string | null
  @IsOptional() @IsString() category?: string
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() summary?: string | null
  @IsOptional() @IsString() guide?: string | null
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[]
  @IsOptional() @IsString() source?: string | null
}

export class StrategyCreateDto {
  @IsOptional() @IsString() id?: string
  @IsOptional() @IsString() projectId?: string | null
  @IsString() @IsNotEmpty() category!: string
  @IsString() @IsNotEmpty() name!: string
  @IsOptional() @IsString() summary?: string | null
  @IsOptional() @IsString() guide?: string | null
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[]
  @IsOptional() @IsString() source?: string | null
}

export class KnowledgePatchDto {
  @ValidateIf((_, v) => v !== null)
  @IsString()
  category!: string | null
}

// ---------- app ----------

export class AppPublishDto {
  @IsOptional() @IsString() project?: string
  @IsOptional() @IsBoolean() dryRun?: boolean
}

// ---------- geo & mentions ----------

export class GeoQuestionCreateDto {
  @IsString() @IsNotEmpty() projectId!: string
  @IsString() @IsNotEmpty() text!: string
  @IsOptional() @IsBoolean() active?: boolean
  @IsOptional() @IsString() sourceKey?: string | null
}

export class GeoQuestionPatchDto {
  @IsOptional() @IsString() text?: string
  @IsOptional() @IsBoolean() active?: boolean
}

export class GeoCheckDto {
  @IsOptional() @IsString() projectId?: string
  @IsOptional() @IsString() project?: string
  @IsOptional() @IsInt() questionId?: number
  @IsOptional() @IsString() question?: string
  @IsString() date!: string
  @IsString() engine!: string
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsBoolean() mentioned?: boolean
  @IsOptional() @IsInt() position?: number | null
  @IsOptional() @IsBoolean() cited?: boolean
  @IsOptional() @IsBoolean() inSources?: boolean
  @IsOptional() @IsArray() brands?: string[]
  @IsOptional() @IsArray() competitors?: unknown[]
  @IsOptional() @IsArray() links?: string[]
  @IsOptional() @IsArray() citedUrls?: string[]
  @IsOptional() @IsArray() sources?: (
    { url: string; title?: string | null; domain?: string | null } | string
  )[]
  @IsOptional() @IsString() answer?: string | null
  @IsOptional() @IsString() model?: string | null
  @IsOptional() @IsString() evidence?: string | null
  @IsOptional() @IsObject() meta?: Record<string, unknown>
  @IsOptional() @IsString() error?: string | null
  @IsOptional() @IsString() sourceKey?: string | null
}

export class GeoChecksDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => GeoCheckDto)
  checks!: GeoCheckDto[]
}

export class MentionPatchDto {
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsString() kind?: string
  @IsOptional() @IsString() contact?: string | null
  @IsOptional() @IsString() notes?: string | null
}
