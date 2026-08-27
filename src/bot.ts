import { Client, Events, GatewayIntentBits } from 'discord.js'
import { config } from './config'
import { handleModeration, moderationCommands } from './moderation/commands'
import { automodCommands, handleAutoMod, handleAutoModMessage, registerGuild, trackGuildJoin } from './automod'
import { handleProtection, handleProtectionBotAdd, handleProtectionMemberJoin, handleProtectionMessage, protectionCommands, registerProtectionGuild } from './protection'
import { handleLeveling, handleLevelMessage, leaderboardCommands, levelConfigCommands, levelingCommands, rankBackgroundCommands } from './leveling'

export const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] })

client.once(Events.ClientReady, ready => console.log(`[alya] online as ${ready.user.tag}`))
client.on(Events.GuildCreate, guild => { void registerGuild(guild.id, guild.name, guild.ownerId); void registerProtectionGuild(guild.id) })
client.on(Events.GuildMemberAdd, member => {
  if (trackGuildJoin(member.guild.id) >= 10) console.warn(`[alya] raid threshold reached in ${member.guild.id}`)
  void handleProtectionMemberJoin(member)
  if (member.user.bot) void handleProtectionBotAdd(member)
})
client.on(Events.MessageCreate, message => { void handleAutoModMessage(message); void handleProtectionMessage(message); void handleLevelMessage(message as any) })
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return
  if ([levelingCommands.name, rankBackgroundCommands.name, leaderboardCommands.name, levelConfigCommands.name].includes(interaction.commandName)) {
    try { await handleLeveling(interaction) } catch (error) { console.error('[alya] leveling command failed', error); if (interaction.replied || interaction.deferred) await interaction.editReply({ content: 'Alya could not update leveling.' }); else await interaction.reply({ content: 'Alya could not update leveling.', ephemeral: true }) }
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
