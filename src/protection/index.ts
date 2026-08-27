import {
  ChannelType,
  Colors,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Message,
  SlashCommandBuilder,
} from 'discord.js'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { guildSettings } from '../db/schema'
import { addAudit } from '../moderation/service'

type ProtectionMode = 'standard' | 'strict' | 'custom'
type ProtectionConfig = {
  mode: ProtectionMode
  lockdown: boolean
  antiRaid: boolean
  antiBot: boolean
  antiNuke: boolean
  whitelist: string[]
  logChannelId?: string
}

type PermissionBackup = Record<string, { sendMessages: boolean | null; createInstantInvite: boolean | null }>

const defaults: ProtectionConfig = { mode: 'standard', lockdown: false, antiRaid: false, antiBot: false, antiNuke: false, whitelist: [] }
const backups = new Map<string, PermissionBackup>()
const threatCounts = new Map<string, number>()

async function getConfig(guildId: string) {
  const rows = await db.select({ commandConfig: guildSettings.commandConfig }).from(guildSettings).where(eq(guildSettings.guildId, guildId)).limit(1)
  const protection = rows[0]?.commandConfig?.protection as Partial<ProtectionConfig> | undefined
  return { ...defaults, ...protection, whitelist: protection?.whitelist ?? [] }
}

async function saveConfig(guildId: string, config: ProtectionConfig) {
  await db.insert(guildSettings).values({ guildId, commandConfig: { protection: config } }).onConflictDoUpdate({ target: guildSettings.guildId, set: { commandConfig: { protection: config }, updatedAt: new Date() } })
}

function isAuthorized(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.member) return false
  const member = interaction.member as GuildMember
  return interaction.guild.ownerId === interaction.user.id || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)
}

export const protectionCommands = new SlashCommandBuilder().setName('protection').setDescription('Configure Alya server protection').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s => s.setName('setup').setDescription('Configure server protection').addStringOption(o => o.setName('mode').setDescription('Protection mode').setRequired(true).addChoices({ name: 'Standard', value: 'standard' }, { name: 'Strict', value: 'strict' }, { name: 'Custom', value: 'custom' })))
  .addSubcommand(s => s.setName('status').setDescription('Show security health'))
  .addSubcommand(s => s.setName('lockdown').setDescription('Disable messaging and invites').addStringOption(o => o.setName('reason').setDescription('Reason')))
  .addSubcommand(s => s.setName('unlock').setDescription('Restore pre-lockdown permissions'))
  .addSubcommand(s => s.setName('anti-raid').setDescription('Toggle anti-raid').addStringOption(o => o.setName('status').setDescription('Status').setRequired(true).addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })))
  .addSubcommand(s => s.setName('anti-bot').setDescription('Toggle anti-bot').addStringOption(o => o.setName('status').setDescription('Status').setRequired(true).addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })))
  .addSubcommand(s => s.setName('anti-nuke').setDescription('Toggle anti-nuke').addStringOption(o => o.setName('status').setDescription('Status').setRequired(true).addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })))
  .addSubcommand(s => s.setName('whitelist').setDescription('Manage protection whitelist').addStringOption(o => o.setName('action').setDescription('Action').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' })).addUserOption(o => o.setName('user').setDescription('Trusted user')))
  .addSubcommand(s => s.setName('logs').setDescription('Set security log channel').addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand(s => s.setName('scan').setDescription('Scan members for suspicious profiles'))

function bar(score: number) { const filled = Math.round(score / 10); return `[${'█'.repeat(filled)}${'─'.repeat(10 - filled)}] ${score}%` }

async function lockdown(guild: Guild, enabled: boolean) {
  if (enabled) {
    const backup: PermissionBackup = {}
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isTextBased() || !('permissionOverwrites' in channel)) continue
      const permissionOverwrites = (channel as import('discord.js').GuildChannel).permissionOverwrites
      const everyone = permissionOverwrites.cache.get(guild.roles.everyone.id)
      backup[channel.id] = { sendMessages: everyone?.allow.has(PermissionFlagsBits.SendMessages) ?? null, createInstantInvite: everyone?.allow.has(PermissionFlagsBits.CreateInstantInvite) ?? null }
      await permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, CreateInstantInvite: false }).catch(() => undefined)
    }
    backups.set(guild.id, backup)
    return
  }
  const backup = backups.get(guild.id)
  if (!backup) return
  for (const [channelId, permissions] of Object.entries(backup)) {
    const channel = guild.channels.cache.get(channelId)
    if (!channel || !('permissionOverwrites' in channel)) continue
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: permissions.sendMessages, CreateInstantInvite: permissions.createInstantInvite }).catch(() => undefined)
  }
  backups.delete(guild.id)
}

