import { and, desc, eq } from 'drizzle-orm'
import { ChannelType, EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction, type Client, type Guild, type GuildMember, type TextBasedChannel } from 'discord.js'
import { db } from '../db'
import { logSettings, systemLogs } from '../db/schema'
import { publishDashboardEvent } from '../dashboard/client'

const DEFAULT_EVENTS = ['messages', 'channels', 'roles', 'voice', 'moderation', 'nicknames']
const EVENT_ALIASES: Record<string, string> = { message: 'messages', messages: 'messages', channel: 'channels', channels: 'channels', role: 'roles', roles: 'roles', voice: 'voice', moderation: 'moderation', nickname: 'nicknames', nicknames: 'nicknames' }

export const loggingCommands = {
  name: 'logs',
  description: 'Configure Alya audit and error logging',
  toJSON() { return { name: this.name, description: this.description, options: [
    { type: 1, name: 'setup', description: 'Set the audit log channel', options: [{ type: 7, name: 'channel', description: 'Audit channel', channel_types: [0] }] },
    { type: 1, name: 'errors', description: 'Set the error log channel', options: [{ type: 7, name: 'channel', description: 'Error channel', channel_types: [0] }] },
    { type: 1, name: 'toggle', description: 'Enable or disable an event category', options: [{ type: 3, name: 'event', description: 'Event category', required: true, choices: DEFAULT_EVENTS.map(name => ({ name, value: name })) }, { type: 5, name: 'status', description: 'Whether logging is enabled', required: true }] },
    { type: 1, name: 'status', description: 'View the current logging setup' },
  ] } },
}

async function getSettings(guildId: string) {
  const [existing] = await db.select().from(logSettings).where(eq(logSettings.guildId, guildId)).limit(1)
  return existing ?? { guildId, auditChannelId: null, errorChannelId: null, enabledEvents: DEFAULT_EVENTS }
}

function canManage(interaction: ChatInputCommandInteraction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false
}

