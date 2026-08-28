import { Client, Events, GatewayIntentBits } from 'discord.js'
import { config } from './config'
import { handleModeration, moderationCommands } from './moderation/commands'
import { automodCommands, handleAutoMod, handleAutoModMessage, registerGuild, trackGuildJoin } from './automod'
import { handleProtection, handleProtectionBotAdd, handleProtectionMemberJoin, handleProtectionMessage, protectionCommands, registerProtectionGuild } from './protection'
import { handleLeveling, handleLevelMessage, leaderboardCommands, levelConfigCommands, levelingCommands, rankBackgroundCommands } from './leveling'
import { deliverDueReminders, handleReminder, reminderCommands } from './reminders'
import { achievementCommands, handleAchievements, trackAchievementTrigger } from './achievements'
import { handleInvites, inviteCommands, inviteEventHandlers } from './invites'
import { handleTicketInteraction, handleTickets, ticketCommands, isTicketCommand } from './tickets'

export const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildInvites] })

client.once(Events.ClientReady, ready => {
  console.log(`[alya] online as ${ready.user.tag}`)
  for (const guild of ready.guilds.cache.values()) void inviteEventHandlers.registerInviteGuild(guild)
  void deliverDueReminders(client)
  setInterval(() => void deliverDueReminders(client), 30_000)
})
client.on(Events.GuildCreate, guild => { void registerGuild(guild.id, guild.name, guild.ownerId); void registerProtectionGuild(guild.id); void inviteEventHandlers.registerInviteGuild(guild) })
client.on(Events.InviteCreate, invite => { void inviteEventHandlers.handleInviteCreate(invite) })
client.on(Events.InviteDelete, invite => { void inviteEventHandlers.handleInviteDelete(invite) })
client.on(Events.GuildMemberRemove, member => { void inviteEventHandlers.handleMemberLeave(member) })
client.on(Events.GuildMemberAdd, member => {
  void inviteEventHandlers.handleMemberJoin(member)
  if (trackGuildJoin(member.guild.id) >= 10) console.warn(`[alya] raid threshold reached in ${member.guild.id}`)
  void handleProtectionMemberJoin(member)
  if (member.user.bot) void handleProtectionBotAdd(member)
})
client.on(Events.MessageCreate, message => { void handleAutoModMessage(message); void handleProtectionMessage(message); void handleLevelMessage(message as any) })
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) {
    try { await handleTicketInteraction(interaction) } catch (error) { console.error('[alya] ticket interaction failed', error) }
    return
  }
  if (isTicketCommand(interaction.commandName)) {
    try { await handleTickets(interaction) } catch (error) { console.error('[alya] ticket command failed', error); const message = { content: error instanceof Error ? error.message : 'Alya could not manage that ticket.', ephemeral: true }; if (interaction.replied || interaction.deferred) await interaction.editReply(message); else await interaction.reply(message) }
    return
  }
  if (inviteCommands.some(command => command.name === interaction.commandName)) {
    try { await handleInvites(interaction) } catch (error) { console.error('[alya] invite command failed', error); if (interaction.replied || interaction.deferred) await interaction.editReply({ content: 'Alya could not manage invites.' }); else await interaction.reply({ content: 'Alya could not manage invites.', ephemeral: true }) }
    return
  }
  if ([levelingCommands.name, rankBackgroundCommands.name, leaderboardCommands.name, levelConfigCommands.name].includes(interaction.commandName)) {
    try { await handleLeveling(interaction) } catch (error) { console.error('[alya] leveling command failed', error); if (interaction.replied || interaction.deferred) await interaction.editReply({ content: 'Alya could not update leveling.' }); else await interaction.reply({ content: 'Alya could not update leveling.', ephemeral: true }) }
    return
  }
  if (interaction.commandName === achievementCommands.name) {
    try { await handleAchievements(interaction) } catch (error) { console.error('[alya] achievement command failed', error); if (interaction.replied || interaction.deferred) await interaction.editReply({ content: 'Alya could not manage achievements.' }); else await interaction.reply({ content: 'Alya could not manage achievements.', ephemeral: true }) }
    return
  }
  if (reminderCommands.some(command => command.name === interaction.commandName)) {
    try { await handleReminder(interaction) } catch (error) { console.error('[alya] reminder command failed', error); const message = { content: error instanceof Error ? error.message : 'Alya could not manage that reminder.', ephemeral: true }; if (interaction.replied || interaction.deferred) await interaction.editReply(message); else await interaction.reply(message) }
    return
  }
  if (interaction.commandName === protectionCommands.name) {
    try { await handleProtection(interaction) } catch (error) { console.error('[alya] protection command failed', error); if (interaction.replied || interaction.deferred) await interaction.editReply({ content: 'Alya could not update Protection.' }); else await interaction.reply({ content: 'Alya could not update Protection.', ephemeral: true }) }
    return
  }
  if (interaction.commandName === automodCommands.name) {
    try { await handleAutoMod(interaction) } catch (error) { console.error('[alya] automod command failed', error); if (interaction.replied || interaction.deferred) await interaction.editReply({ content: 'Alya could not update AutoMod.' }); else await interaction.reply({ content: 'Alya could not update AutoMod.', ephemeral: true }) }
    return
  }
  if (!moderationCommands.some(command => command.name === interaction.commandName)) return
  try { await handleModeration(interaction) } catch (error) { console.error('[alya] command failed', error); const message = { content: 'Alya could not complete that action.', ephemeral: true }; if (interaction.replied || interaction.deferred) await interaction.editReply(message); else await interaction.reply(message) }
})

client.login(config.DISCORD_TOKEN).catch(error => { console.error('[alya] login failed', error); process.exitCode = 1 })
