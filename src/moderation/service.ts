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
  const match = /^(\d+)(s|m|h|d|w)$/i.exec(value)
  if (!match) throw new Error('Duration must look like 30m, 2h, or 7d')
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
  return new Date(Date.now() + Number(match[1]) * units[match[2].toLowerCase() as keyof typeof units])
}
