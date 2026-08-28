import { and, eq } from 'drizzle-orm'
import { PermissionFlagsBits, type ChatInputCommandInteraction, type Message, SlashCommandBuilder } from 'discord.js'
import { db } from '../db'
import { guilds, guildSettings } from '../db/schema'
import { addAudit } from '../moderation/service'

export type AutoModConfig = {
  spam?: { enabled: boolean; threshold: number }
  links?: { enabled: boolean; action: 'delete' | 'warn' | 'mute'; allowInvites: boolean }
  words?: { enabled: boolean; entries: string[] }
  mentions?: { enabled: boolean; limit: number; action: 'delete' | 'timeout' | 'ban' }
  caps?: { enabled: boolean; percentage: number; action: 'delete' | 'warn' | 'mute' }
  raids?: { enabled: boolean; sensitivity: 'low' | 'medium' | 'strict' }
}

const defaults: AutoModConfig = { spam: { enabled: false, threshold: 6 }, links: { enabled: false, action: 'delete', allowInvites: false }, words: { enabled: false, entries: [] }, mentions: { enabled: false, limit: 5, action: 'delete' }, caps: { enabled: false, percentage: 70, action: 'warn' }, raids: { enabled: false, sensitivity: 'medium' } }
const recentMessages = new Map<string, { content: string; at: number }[]>()
const joins = new Map<string, number[]>()

async function getConfig(guildId: string) {
  const row = await db.select({ commandConfig: guildSettings.commandConfig }).from(guildSettings).where(eq(guildSettings.guildId, guildId)).limit(1)
  return { ...defaults, ...(row[0]?.commandConfig?.automod as unknown as AutoModConfig | undefined) }
}

async function saveConfig(guildId: string, next: AutoModConfig) {
  await db.insert(guildSettings).values({ guildId, commandConfig: { automod: next } }).onConflictDoUpdate({ target: guildSettings.guildId, set: { commandConfig: { automod: next }, updatedAt: new Date() } })
}

function isStaff(message: Message) {
  return message.member?.permissions.has(PermissionFlagsBits.ManageGuild) || message.member?.permissions.has(PermissionFlagsBits.Administrator)
}

export const automodCommands = new SlashCommandBuilder().setName('automod').setDescription('Configure Alya AutoMod').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub => sub.setName('setup').setDescription('Enable AutoMod setup wizard').addChannelOption(o => o.setName('channel').setDescription('Log channel')))
  .addSubcommand(sub => sub.setName('spam').setDescription('Configure spam filtering').addStringOption(o => o.setName('status').setDescription('On or Off').setRequired(true).addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })).addIntegerOption(o => o.setName('threshold').setDescription('Messages per minute').setMinValue(2).setMaxValue(30)))
  .addSubcommand(sub => sub.setName('links').setDescription('Configure link filtering').addStringOption(o => o.setName('status').setDescription('On or Off').setRequired(true).addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })).addStringOption(o => o.setName('action').setDescription('Punishment').addChoices({ name: 'Delete', value: 'delete' }, { name: 'Warn', value: 'warn' }, { name: 'Mute', value: 'mute' })))
  .addSubcommand(sub => sub.setName('words').setDescription('Manage blocked words').addStringOption(o => o.setName('action').setDescription('Operation').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' })).addStringOption(o => o.setName('word').setDescription('Word or pattern')))
  .addSubcommand(sub => sub.setName('mentions').setDescription('Limit mentions').addIntegerOption(o => o.setName('limit').setDescription('Maximum mentions').setRequired(true).setMinValue(1).setMaxValue(30)).addStringOption(o => o.setName('action').setDescription('Punishment').addChoices({ name: 'Delete', value: 'delete' }, { name: 'Timeout', value: 'timeout' }, { name: 'Ban', value: 'ban' })))
  .addSubcommand(sub => sub.setName('caps').setDescription('Configure excessive caps filtering').addIntegerOption(o => o.setName('percentage').setDescription('Caps percentage').setRequired(true).setMinValue(1).setMaxValue(100)).addStringOption(o => o.setName('action').setDescription('Punishment').addChoices({ name: 'Delete', value: 'delete' }, { name: 'Warn', value: 'warn' }, { name: 'Mute', value: 'mute' })))
  .addSubcommand(sub => sub.setName('raids').setDescription('Configure raid defense').addStringOption(o => o.setName('status').setDescription('On or Off').setRequired(true).addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })).addStringOption(o => o.setName('sensitivity').setDescription('Sensitivity').addChoices({ name: 'Low', value: 'low' }, { name: 'Medium', value: 'medium' }, { name: 'Strict', value: 'strict' })))
  .addSubcommand(sub => sub.setName('actions').setDescription('Show active AutoMod actions').addStringOption(o => o.setName('rule').setDescription('Rule name').setRequired(true)))

