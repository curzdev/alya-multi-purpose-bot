import { ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, GuildMember } from 'discord.js'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { achievements, auditLogs, userAchievements, userLevels } from '../db/schema'
import { publishDashboardEvent } from '../dashboard/client'
import { randomUUID } from 'crypto'

type AchievementTrigger = 'messages' | 'voice_hours' | 'level' | 'reactions' | 'invites' | 'moderation_cases'

interface AchievementTracker {
  userId: string
  guildId: string
  trigger: AchievementTrigger
  value: number
}

const trackerCache = new Map<string, Map<AchievementTrigger, number>>()

export const achievementCommands = new SlashCommandBuilder()
  .setName('achievements')
  .setDescription('Manage and view achievements')
  .addSubcommand((sub: any) =>
    sub
      .setName('view')
      .setDescription('View achievements')
      .addUserOption((o: any) => o.setName('user').setDescription('Member to view').setRequired(false))
  )
  .addSubcommand((sub: any) =>
    sub
      .setName('detail')
      .setDescription('View achievement details')
      .addStringOption((o: any) => o.setName('id').setDescription('Achievement ID').setRequired(true))
  )
  .addSubcommand((sub: any) =>
    sub
      .setName('create')
      .setDescription('Create a new achievement')
      .addStringOption((o: any) => o.setName('title').setDescription('Achievement title').setRequired(true))
      .addStringOption((o: any) => o.setName('description').setDescription('Achievement description').setRequired(true))
      .addStringOption((o: any) =>
        o
          .setName('trigger')
          .setDescription('Unlock trigger')
          .addChoices(
            { name: 'Messages', value: 'messages' },
            { name: 'Voice Hours', value: 'voice_hours' },
            { name: 'Level Reached', value: 'level' },
            { name: 'Reactions', value: 'reactions' },
            { name: 'Invites', value: 'invites' },
            { name: 'Moderation Cases', value: 'moderation_cases' }
          )
          .setRequired(true)
      )
      .addIntegerOption((o: any) => o.setName('target_value').setDescription('Target value').setMinValue(1).setRequired(true))
      .addRoleOption((o: any) => o.setName('reward_role').setDescription('Role reward').setRequired(false))
      .addIntegerOption((o: any) => o.setName('reward_xp').setDescription('XP reward').setMinValue(0).setRequired(false))
      .addStringOption((o: any) => o.setName('icon_url').setDescription('Icon URL').setRequired(false))
  )
  .addSubcommand((sub: any) =>
    sub
      .setName('grant')
      .setDescription('Grant an achievement to a user')
      .addUserOption((o: any) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o: any) => o.setName('id').setDescription('Achievement ID').setRequired(true))
  )

async function getAchievementsByTrigger(guildId: string, trigger: AchievementTrigger) {
  return db
    .select()
    .from(achievements)
    .where(and(eq(achievements.guildId, guildId), eq(achievements.triggerType, trigger)))
}

async function checkAndUnlock(userId: string, guildId: string, trigger: AchievementTrigger, value: number, member: GuildMember) {
  const relevant = await getAchievementsByTrigger(guildId, trigger)
  if (!relevant.length) return []
  const unlockedTitles: string[] = []

  for (const ach of relevant) {
    const existing = await db
      .select()
      .from(userAchievements)
      .where(
        and(eq(userAchievements.userId, userId), eq(userAchievements.guildId, guildId), eq(userAchievements.achievementId, ach.id))
      )
      .limit(1)

    const current = existing[0]
    if (current?.unlockedAt) continue

    const newProgress = (current?.progress ?? 0) + value
    if (newProgress >= (ach.triggerTargetValue || 1)) {
      await db
        .insert(userAchievements)
        .values({ userId, guildId, achievementId: ach.id, progress: newProgress })
        .onConflictDoUpdate({
          target: [userAchievements.userId, userAchievements.guildId, userAchievements.achievementId],
          set: { progress: newProgress, unlockedAt: new Date() },
        })

      if (ach.rewardRoleId) {
        const role = member.guild.roles.cache.get(ach.rewardRoleId)
        if (role && !member.roles.cache.has(role.id)) await member.roles.add(role).catch(() => undefined)
      }

      await db.insert(auditLogs).values({
        guildId,
        eventType: 'achievement.unlocked',
        actorUserId: userId,
        payload: { achievementId: ach.id, title: ach.title },
      })

      unlockedTitles.push(ach.title)
      await publishDashboardEvent({
        type: 'achievement.unlocked',
        guildId,
        actorUserId: userId,
        targetUserId: userId,
        payload: { achievementId: ach.id, title: ach.title, rewardXp: ach.rewardXp || 0 },
      })
    } else {
      await db
        .insert(userAchievements)
        .values({ userId, guildId, achievementId: ach.id, progress: newProgress })
        .onConflictDoUpdate({
          target: [userAchievements.userId, userAchievements.guildId, userAchievements.achievementId],
          set: { progress: newProgress },
        })
    }
  }
  return unlockedTitles
}

