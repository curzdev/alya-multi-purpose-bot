import { REST, Routes } from 'discord.js'
import { config } from './config'
import { moderationCommands } from './moderation/commands'
import { automodCommands } from './automod'

const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN)

async function registerCommands() {
  // A bot's application ID is its user ID. Resolve it from the token so a
  // separate DISCORD_APPLICATION_ID variable is not required.
  const botUser = await rest.get(Routes.user()) as { id: string }
  const applicationId = config.DISCORD_APPLICATION_ID || botUser.id
  const route = config.DISCORD_TEST_GUILD_ID
    ? Routes.applicationGuildCommands(applicationId, config.DISCORD_TEST_GUILD_ID)
    : Routes.applicationCommands(applicationId)

  const commands = [...moderationCommands, automodCommands]
  await rest.put(route, { body: commands.map(command => command.toJSON()) })
  console.log(`[alya] registered ${commands.length} commands ${config.DISCORD_TEST_GUILD_ID ? 'to test guild' : 'globally'} for application ${applicationId}`)
}

registerCommands().catch(error => {
  console.error('[alya] command registration failed', error)
  process.exitCode = 1
})
