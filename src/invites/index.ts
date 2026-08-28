import { and, desc, eq, sql } from 'drizzle-orm'
import { ChatInputCommandInteraction, Guild, GuildMember, Invite, PartialGuildMember, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { db } from '../db'
import { inviteCodes, inviteRewards, userInvites } from '../db/schema'

const joins = new Map<string, Map<string, number>>()
const recentLeaves = new Map<string, Set<string>>()

export const inviteCommands = [
  new SlashCommandBuilder().setName('invites').setDescription('View invite statistics').addUserOption(o => o.setName('user').setDescription('Member to inspect').setRequired(false)),
  new SlashCommandBuilder().setName('invite').setDescription('Manage invite tracking').addSubcommand(s => s.setName('leaderboard').setDescription('Show invite rankings')).addSubcommand(s => s.setName('list').setDescription('List tracked invite links')).addSubcommand(s => s.setName('info').setDescription('Inspect an invite code').addStringOption(o => o.setName('code').setDescription('Invite code').setRequired(true))).addSubcommand(s => s.setName('rewards').setDescription('Manage invite rewards').addStringOption(o => o.setName('action').setDescription('add, remove, or view').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'view', value: 'view' })).addIntegerOption(o => o.setName('invites_needed').setDescription('Invite milestone').setMinValue(1).setRequired(false)).addRoleOption(o => o.setName('role').setDescription('Reward role').setRequired(false))),
].map(command => command)

function key(guildId: string, userId: string) { return `${guildId}:${userId}` }

export async function cacheGuildInvites(guild: Guild) {
  const cached = new Map<string, number>()
  const invites = await guild.invites.fetch()
  for (const invite of invites.values()) {
    if (invite.inviter) await db.insert(inviteCodes).values({ code: invite.code, guildId: guild.id, inviterId: invite.inviter.id, uses: invite.uses ?? 0 }).onConflictDoUpdate({ target: inviteCodes.code, set: { uses: invite.uses ?? 0, updatedAt: new Date() } })
    cached.set(invite.code, invite.uses ?? 0)
  }
  joins.set(guild.id, cached)
}

export async function handleInviteCreate(invite: Invite) {
  if (!invite.guild || !invite.inviter) return
  await db.insert(inviteCodes).values({ code: invite.code, guildId: invite.guild.id, inviterId: invite.inviter.id, uses: invite.uses ?? 0 }).onConflictDoUpdate({ target: inviteCodes.code, set: { uses: invite.uses ?? 0, updatedAt: new Date() } })
  joins.get(invite.guild.id)?.set(invite.code, invite.uses ?? 0)
}

export async function handleInviteDelete(invite: Invite) { if (invite.guild) joins.get(invite.guild.id)?.delete(invite.code) }

export async function resolveUsedInvite(guild: Guild): Promise<{ code: string; inviterId: string } | null> {
  const before = joins.get(guild.id) ?? new Map<string, number>()
  const invites = await guild.invites.fetch()
  let used: Invite | undefined
  for (const invite of invites.values()) if ((invite.uses ?? 0) > (before.get(invite.code) ?? 0)) used = invite
  await cacheGuildInvites(guild)
  return used?.inviter ? { code: used.code, inviterId: used.inviter.id } : null
}

async function increment(guildId: string, inviterId: string, field: 'regular' | 'fake' | 'bonus' | 'left', amount = 1) {
  const column = userInvites[field === 'left' ? 'leftCount' : field]
  await db.insert(userInvites).values({ guildId, userId: inviterId, [field === 'left' ? 'leftCount' : field]: amount }).onConflictDoUpdate({ target: [userInvites.guildId, userInvites.userId], set: { [field === 'left' ? 'leftCount' : field]: sql`${column} + ${amount}`, updatedAt: new Date() } })
}

export async function handleMemberJoin(member: GuildMember) {
  const used = await resolveUsedInvite(member.guild)
  if (!used || used.inviterId === member.id) return
  const isFake = Date.now() - member.user.createdTimestamp < 7 * 24 * 60 * 60 * 1000
  await increment(member.guild.id, used.inviterId, isFake ? 'fake' : 'regular')
  joins.get(member.guild.id)?.set(used.code, (joins.get(member.guild.id)?.get(used.code) ?? 0) + 1)
}

export async function handleMemberLeave(member: GuildMember | PartialGuildMember) {
  recentLeaves.set(key(member.guild.id, member.id), new Set([member.id]))
  const rows = await db.select({ userId: userInvites.userId }).from(userInvites).where(and(eq(userInvites.guildId, member.guild.id), eq(userInvites.userId, member.id))).limit(1)
  if (rows.length) await increment(member.guild.id, member.id, 'left')
}

