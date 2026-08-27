import { Client, Events, GatewayIntentBits } from 'discord.js'
import { config } from './config'
import { handleModeration, moderationCommands } from './moderation/commands'
import { automodCommands, handleAutoMod, handleAutoModMessage, registerGuild, trackGuildJoin } from './automod'

export const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] })

client.once(Events.ClientReady, ready => console.log(`[alya] online as ${ready.user.tag}`))
client.on(Events.GuildCreate, guild => { void registerGuild(guild.id, guild.name, guild.ownerId) })
client.on(Events.GuildMemberAdd, member => {
  if (trackGuildJoin(member.guild.id) >= 10) console.warn(`[alya] raid threshold reached in ${member.guild.id}`)
})
client.on(Events.MessageCreate, message => { void handleAutoModMessage(message) })
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName === automodCommands.name) {
    try { await handleAutoMod(interaction) } catch (error) { console.error('[alya] automod command failed', error); if (interaction.replied || interaction.deferred) await interaction.editReply({ content: 'Alya could not update AutoMod.' }); else await interaction.reply({ content: 'Alya could not update AutoMod.', ephemeral: true }) }
    return
  }
  if (!moderationCommands.some(command => command.name === interaction.commandName)) return
  try { await handleModeration(interaction) } catch (error) { console.error('[alya] command failed', error); const message = { content: 'Alya could not complete that action.', ephemeral: true }; if (interaction.replied || interaction.deferred) await interaction.editReply(message); else await interaction.reply(message) }
})

client.login(config.DISCORD_TOKEN).catch(error => { console.error('[alya] login failed', error); process.exitCode = 1 })
