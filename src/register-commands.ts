import { REST, Routes } from 'discord.js'
import { config } from './config'
import { moderationCommands } from './moderation/commands'

if (!config.DISCORD_APPLICATION_ID) throw new Error('DISCORD_APPLICATION_ID is required for command registration')
const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN)
const route = config.DISCORD_TEST_GUILD_ID ? Routes.applicationGuildCommands(config.DISCORD_APPLICATION_ID, config.DISCORD_TEST_GUILD_ID) : Routes.applicationCommands(config.DISCORD_APPLICATION_ID)
rest.put(route, { body: moderationCommands.map(command => command.toJSON()) }).then(() => {
  console.log(`[alya] registered ${moderationCommands.length} commands ${config.DISCORD_TEST_GUILD_ID ? 'to test guild' : 'globally'}`)
}).catch(error => { console.error('[alya] command registration failed', error); process.exitCode = 1 })