async function reply(interaction: ChatInputCommandInteraction, content: string) { if (interaction.replied || interaction.deferred) return interaction.editReply({ content }); return interaction.reply({ content, ephemeral: true }) }

export async function handleInvites(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return reply(interaction, 'This command can only be used in a server.')
  if (interaction.commandName === 'invites') {
    const user = interaction.options.getUser('user') ?? interaction.user
    const row = await db.select().from(userInvites).where(and(eq(userInvites.guildId, interaction.guild.id), eq(userInvites.userId, user.id))).limit(1)
    const stats = row[0] ?? { regular: 0, leftCount: 0, fake: 0, bonus: 0 }
    return reply(interaction, `${user.username} has ${stats.regular + stats.bonus} active invites. Regular: ${stats.regular}, left: ${stats.leftCount}, fake: ${stats.fake}, bonus: ${stats.bonus}.`)
  }
  const sub = interaction.options.getSubcommand()
  if (sub === 'leaderboard') {
    const rows = await db.select().from(userInvites).where(eq(userInvites.guildId, interaction.guild.id)).orderBy(desc(userInvites.regular), desc(userInvites.bonus)).limit(10)
    return reply(interaction, rows.length ? rows.map((row, index) => `${index + 1}. <@${row.userId}> — ${row.regular + row.bonus} active`).join('\n') : 'No invite data yet.')
  }
  if (sub === 'list') {
    const rows = await db.select().from(inviteCodes).where(eq(inviteCodes.guildId, interaction.guild.id)).orderBy(desc(inviteCodes.uses)).limit(25)
    return reply(interaction, rows.length ? rows.map(row => `discord.gg/${row.code} — ${row.uses} uses — <@${row.inviterId}>`).join('\n') : 'No tracked invite links.')
  }
  if (sub === 'info') {
    const code = interaction.options.getString('code', true)
    const row = await db.select().from(inviteCodes).where(and(eq(inviteCodes.guildId, interaction.guild.id), eq(inviteCodes.code, code))).limit(1)
    return reply(interaction, row[0] ? `discord.gg/${row[0].code}: ${row[0].uses} uses, created by <@${row[0].inviterId}>.` : 'Invite code not found.')
  }
  if (sub === 'rewards') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return reply(interaction, 'Manage Server permission required.')
    const action = interaction.options.getString('action', true)
    const needed = interaction.options.getInteger('invites_needed')
    const role = interaction.options.getRole('role')
    if (action === 'view') {
      const rows = await db.select().from(inviteRewards).where(eq(inviteRewards.guildId, interaction.guild.id)).orderBy(inviteRewards.invitesNeeded)
      return reply(interaction, rows.length ? rows.map(row => `${row.invitesNeeded} invites → <@&${row.roleId}>`).join('\n') : 'No invite rewards configured.')
    }
    if (!needed || !role) return reply(interaction, 'Provide both invites_needed and role.')
    if (action === 'remove') await db.delete(inviteRewards).where(and(eq(inviteRewards.guildId, interaction.guild.id), eq(inviteRewards.invitesNeeded, needed)))
    else await db.insert(inviteRewards).values({ guildId: interaction.guild.id, invitesNeeded: needed, roleId: role.id }).onConflictDoUpdate({ target: [inviteRewards.guildId, inviteRewards.invitesNeeded], set: { roleId: role.id } })
    return reply(interaction, action === 'remove' ? 'Invite reward removed.' : 'Invite reward saved.')
  }
}

export async function grantInviteRewards(member: GuildMember, inviterId: string) {
  const stats = await db.select().from(userInvites).where(and(eq(userInvites.guildId, member.guild.id), eq(userInvites.userId, inviterId))).limit(1)
  const total = (stats[0]?.regular ?? 0) + (stats[0]?.bonus ?? 0)
  const rewards = await db.select().from(inviteRewards).where(eq(inviteRewards.guildId, member.guild.id))
  for (const reward of rewards) if (total >= reward.invitesNeeded && !member.guild.roles.cache.get(reward.roleId)) continue
}

export async function registerInviteGuild(guild: Guild) { await cacheGuildInvites(guild) }

export { recentLeaves }

export const inviteEventHandlers = { handleInviteCreate, handleInviteDelete, handleMemberJoin, handleMemberLeave, registerInviteGuild, grantInviteRewards }

export type InviteStats = typeof userInvites.$inferSelect
