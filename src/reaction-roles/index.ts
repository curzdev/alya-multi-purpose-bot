import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  User,
} from 'discord.js'
import { and, eq, asc } from 'drizzle-orm'
import { db } from '../db'
import { reactionPanels, reactionRoles } from '../db/schema'
import { publishDashboardEvent } from '../dashboard/client'

export const reactionRoleCommands = new SlashCommandBuilder()
  .setName('reactionrole')
  .setDescription('Create and manage self-role panels')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand(sub => sub.setName('panel').setDescription('Deploy a self-role panel').addChannelOption(o => o.setName('channel').setDescription('Panel channel').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('First role').setRequired(true)).addStringOption(o => o.setName('emoji').setDescription('Unicode or custom emoji').setRequired(true)).addStringOption(o => o.setName('mode').setDescription('Selection mode').addChoices({ name: 'Multi-select', value: 'normal' }, { name: 'Single-select', value: 'unique' }, { name: 'Verification', value: 'verify' })))
  .addSubcommand(sub => sub.setName('add').setDescription('Add an option').addStringOption(o => o.setName('message_id').setDescription('Panel message ID').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)).addStringOption(o => o.setName('emoji').setDescription('Unicode or custom emoji').setRequired(true)))
  .addSubcommand(sub => sub.setName('remove').setDescription('Remove an option').addStringOption(o => o.setName('message_id').setDescription('Panel message ID').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
  .addSubcommand(sub => sub.setName('list').setDescription('List active panels'))
  .addSubcommand(sub => sub.setName('mode').setDescription('Change panel mode').addStringOption(o => o.setName('message_id').setDescription('Panel message ID').setRequired(true)).addStringOption(o => o.setName('mode').setDescription('Selection mode').setRequired(true).addChoices({ name: 'Multi-select', value: 'normal' }, { name: 'Single-select', value: 'unique' }, { name: 'Verification', value: 'verify' })))

function parseEmoji(value: string) {
  const custom = value.match(/^<a?:(\w+):(\d+)>$/)
  return custom ? { id: custom[2], name: custom[1], animated: value.startsWith('<a:') } : { name: value }
}

function panelComponents(messageId: string, mode: string, options: Array<{ roleId: string; emoji: string }>) {
  const buttons = options.slice(0, 25).map(option => new ButtonBuilder().setCustomId(`alya:role:${messageId}:${option.roleId}`).setEmoji(parseEmoji(option.emoji)).setLabel('Get role').setStyle(mode === 'verify' ? ButtonStyle.Success : ButtonStyle.Secondary))
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)]
}

async function refreshPanel(interaction: ChatInputCommandInteraction, messageId: string) {
  const panel = await db.select().from(reactionPanels).where(eq(reactionPanels.messageId, messageId)).limit(1)
  if (!panel[0]) throw new Error('Reaction-role panel not found.')
  const options = await db.select().from(reactionRoles).where(eq(reactionRoles.messageId, messageId)).orderBy(asc(reactionRoles.position))
  const channel = await interaction.guild!.channels.fetch(panel[0].channelId)
  if (!channel || !('messages' in channel)) throw new Error('Panel channel is unavailable.')
  const message = await channel.messages.fetch(messageId)
  await message.edit({ components: panelComponents(messageId, panel[0].mode, options.map(option => ({ roleId: option.roleId, emoji: option.emojiIdentifier }))) })
  return { panel: panel[0], options }
}

