import { bigint, boolean, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core'

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
  commandConfig: jsonb('command_config').$type<Record<string, unknown>>().default({}).notNull(),
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

export const userLevels = pgTable('alya_user_levels', {
  userId: text('user_id').notNull(),
  guildId: text('guild_id').notNull(),
  xp: bigint('xp', { mode: 'number' }).default(0).notNull(),
  level: integer('level').default(0).notNull(),
  customBackgroundUrl: text('custom_background_url'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userGuild: primaryKey({ columns: [table.userId, table.guildId] }) }))

export const guildLevelSettings = pgTable('alya_guild_level_settings', {
  guildId: text('guild_id').primaryKey(),
  defaultBackgroundUrl: text('default_background_url'),
  xpRate: numeric('xp_rate').default('1').notNull(),
  announcementChannelId: text('announcement_channel_id'),
  stackRoles: boolean('stack_roles').default(true).notNull(),
  excludedChannelIds: jsonb('excluded_channel_ids').$type<string[]>().default([]).notNull(),
  excludedCategoryIds: jsonb('excluded_category_ids').$type<string[]>().default([]).notNull(),
  roleRewards: jsonb('role_rewards').$type<Array<{ level: number; roleId: string }>>().default([]).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

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
export type UserLevel = typeof userLevels.$inferSelect
export type GuildLevelSettings = typeof guildLevelSettings.$inferSelect

export const schema = { guilds, guildSettings, moderationCases, auditLogs, userLevels, guildLevelSettings }
