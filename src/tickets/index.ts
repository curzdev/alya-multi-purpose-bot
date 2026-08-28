import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextChannel,
  User,
} from 'discord.js'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { ticketCategories, tickets } from '../db/schema'
import { publishDashboardEvent } from '../dashboard/client'

const ticketCommand = {
  name: 'ticket',
  description: 'Create and manage private support tickets',
  options: [
    { name: 'panel', description: 'Send the ticket creation panel', type: 1, options: [{ name: 'channel', description: 'Channel for the panel', type: 7, required: true, channel_types: [0] }] },
    { name: 'create', description: 'Create a support ticket', type: 1, options: [{ name: 'reason', description: 'Reason for opening the ticket', type: 3 }] },
    { name: 'close', description: 'Close the current ticket', type: 1, options: [{ name: 'reason', description: 'Reason for closing', type: 3 }] },
    { name: 'add', description: 'Add a user to the current ticket', type: 1, options: [{ name: 'user', description: 'User to add', type: 6, required: true }] },
    { name: 'remove', description: 'Remove a user from the current ticket', type: 1, options: [{ name: 'user', description: 'User to remove', type: 6, required: true }] },
    { name: 'transcript', description: 'Generate a transcript for the current ticket', type: 1 },
  ],
  toJSON() { return this },
}

export const ticketCommands = [ticketCommand]

async function getTicket(channelId: string) {
  const rows = await db.select().from(tickets).where(and(eq(tickets.channelId, channelId), eq(tickets.status, 'open'))).limit(1)
  return rows[0]
}

async function categoriesForGuild(guildId: string) {
  return db.select().from(ticketCategories).where(eq(ticketCategories.guildId, guildId)).orderBy(desc(ticketCategories.createdAt))
}

async function createTicket(interaction: ChatInputCommandInteraction, categoryId?: string) {
  if (!interaction.guild || !interaction.channel || interaction.channel.type !== ChannelType.GuildText) throw new Error('Tickets can only be opened in a server.')
  const existing = await getTicketForUser(interaction.guild.id, interaction.user.id)
  if (existing) throw new Error(`You already have an open ticket: <#${existing.channelId}>`)
  const category = categoryId ? (await db.select().from(ticketCategories).where(and(eq(ticketCategories.id, categoryId), eq(ticketCategories.guildId, interaction.guild.id))).limit(1))[0] : undefined
  const number = Date.now().toString().slice(-6)
  const name = (category?.namingFormat || 'ticket-{number}').replace('{number}', number).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90)
  const channel = await interaction.guild.channels.create({ name, type: ChannelType.GuildText, parent: category?.parentCategoryId || undefined, permissionOverwrites: [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: interaction.guild.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    ...(category?.supportRoleId ? [{ id: category.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : []),
  ] })
  const [ticket] = await db.insert(tickets).values({ guildId: interaction.guild.id, channelId: channel.id, userId: interaction.user.id, categoryId: category?.id ?? null }).returning()
  const embed = new EmbedBuilder().setTitle('Support ticket').setDescription(`Opened by <@${interaction.user.id}>${interaction.options.getString('reason') ? `\n\n${interaction.options.getString('reason')}` : ''}`).setColor(0xdc2626)
  await channel.send({ content: category?.supportRoleId ? `<@&${category.supportRoleId}>` : undefined, embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`ticket:claim:${ticket.ticketId}`).setLabel('Claim').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`ticket:close:${ticket.ticketId}`).setLabel('Close').setStyle(ButtonStyle.Danger))] })
  await publishDashboardEvent({ type: 'ticket.created', guildId: interaction.guild.id, actorUserId: interaction.user.id, payload: { ticketId: ticket.ticketId, channelId: channel.id, categoryId: category?.id ?? null } })
  return channel
}

async function getTicketForUser(guildId: string, userId: string) {
  const rows = await db.select().from(tickets).where(and(eq(tickets.guildId, guildId), eq(tickets.userId, userId), eq(tickets.status, 'open'))).limit(1)
  return rows[0]
}

async function transcript(channel: TextChannel) {
  const messages = await channel.messages.fetch({ limit: 100 })
  const body = [...messages.values()].reverse().map(message => `<article><strong>${escapeHtml(message.author.tag)}</strong> <time>${message.createdAt.toISOString()}</time><p>${escapeHtml(message.content || '[embed/attachment]')}</p></article>`).join('\n')
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(channel.name)} transcript</title><style>body{font:14px system-ui;background:#111;color:#eee;max-width:900px;margin:2rem auto}article{border-bottom:1px solid #333;padding:1rem 0}time{color:#999;font-size:12px}p{white-space:pre-wrap}</style><h1>${escapeHtml(channel.name)}</h1>${body}`
}

