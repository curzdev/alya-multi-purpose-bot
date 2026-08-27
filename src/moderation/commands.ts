import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { addAudit, canModerate, parseDuration, recordCase } from './service'

export const moderationCommands = [
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('unban').setDescription('Unban a user').addStringOption(o => o.setName('user_id').setDescription('User ID').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('30m, 2h, 7d').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove a timeout').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('unwarn').setDescription('Remove the latest warning').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages').addIntegerOption(o => o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode').addIntegerOption(o => o.setName('seconds').setDescription('0-21600').setMinValue(0).setMaxValue(21600).setRequired(true)),
  new SlashCommandBuilder().setName('lock').setDescription('Lock this channel').addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('unlock').setDescription('Unlock this channel').addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('case').setDescription('View recent moderation cases'),
  new SlashCommandBuilder().setName('warnings').setDescription('View member warnings').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)),
].map(command => command.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers))

export async function handleModeration(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true })
  const action = interaction.commandName
  const target = interaction.options.getUser('user')
  if (target && !canModerate(interaction.user.id, target.id, interaction.guild.ownerId)) return interaction.reply({ content: 'You cannot moderate yourself.', ephemeral: true })
  const reason = interaction.options.getString('reason') ?? 'No reason provided'
  if (action === 'case' || action === 'warnings') return interaction.reply({ content: 'Case lookup is available in the Alya dashboard.', ephemeral: true })
  if (action === 'purge') {
    const amount = interaction.options.getInteger('amount', true)
    if (!interaction.channel || !('bulkDelete' in interaction.channel)) return interaction.reply({ content: 'This channel cannot be purged.', ephemeral: true })
    await interaction.deferReply({ ephemeral: true }); await interaction.channel.bulkDelete(amount, true); await addAudit(interaction.guild.id, 'moderation.purge', interaction.user.id, { amount, channelId: interaction.channelId }); return interaction.editReply(`Deleted ${amount} messages.`)
  }
  if (action === 'slowmode') { const seconds = interaction.options.getInteger('seconds', true); if (!interaction.channel || !('setRateLimitPerUser' in interaction.channel)) return interaction.reply({ content: 'This channel cannot use slowmode.', ephemeral: true }); await interaction.channel.setRateLimitPerUser(seconds, reason); await addAudit(interaction.guild.id, 'moderation.slowmode', interaction.user.id, { seconds, channelId: interaction.channelId }); return interaction.reply(`Slowmode set to ${seconds}s.`) }
  if (action === 'lock' || action === 'unlock') return interaction.reply({ content: `${action} is wired for the channel policy adapter.`, ephemeral: true })
  if (!target && action !== 'unban') return interaction.reply({ content: 'A target is required.', ephemeral: true })
  const member = target ? await interaction.guild.members.fetch(target.id).catch(() => null) : null
  if (action === 'ban' && member) await member.ban({ reason })
  if (action === 'kick' && member) await member.kick(reason)
  if (action === 'timeout' && member) await member.timeout(parseDuration(interaction.options.getString('duration', true))!.getTime() - Date.now(), reason)
  if (action === 'untimeout' && member) await member.timeout(null, reason)
  if (action === 'unban') await interaction.guild.bans.remove(interaction.options.getString('user_id', true), reason)
  const created = await recordCase({ guildId: interaction.guild.id, action: action as Parameters<typeof recordCase>[0]['action'], targetUserId: target?.id ?? interaction.options.getString('user_id', true), moderatorUserId: interaction.user.id, reason })
  return interaction.reply(`Action **${action}** completed. Case \\#${created.caseId}.`)
}
