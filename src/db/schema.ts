import { bigint, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

export const guilds = pgTable('alya_guilds', {
  guildId: text('guild_id').primaryKey(),
  guildName: text('guild_name').notNull(),
  ownerUserId: text('owner_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const guildSettings = pgTable('alya_guild_settings', {
  guildId: text('guild_id').primaryKey(),
  logChannelId: text('log_channel_id'),
  modRoleId: text('mod_role_id'),
  commandConfig: jsonb('command_config').$type<Record<string, boolean>>().default({}).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const moderationCases = pgTable('alya_moderation_cases', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  guildId: text('guild_id').notNull(),
  caseId: text('case_id').notNull(),
  action: text('action').notNull(),
  targetUserId: text('target_user_id').notNull(),
  moderatorUserId: text('moderator_user_id').notNull(),
  reason: text('reason'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
}, (table) => ({ caseUnique: unique().on(table.guildId, table.caseId) }))

export const auditLogs = pgTable('alya_audit_logs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  guildId: text('guild_id').notNull(),
  eventType: text('event_type').notNull(),
  actorUserId: text('actor_user_id'),
  targetUserId: text('target_user_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type ModerationCase = typeof moderationCases.$inferSelect
export type NewModerationCase = typeof moderationCases.$inferInsert
export type AuditLog = typeof auditLogs.$inferSelect
export type GuildSettings = typeof guildSettings.$inferSelect

export const schema = { guilds, guildSettings, moderationCases, auditLogs }