function escapeHtml(value: string) { return value.replace(/[&<>\"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[character] || character) }

export async function handleTickets(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) throw new Error('This command can only be used in a server.')
  const subcommand = interaction.options.getSubcommand()
  if (subcommand === 'panel') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) throw new Error('Manage Channels permission required.')
    const channel = interaction.options.getChannel('channel', true)
    if (channel.type !== ChannelType.GuildText) throw new Error('Choose a text channel.')
    const categories = await categoriesForGuild(interaction.guild.id)
    const select = new StringSelectMenuBuilder().setCustomId('ticket:create').setPlaceholder('Choose a support category').addOptions((categories.length ? categories : [{ id: 'general', name: 'General Support', description: '', emoji: null }]).slice(0, 25).map(category => ({ label: category.name, description: category.description.slice(0, 100) || 'Open a support ticket', value: category.id, ...(category.emoji ? { emoji: category.emoji } : {}) })))
    await (channel as TextChannel).send({ embeds: [new EmbedBuilder().setTitle('Need help?').setDescription('Select a category below to open a private support ticket.').setColor(0xdc2626)], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] })
    await interaction.reply({ content: `Ticket panel sent to <#${channel.id}>.`, ephemeral: true }); return
  }
  if (subcommand === 'create') { const channel = await createTicket(interaction); await interaction.reply({ content: `Your ticket is ready: <#${channel.id}>`, ephemeral: true }); return }
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) throw new Error('Use this command inside a ticket channel.')
  const ticket = await getTicket(interaction.channel.id); if (!ticket) throw new Error('This is not an open Alya ticket.')
  if (subcommand === 'add' || subcommand === 'remove') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) throw new Error('Manage Channels permission required.')
    const user = interaction.options.getUser('user', true)
    if (subcommand === 'add') await interaction.channel.permissionOverwrites.create(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true })
    else await interaction.channel.permissionOverwrites.delete(user.id)
    await interaction.reply({ content: `${subcommand === 'add' ? 'Added' : 'Removed'} <@${user.id}> ${subcommand === 'add' ? 'to' : 'from'} this ticket.` }); return
  }
  if (subcommand === 'transcript') { if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) throw new Error('Manage Channels permission required.'); const html = await transcript(interaction.channel); await interaction.reply({ content: 'Transcript generated.', files: [{ attachment: Buffer.from(html), name: `${interaction.channel.name}.html` }] }); return }
  if (subcommand === 'close') { if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) && ticket.userId !== interaction.user.id) throw new Error('Only the ticket owner or staff can close this ticket.'); await db.update(tickets).set({ status: 'closed', closedAt: new Date() }).where(eq(tickets.ticketId, ticket.ticketId)); await publishDashboardEvent({ type: 'ticket.closed', guildId: interaction.guild.id, actorUserId: interaction.user.id, payload: { ticketId: ticket.ticketId, reason: interaction.options.getString('reason') || null } }); await interaction.reply({ content: 'Ticket closed. This channel will be deleted shortly.' }); setTimeout(() => interaction.channel?.delete().catch(() => undefined), 3000) }
}

export async function handleTicketInteraction(interaction: any) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:create') { await interaction.deferReply({ ephemeral: true }); const channel = await createTicket(interaction, interaction.values[0] === 'general' ? undefined : interaction.values[0]); await interaction.editReply(`Your ticket is ready: <#${channel.id}>`); return true }
  if (!interaction.isButton() || !interaction.customId.startsWith('ticket:')) return false
  const [, action] = interaction.customId.split(':'); const ticket = await getTicket(interaction.channelId); if (!ticket) { await interaction.reply({ content: 'This ticket is already closed.', ephemeral: true }); return true }
  if (action === 'claim') { await db.update(tickets).set({ claimedBy: interaction.user.id }).where(eq(tickets.ticketId, ticket.ticketId)); await interaction.reply({ content: `Ticket claimed by <@${interaction.user.id}>.` }); return true }
  if (action === 'close') { await db.update(tickets).set({ status: 'closed', closedAt: new Date() }).where(eq(tickets.ticketId, ticket.ticketId)); await interaction.reply({ content: 'Ticket closed.' }); setTimeout(() => interaction.channel?.delete().catch(() => undefined), 3000); return true }
  return false
}

export function isTicketCommand(name: string) { return ticketCommands.some(command => command.name === name) }