export async function handleProtection(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true })
  if (!isAuthorized(interaction)) return interaction.reply({ content: 'Only the server owner or an authorized administrator can use Protection.', ephemeral: true })
  const name = interaction.options.getSubcommand(); const current = await getConfig(interaction.guild.id)
  if (name === 'status') { const enabled = [current.antiRaid, current.antiBot, current.antiNuke].filter(Boolean).length; const score = Math.min(100, 25 + enabled * 20 + (current.mode === 'strict' ? 15 : 0)); return interaction.reply({ embeds: [{ color: Colors.Blurple, title: 'Protection Status', description: `${bar(score)} Security\n\nMode: **${current.mode}**\nActive defenses: **${enabled}/3**\nRecent threats: **${threatCounts.get(interaction.guild.id) ?? 0}**\nLockdown: **${current.lockdown ? 'active' : 'clear'}**` }], ephemeral: true }) }
  if (name === 'setup') { const mode = interaction.options.getString('mode', true) as ProtectionMode; const next = { ...current, mode, antiRaid: mode !== 'custom', antiBot: mode !== 'custom', antiNuke: mode === 'strict' }; await saveConfig(interaction.guild.id, next); await addAudit(interaction.guild.id, 'protection.setup', interaction.user.id, { mode }); return interaction.reply({ embeds: [{ color: Colors.Blurple, title: 'Protection Setup Complete', description: `**${mode}** mode enabled with anti-raid, anti-bot, and anti-nuke defaults.` }], ephemeral: true }) }
  if (name === 'lockdown' || name === 'unlock') { const enabled = name === 'lockdown'; await lockdown(interaction.guild, enabled); const next = { ...current, lockdown: enabled }; await saveConfig(interaction.guild.id, next); await addAudit(interaction.guild.id, `protection.${name}`, interaction.user.id, { reason: interaction.options.getString('reason') }); return interaction.reply({ embeds: [{ color: enabled ? 0xff0033 : 0x2ecc71, title: enabled ? 'SERVER LOCKDOWN ACTIVATED' : 'Lockdown Lifted', description: enabled ? 'Messaging and invites are paused. Original permissions are backed up.' : 'Channel permissions and invites were restored.' }] }) }
  if (name === 'logs') { const channelId = interaction.options.getChannel('channel')?.id; const next = { ...current, logChannelId: channelId }; await saveConfig(interaction.guild.id, next); return interaction.reply({ content: channelId ? `Security alerts will be sent to <#${channelId}>.` : 'No log channel selected.', ephemeral: true }) }
  if (name === 'whitelist') { const action = interaction.options.getString('action', true); const userId = interaction.options.getUser('user')?.id; const whitelist = [...current.whitelist]; if (action === 'add' && userId && !whitelist.includes(userId)) whitelist.push(userId); if (action === 'remove' && userId) { const index = whitelist.indexOf(userId); if (index >= 0) whitelist.splice(index, 1) }; if (action === 'list') return interaction.reply({ embeds: [{ color: 0x4169e1, title: 'Protection Whitelist', description: whitelist.length ? whitelist.map(id => `<@${id}>`).join('\n') : 'No trusted users configured.' }], ephemeral: true }); await saveConfig(interaction.guild.id, { ...current, whitelist }); return interaction.reply({ content: `Protection whitelist ${action} complete.`, ephemeral: true }) }
  const key = name === 'anti-raid' ? 'antiRaid' : name === 'anti-bot' ? 'antiBot' : 'antiNuke'; const enabled = interaction.options.getString('status', true) === 'on'; await saveConfig(interaction.guild.id, { ...current, [key]: enabled }); await addAudit(interaction.guild.id, `protection.${name}`, interaction.user.id, { enabled }); return interaction.reply({ content: `${name} protection is now ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true })
}

export async function handleProtectionMemberJoin(member: GuildMember) { const config = await getConfig(member.guild.id); if (!config.antiRaid || member.user.bot || config.whitelist.includes(member.id)) return; if ((threatCounts.get(member.guild.id) ?? 0) >= 10) await member.timeout(10 * 60_000, 'Alya anti-raid quarantine').catch(() => undefined) }
export async function handleProtectionBotAdd(member: GuildMember) { const config = await getConfig(member.guild.id); if (config.antiBot && !config.whitelist.includes(member.user.id) && !member.guild.members.me?.permissions.has(PermissionFlagsBits.KickMembers)) return; if (config.antiBot && !config.whitelist.includes(member.user.id)) await member.kick('Unauthorized bot added').catch(() => undefined) }
export async function handleProtectionMessage(message: Message) { if (!message.guild || !message.author.bot) return; const config = await getConfig(message.guild.id); if (config.lockdown) await message.delete().catch(() => undefined) }
export function recordProtectionThreat(guildId: string) { threatCounts.set(guildId, (threatCounts.get(guildId) ?? 0) + 1) }
export async function registerProtectionGuild(guildId: string) { await db.insert(guildSettings).values({ guildId, commandConfig: { protection: defaults } }).onConflictDoNothing() }
