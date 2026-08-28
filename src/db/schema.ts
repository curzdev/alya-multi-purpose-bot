import { bigint, boolean, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

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

export const reminders = pgTable('alya_reminders', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  guildId: text('guild_id'),
  channelId: text('channel_id').notNull(),
  message: text('message').notNull(),
  remindAt: timestamp('remind_at', { withTimezone: true }).notNull(),
  repeatRule: text('repeat_rule'),
  timezone: text('timezone').default('UTC').notNull(),
  delivery: text('delivery').default('channel').notNull(),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const achievements = pgTable('alya_achievements', {
  id: text('id').primaryKey(),
  guildId: text('guild_id'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  iconUrl: text('icon_url'),
  triggerType: text('trigger_type').notNull(),
  triggerTargetValue: integer('trigger_target_value').default(1).notNull(),
  rewardRoleId: text('reward_role_id'),
  rewardXp: integer('reward_xp').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ achievementUnique: unique().on(table.guildId, table.title) }))

export const userAchievements = pgTable('alya_user_achievements', {
  userId: text('user_id').notNull(),
  guildId: text('guild_id').notNull(),
  achievementId: text('achievement_id').notNull(),
  unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
  progress: integer('progress').default(0).notNull(),
}, (table) => ({ achievementKey: primaryKey({ columns: [table.userId, table.guildId, table.achievementId] }) }))

export const events = pgTable('alya_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  guildId: text('guild_id').notNull(),
  discordEventId: text('discord_event_id'),
  title: text('title').notNull(),
  description: text('description'),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  channelId: text('channel_id'),
  createdBy: text('created_by').notNull(),
  maxSlots: integer('max_slots'),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const eventRsvps = pgTable('alya_event_rsvps', {
  eventId: uuid('event_id').notNull(),
  userId: text('user_id').notNull(),
  status: text('status').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ eventUser: primaryKey({ columns: [table.eventId, table.userId] }) }))

export const userInvites = pgTable('alya_user_invites', {
  guildId: text('guild_id').notNull(),
  userId: text('user_id').notNull(),
  regular: integer('regular').default(0).notNull(),
  leftCount: integer('left_count').default(0).notNull(),
  fake: integer('fake').default(0).notNull(),
  bonus: integer('bonus').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userGuild: primaryKey({ columns: [table.guildId, table.userId] }) }))

export const inviteCodes = pgTable('alya_invite_codes', {
  code: text('code').primaryKey(),
  guildId: text('guild_id').notNull(),
  inviterId: text('inviter_id').notNull(),
  uses: integer('uses').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const inviteRewards = pgTable('alya_invite_rewards', {
  guildId: text('guild_id').notNull(),
  invitesNeeded: integer('invites_needed').notNull(),
  roleId: text('role_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ rewardKey: primaryKey({ columns: [table.guildId, table.invitesNeeded] }) }))

export const ticketCategories = pgTable('alya_ticket_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  guildId: text('guild_id').notNull(),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  emoji: text('emoji'),
  supportRoleId: text('support_role_id'),
  parentCategoryId: uuid('parent_category_id'),
  namingFormat: text('naming_format').default('ticket-{number}').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ categoryUnique: unique().on(table.guildId, table.name) }))

export const tickets = pgTable('alya_tickets', {
  ticketId: uuid('ticket_id').primaryKey().defaultRandom(),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull().unique(),
  userId: text('user_id').notNull(),
  categoryId: uuid('category_id'),
  status: text('status').default('open').notNull(),
  claimedBy: text('claimed_by'),
  transcriptUrl: text('transcript_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
})

export const reactionPanels = pgTable('alya_reaction_panels', {
  messageId: text('message_id').primaryKey(),
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  mode: text('mode').default('normal').notNull(),
  title: text('title'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const reactionRoles = pgTable('alya_reaction_roles', {
  messageId: text('message_id').notNull(),
  roleId: text('role_id').notNull(),
  emojiIdentifier: text('emoji_identifier').notNull(),
  position: integer('position').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ roleKey: primaryKey({ columns: [table.messageId, table.roleId] }) }))

export const logSettings = pgTable('alya_log_settings', {
  guildId: text('guild_id').primaryKey(),
  auditChannelId: text('audit_channel_id'),
  errorChannelId: text('error_channel_id'),
  enabledEvents: jsonb('enabled_events').$type<string[]>().default([]).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const systemLogs = pgTable('alya_system_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  guildId: text('guild_id').notNull(),
  type: text('type').notNull(),
  eventName: text('event_name').notNull(),
  message: text('message').notNull(),
  stackTrace: text('stack_trace'),
  actorUserId: text('actor_user_id'),
  targetUserId: text('target_user_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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

export type Achievement = typeof achievements.$inferSelect
export type UserAchievement = typeof userAchievements.$inferSelect

export type Event = typeof events.$inferSelect
export type EventRsvp = typeof eventRsvps.$inferSelect

export const schema = { guilds, guildSettings, moderationCases, auditLogs, logSettings, systemLogs, userLevels, guildLevelSettings, achievements, userAchievements, events, eventRsvps, userInvites, inviteCodes, inviteRewards, ticketCategories, tickets, reactionPanels, reactionRoles }