export async function handleReactionRoleCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true })
  const subcommand = interaction.options.getSubcommand()
  if (subcommand === 'panel') {
    const channel = interaction.options.getChannel('channel', true)
    const role = interaction.options.getRole('role', true)
    const emoji = interaction.options.getString('emoji', true)
    const mode = interaction.options.getString('mode') ?? 'normal'
    if (!('send' in channel)) throw new Error('Choose a text channel.')
    const message = await channel.send({ embeds: [new EmbedBuilder().setTitle('Self-assignable roles').setDescription('Choose the roles you want below.')], components: panelComponents('pending', mode, [{ roleId: role.id, emoji }]) })
    await db.insert(reactionPanels).values({ messageId: message.id, guildId: interaction.guild.id, channelId: channel.id, mode }).onConflictDoNothing()
    await db.insert(reactionRoles).values({ messageId: message.id, roleId: role.id, emojiIdentifier: emoji, position: 0 }).onConflictDoNothing()
    await message.edit({ components: panelComponents(message.id, mode, [{ roleId: role.id, emoji }]) })
    await publishDashboardEvent({ type: 'reactionrole.panel.created', guildId: interaction.guild.id, actorUserId: interaction.user.id, payload: { messageId: message.id, channelId: channel.id, mode } })
    return interaction.reply({ content: `Reaction-role panel created: ${message.url}`, ephemeral: true })
  }
  const messageId = interaction.options.getString('message_id')
  if (subcommand === 'add' && messageId) {
    const role = interaction.options.getRole('role', true)
    const emoji = interaction.options.getString('emoji', true)
    const existing = await db.select().from(reactionRoles).where(eq(reactionRoles.messageId, messageId))
    await db.insert(reactionRoles).values({ messageId, roleId: role.id, emojiIdentifier: emoji, position: existing.length }).onConflictDoUpdate({ target: [reactionRoles.messageId, reactionRoles.roleId], set: { emojiIdentifier: emoji } })
    await refreshPanel(interaction, messageId)
    return interaction.reply({ content: 'Role option added.', ephemeral: true })
  }
  if (subcommand === 'remove' && messageId) {
    const role = interaction.options.getRole('role', true)
    await db.delete(reactionRoles).where(and(eq(reactionRoles.messageId, messageId), eq(reactionRoles.roleId, role.id)))
    await refreshPanel(interaction, messageId)
    return interaction.reply({ content: 'Role option removed.', ephemeral: true })
  }
  if (subcommand === 'mode' && messageId) {
    const mode = interaction.options.getString('mode', true)
    await db.update(reactionPanels).set({ mode, updatedAt: new Date() }).where(and(eq(reactionPanels.messageId, messageId), eq(reactionPanels.guildId, interaction.guild.id)))
    await refreshPanel(interaction, messageId)
    return interaction.reply({ content: `Panel mode changed to ${mode}.`, ephemeral: true })
  }
  const panels = await db.select().from(reactionPanels).where(eq(reactionPanels.guildId, interaction.guild.id))
  return interaction.reply({ content: panels.length ? panels.map(panel => `• ${panel.messageId} — ${panel.mode} — <#${panel.channelId}>`).join('\n') : 'No active reaction-role panels.', ephemeral: true })
}

export async function handleReactionRoleInteraction(interaction: StringSelectMenuInteraction | any) {
  if (!interaction.isButton?.() || !interaction.customId?.startsWith('alya:role:') || !interaction.guild) return false
  const [, , messageId, roleId] = interaction.customId.split(':')
  const panel = (await db.select().from(reactionPanels).where(and(eq(reactionPanels.messageId, messageId), eq(reactionPanels.guildId, interaction.guild.id))).limit(1))[0]
  if (!panel) return interaction.reply({ content: 'This role panel is no longer active.', ephemeral: true })
  const member = await interaction.guild.members.fetch(interaction.user.id)
  const role = await interaction.guild.roles.fetch(roleId)
  if (!role || role.managed || role.position >= interaction.guild.members.me!.roles.highest.position) return interaction.reply({ content: 'Alya cannot manage that role.', ephemeral: true })
  if (panel.mode === 'unique') {
    const options = await db.select().from(reactionRoles).where(eq(reactionRoles.messageId, messageId))
    await member.roles.remove(options.filter(option => option.roleId !== roleId).map(option => option.roleId)).catch(() => undefined)
  }
  if (member.roles.cache.has(roleId)) { await member.roles.remove(roleId); return interaction.reply({ content: `Removed ${role}.`, ephemeral: true }) }
  await member.roles.add(roleId)
  await publishDashboardEvent({ type: 'reactionrole.assignment.updated', guildId: interaction.guild.id, actorUserId: interaction.user.id, targetUserId: interaction.user.id, payload: { messageId, roleId, assigned: true } })
  return interaction.reply({ content: `Assigned ${role}.`, ephemeral: true })
}

export type ReactionRoleUser = User
export { ComponentType }
