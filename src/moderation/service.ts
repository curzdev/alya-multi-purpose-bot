import { and, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { auditLogs, moderationCases } from '../db/schema'
import { publishDashboardEvent } from '../dashboard/client'

export type ModerationAction = 'ban' | 'unban' | 'kick' | 'timeout' | 'untimeout' | 'warn' | 'unwarn' | 'purge' | 'slowmode' | 'lock' | 'unlock'

export async function recordCase(input: { guildId: string; action: ModerationAction; targetUserId: string; moderatorUserId: string; reason?: string; expiresAt?: Date; metadata?: Record<string, unknown> }) {
  const caseId = randomUUID().slice(0, 8).toUpperCase()
  const [created] = await db.insert(moderationCases).values({ ...input, caseId, metadata: input.metadata ?? {} }).returning()
  await db.insert(auditLogs).values({ guildId: input.guildId, eventType: `moderation.${input.action}`, actorUserId: input.moderatorUserId, targetUserId: input.targetUserId, payload: { caseId, reason: input.reason, ...input.metadata } })
  await publishDashboardEvent({ type: `moderation.${input.action}`, guildId: input.guildId, actorUserId: input.moderatorUserId, targetUserId: input.targetUserId, payload: { caseId, reason: input.reason, ...input.metadata } })
  return created
}

export async function listCases(guildId: string, limit = 25) {
  return db.select().from(moderationCases).where(eq(moderationCases.guildId, guildId)).orderBy(desc(moderationCases.createdAt)).limit(Math.min(limit, 100))
}

export async function addAudit(guildId: string, eventType: string, actorUserId: string, payload: Record<string, unknown> = {}) {
  await db.insert(auditLogs).values({ guildId, eventType, actorUserId, payload })
  await publishDashboardEvent({ type: eventType, guildId, actorUserId, payload })
}

export function canModerate(actorId: string, targetId: string, guildOwnerId?: string) {
  return actorId !== targetId || actorId === guildOwnerId
}

export function parseDuration(value?: string) {
  if (!value) return undefined
  const match = /^(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)$/i.exec(value.trim())
  if (!match) throw new Error('Duration must look like 30 minutes, 2 hours, or 7 days')

  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const milliseconds = unit.startsWith('s') ? 1_000
    : unit.startsWith('m') ? 60_000
    : unit.startsWith('h') ? 3_600_000
    : unit.startsWith('d') ? 86_400_000
    : 604_800_000
  const duration = amount * milliseconds
  if (amount < 1 || duration > 28 * 86_400_000) throw new Error('Timeouts must be between 1 second and 28 days')
  return new Date(Date.now() + duration)
}