export async function trackAchievementTrigger(userId: string, guildId: string, trigger: AchievementTrigger, value: number, member: GuildMember) {
  return checkAndUnlock(userId, guildId, trigger, value, member)
}

export async function handleAchievements(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.guild || !interaction.member) return interaction.reply({ content: 'Achievements only work in servers.', ephemeral: true })

  const guildId = interaction.guildId
  const sub = interaction.options.getSubcommand(true)

  if (sub === 'view') {
    const target = (interaction.options.getMember('user') as GuildMember | null) || (interaction.member as GuildMember)
    const rows = await db
      .select()
      .from(userAchievements)
      .where(and(eq(userAchievements.userId, target.id), eq(userAchievements.guildId, guildId)))

    const allAchievements = await db.select().from(achievements).where(eq(achievements.guildId, guildId))
    const unlockedIds = new Set(rows.map((r) => r.achievementId))
    const unlocked = allAchievements.filter((a) => unlockedIds.has(a.id))

    const text = unlocked.length
      ? unlocked.map((a) => `**${a.title}** — ${a.description}`).join('\n')
      : 'No achievements unlocked yet.'

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`${target.displayName}'s Achievements`)
          .setDescription(text)
          .setColor(0xc83b4a)
          .setFooter({ text: `${unlocked.length} of ${allAchievements.length}` }),
      ],
    })
  }

  if (sub === 'detail') {
    const id = interaction.options.getString('id', true)
    const ach = await db.select().from(achievements).where(eq(achievements.id, id)).limit(1)
    if (!ach.length) return interaction.reply({ content: 'Achievement not found.', ephemeral: true })

    const row = ach[0]
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(row.title)
          .setDescription(row.description)
          .addFields(
            { name: 'Trigger', value: row.triggerType, inline: true },
            { name: 'Target', value: String(row.triggerTargetValue), inline: true },
            { name: 'Reward XP', value: String(row.rewardXp || 0), inline: true }
          )
          .setColor(0xc83b4a)
          .setThumbnail(row.iconUrl),
      ],
    })
  }

  if (sub === 'create') {
    const title = interaction.options.getString('title', true)
    const description = interaction.options.getString('description', true)
    const trigger = interaction.options.getString('trigger', true) as AchievementTrigger
    const targetValue = interaction.options.getInteger('target_value', true)
    const rewardRole = interaction.options.getRole('reward_role')
    const rewardXp = interaction.options.getInteger('reward_xp')
    const iconUrl = interaction.options.getString('icon_url')

    const id = randomUUID()
    await db.insert(achievements).values({
      id,
      guildId,
      title,
      description,
      triggerType: trigger,
      triggerTargetValue: targetValue,
      rewardRoleId: rewardRole?.id || null,
      rewardXp: rewardXp || 0,
      iconUrl: iconUrl || null,
    })

    await db.insert(auditLogs).values({
      guildId,
      eventType: 'achievement.created',
      actorUserId: interaction.user.id,
      payload: { achievementId: id, title },
    })

    return interaction.reply({ content: `Achievement **${title}** created.`, ephemeral: true })
  }

  if (sub === 'grant') {
    const target = interaction.options.getUser('user', true)
    const id = interaction.options.getString('id', true)

    const ach = await db.select().from(achievements).where(eq(achievements.id, id)).limit(1)
    if (!ach.length) return interaction.reply({ content: 'Achievement not found.', ephemeral: true })

    const member = await interaction.guild.members.fetch(target.id).catch(() => null)
    if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true })

    await db
      .insert(userAchievements)
      .values({ userId: target.id, guildId, achievementId: id })
      .onConflictDoUpdate({
        target: [userAchievements.userId, userAchievements.guildId, userAchievements.achievementId],
        set: { unlockedAt: new Date() },
      })

    if (ach[0].rewardRoleId) {
      const role = interaction.guild.roles.cache.get(ach[0].rewardRoleId)
      if (role && !member.roles.cache.has(role.id)) await member.roles.add(role).catch(() => undefined)
    }

    await db.insert(auditLogs).values({
      guildId,
      eventType: 'achievement.granted',
      actorUserId: interaction.user.id,
      payload: { targetUserId: target.id, achievementId: id, title: ach[0].title },
    })

    return interaction.reply({ content: `Achievement **${ach[0].title}** granted to ${target.username}.`, ephemeral: true })
  }
}