export async function handleLogging(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !canManage(interaction)) return interaction.reply({ content: 'You need Manage Server to configure logging.', ephemeral: true })
  const guildId = interaction.guildId
  const subcommand = interaction.options.getSubcommand()
  const current = await getSettings(guildId)
  if (subcommand === 'setup' || subcommand === 'errors') {
    const channel = interaction.options.getChannel('channel', true)
    const values = subcommand === 'setup' ? { auditChannelId: channel.id } : { errorChannelId: channel.id }
    await db.insert(logSettings).values({ guildId, auditChannelId: current.auditChannelId, errorChannelId: current.errorChannelId, enabledEvents: current.enabledEvents, ...values }).onConflictDoUpdate({ target: logSettings.guildId, set: { ...values, updatedAt: new Date() } })
    await interaction.reply({ content: `${subcommand === 'setup' ? 'Audit' : 'Error'} logging channel set to <#${channel.id}>.`, ephemeral: true })
    return
  }
  if (subcommand === 'toggle') {
    const event = EVENT_ALIASES[interaction.options.getString('event', true)] ?? interaction.options.getString('event', true)
    const enabled = interaction.options.getBoolean('status', true)
    const events = new Set(current.enabledEvents)
    enabled ? events.add(event) : events.delete(event)
    await db.insert(logSettings).values({ guildId, auditChannelId: current.auditChannelId, errorChannelId: current.errorChannelId, enabledEvents: [...events] }).onConflictDoUpdate({ target: logSettings.guildId, set: { enabledEvents: [...events], updatedAt: new Date() } })
    await interaction.reply({ content: `${event} logging ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true })
    return
  }
  await interaction.reply({ content: `Audit channel: ${current.auditChannelId ? `<#${current.auditChannelId}>` : 'not configured'}\nError channel: ${current.errorChannelId ? `<#${current.errorChannelId}>` : 'not configured'}\nEnabled events: ${current.enabledEvents.join(', ') || 'none'}`, ephemeral: true })
}

async function persistLog(guildId: string, type: 'AUDIT' | 'ERROR' | 'PERMISSION', eventName: string, message: string, stackTrace?: string, actorUserId?: string, targetUserId?: string, payload: Record<string, unknown> = {}) {
  await db.insert(systemLogs).values({ guildId, type, eventName, message, stackTrace: stackTrace ?? null, actorUserId: actorUserId ?? null, targetUserId: targetUserId ?? null, payload })
  void publishDashboardEvent({ type: `logging.${type.toLowerCase()}`, guildId, actorUserId, targetUserId, payload: { eventName, message, stackTrace, ...payload } })
}

export async function emitAudit(guild: Guild, eventName: string, message: string, actorUserId?: string, targetUserId?: string, payload: Record<string, unknown> = {}) {
  const settings = await getSettings(guild.id)
  const category = EVENT_ALIASES[eventName] ?? eventName
  if (!settings.enabledEvents.includes(category) || !settings.auditChannelId) return
  await persistLog(guild.id, 'AUDIT', eventName, message, undefined, actorUserId, targetUserId, payload)
  const channel = await guild.channels.fetch(settings.auditChannelId).catch(() => null)
  if (!channel?.isTextBased()) return
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`Audit: ${eventName}`).setDescription(message).addFields({ name: 'Guild', value: guild.name, inline: true }, { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true })
  if (actorUserId) embed.addFields({ name: 'Executor', value: `<@${actorUserId}> (${actorUserId})` })
  if (targetUserId) embed.addFields({ name: 'Target', value: `<@${targetUserId}> (${targetUserId})` })
  await (channel as any).send({ embeds: [embed] }).catch(() => undefined)
}

export async function emitError(guild: Guild | null, error: unknown, context: { eventName: string; message?: string; actorUserId?: string; targetUserId?: string; payload?: Record<string, unknown> }) {
  if (!guild) return
  const settings = await getSettings(guild.id)
  const message = context.message ?? (error instanceof Error ? error.message : String(error))
  const stack = error instanceof Error ? error.stack : undefined
  await persistLog(guild.id, 'ERROR', context.eventName, message, stack, context.actorUserId, context.targetUserId, context.payload)
  if (!settings.errorChannelId) return
  const channel = await guild.channels.fetch(settings.errorChannelId).catch(() => null)
  if (!channel?.isTextBased()) return
  const stackValue = ['```', (stack ?? 'No stack trace').slice(0, 3800), '```'].join('\\n')
  const embed = new EmbedBuilder().setColor(0xed4245).setTitle(`Alya error: ${context.eventName}`).setDescription(message.slice(0, 4000)).addFields({ name: 'Stack trace', value: stackValue })
  await (channel as any).send({ embeds: [embed] }).catch(() => undefined)
}

export async function emitPermissionFailure(guild: Guild | null, error: unknown, context: { command: string; channelId?: string; actorUserId?: string; targetUserId?: string }) {
  return emitError(guild, error, { eventName: 'permission_failure', message: `Command ${context.command} failed in <#${context.channelId ?? 'unknown'}>. Missing or denied permissions.`, actorUserId: context.actorUserId, targetUserId: context.targetUserId, payload: context })
}

export async function handleLoggingInteractionEvents(client: Client) {
  client.on('messageUpdate', (oldMessage, newMessage) => { if (newMessage.guild) void emitAudit(newMessage.guild, 'messages', `Message edited in <#${newMessage.channelId}>`, oldMessage.author?.id, newMessage.author?.id, { messageId: newMessage.id }) })
  client.on('messageDelete', message => { if (message.guild) void emitAudit(message.guild, 'messages', `Message deleted in <#${message.channelId}>`, undefined, message.author?.id, { messageId: message.id }) })
  client.on('channelCreate', channel => { if ('guild' in channel && channel.guild) void emitAudit(channel.guild, 'channels', `Channel created: ${channel.name}`, undefined, undefined, { channelId: channel.id, type: channel.type }) })
  client.on('channelDelete', channel => { if ('guild' in channel && channel.guild) void emitAudit(channel.guild, 'channels', `Channel deleted: ${channel.name}`, undefined, undefined, { channelId: channel.id, type: channel.type }) })
  client.on('roleUpdate', (oldRole, newRole) => { void emitAudit(newRole.guild, 'roles', `Role updated: ${newRole.name}`, undefined, undefined, { roleId: newRole.id, oldName: oldRole.name }) })
  client.on('voiceStateUpdate', (oldState, newState) => { if (oldState.channelId !== newState.channelId) void emitAudit(newState.guild, 'voice', `Voice state changed: ${oldState.channel?.name ?? 'none'} → ${newState.channel?.name ?? 'none'}`, undefined, newState.id, { oldChannelId: oldState.channelId, newChannelId: newState.channelId }) })
  client.on('guildBanAdd', ban => { void emitAudit(ban.guild, 'moderation', `Member banned: ${ban.user.tag}`, undefined, ban.user.id) })
  client.on('guildBanRemove', ban => { void emitAudit(ban.guild, 'moderation', `Member unbanned: ${ban.user.tag}`, undefined, ban.user.id) })
  client.on('guildMemberUpdate', (oldMember, newMember) => { if (oldMember.nickname !== newMember.nickname) void emitAudit(newMember.guild, 'nicknames', `Nickname changed: ${oldMember.nickname ?? oldMember.user.username} → ${newMember.nickname ?? newMember.user.username}`, undefined, newMember.id) })
  process.on('unhandledRejection', error => { console.error('[alya] unhandled rejection', error) })
  process.on('uncaughtException', error => { console.error('[alya] uncaught exception', error) })
}