export async function handleAutoMod(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true })
  const current = await getConfig(interaction.guild.id)
  const name = interaction.options.getSubcommand()
  if (name === 'setup') { const next = { ...defaults, ...current, spam: { enabled: true, threshold: 6 }, links: { enabled: true, action: 'delete' as const, allowInvites: false }, words: { enabled: false, entries: [] } }; await saveConfig(interaction.guild.id, next); await addAudit(interaction.guild.id, 'automod.setup', interaction.user.id, { channelId: interaction.options.getChannel('channel')?.id }); return interaction.reply({ content: 'AutoMod setup enabled. Spam and link protection are active.', ephemeral: true }) }
  if (name === 'actions') return interaction.reply({ content: Object.entries(current).filter(([, value]) => value && typeof value === 'object' && 'enabled' in value).map(([rule, value]) => `${rule}: ${(value as { enabled: boolean }).enabled ? 'enabled' : 'disabled'}`).join('\n') || 'No AutoMod rules configured.', ephemeral: true })
  const next = structuredClone(current)
  if (name === 'spam') next.spam = { enabled: interaction.options.getString('status', true) === 'on', threshold: interaction.options.getInteger('threshold') ?? current.spam?.threshold ?? 6 }
  if (name === 'links') next.links = { enabled: interaction.options.getString('status', true) === 'on', action: (interaction.options.getString('action') as 'delete' | 'warn' | 'mute') ?? current.links?.action ?? 'delete', allowInvites: current.links?.allowInvites ?? false }
  if (name === 'mentions') next.mentions = { enabled: true, limit: interaction.options.getInteger('limit', true), action: (interaction.options.getString('action') as 'delete' | 'timeout' | 'ban') ?? 'delete' }
  if (name === 'caps') next.caps = { enabled: true, percentage: interaction.options.getInteger('percentage', true), action: (interaction.options.getString('action') as 'delete' | 'warn' | 'mute') ?? 'warn' }
  if (name === 'raids') next.raids = { enabled: interaction.options.getString('status', true) === 'on', sensitivity: (interaction.options.getString('sensitivity') as 'low' | 'medium' | 'strict') ?? 'medium' }
  if (name === 'words') { const action = interaction.options.getString('action', true); const word = interaction.options.getString('word')?.trim().toLowerCase(); const entries = [...(current.words?.entries ?? [])]; if (action === 'add' && word && !entries.includes(word)) entries.push(word); if (action === 'remove' && word) entries.splice(entries.indexOf(word), 1); if (action === 'list') return interaction.reply({ content: entries.length ? entries.map(item => `||${item}||`).join(', ') : 'No blocked words.', ephemeral: true }); next.words = { enabled: entries.length > 0, entries } }
  await saveConfig(interaction.guild.id, next); await addAudit(interaction.guild.id, `automod.${name}`, interaction.user.id, { config: next[name as keyof AutoModConfig] }); return interaction.reply({ content: `AutoMod ${name} rule updated.`, ephemeral: true })
}

export async function handleAutoModMessage(message: Message) {
  if (!message.guild || message.author.bot || isStaff(message)) return
  const settings = await getConfig(message.guild.id)
  const now = Date.now(); const history = (recentMessages.get(message.author.id) ?? []).filter(item => now - item.at < 60_000); history.push({ content: message.content, at: now }); recentMessages.set(message.author.id, history)
  const spam = settings.spam; const same = history.filter(item => item.content === message.content).length
  if (spam?.enabled && (history.length >= spam.threshold || same >= 3)) { await message.delete().catch(() => undefined); await message.member?.timeout(10 * 60_000, 'AutoMod spam filter').catch(() => undefined); return }
  if (settings.links?.enabled && /(https?:\/\/|www\.|discord\.gg\/)/i.test(message.content)) { const trusted = /(youtube\.com|youtu\.be|tenor\.com|spotify\.com)/i.test(message.content); if (!trusted) { if (settings.links.action !== 'warn') await message.delete().catch(() => undefined); if (settings.links.action === 'mute') await message.member?.timeout(10 * 60_000, 'AutoMod link filter').catch(() => undefined); return } }
  if (settings.words?.enabled && settings.words.entries.some(word => message.content.toLowerCase().includes(word.replaceAll('*', '')))) { await message.delete().catch(() => undefined); return }
  if (settings.mentions?.enabled && message.mentions.users.size > settings.mentions.limit) { await message.delete().catch(() => undefined); return }
  if (settings.caps?.enabled && message.content.length > 15) { const letters = message.content.replace(/[^a-z]/gi, ''); const caps = letters ? (letters.replace(/[^A-Z]/g, '').length / letters.length) * 100 : 0; if (caps >= settings.caps.percentage) await message.delete().catch(() => undefined) }
}

export function trackGuildJoin(guildId: string) { const now = Date.now(); const recent = (joins.get(guildId) ?? []).filter(at => now - at < 10_000); recent.push(now); joins.set(guildId, recent); return recent.length }

export async function registerGuild(guildId: string, guildName: string, ownerUserId: string) { await db.insert(guilds).values({ guildId, guildName, ownerUserId }).onConflictDoUpdate({ target: guilds.guildId, set: { guildName, ownerUserId, updatedAt: new Date() } }) }
