import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder, TextChannel } from 'discord.js'
import { db } from '../db'
import { reminders } from '../db/schema'
import { publishDashboardEvent } from '../dashboard/client'

const units: Record<string, number> = { s: 1000, sec: 1000, seconds: 1000, m: 60000, min: 60000, minutes: 60000, h: 3600000, hour: 3600000, hours: 3600000, d: 86400000, day: 86400000, days: 86400000, w: 604800000, week: 604800000, weeks: 604800000 }

export function parseReminderTime(input: string, now = Date.now()) {
  const value = input.trim().toLowerCase()
  const match = /^(\d+)\s*([a-z]+)$/.exec(value)
  if (!match || !units[match[2]]) throw new Error('Use a duration like 10 minutes, 2 hours, or 1 day.')
  const amount = Number(match[1])
  if (amount < 1 || amount > 365) throw new Error('Reminder durations must be between 1 and 365 units.')
  return new Date(now + amount * units[match[2]])
}

export const reminderCommands = [
  new SlashCommandBuilder().setName('remind').setDescription('Create a reminder').addStringOption(o => o.setName('message').setDescription('What should Alya remind you about?').setRequired(true)).addStringOption(o => o.setName('in').setDescription('Examples: 10 minutes, 2 hours, 1 day').setRequired(true)).addStringOption(o => o.setName('repeat').setDescription('Repeat: daily, weekly, or every 2 hours')), 
  new SlashCommandBuilder().setName('reminders').setDescription('List your active reminders'),
  new SlashCommandBuilder().setName('reminder-cancel').setDescription('Cancel one of your reminders').addStringOption(o => o.setName('id').setDescription('Reminder ID').setRequired(true)),
]

export async function handleReminder(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id
  if (interaction.commandName === 'remind') {
    const message = interaction.options.getString('message', true).slice(0, 500)
    const remindAt = parseReminderTime(interaction.options.getString('in', true))
    const repeatRule = interaction.options.getString('repeat')?.toLowerCase() || null
    if (repeatRule && !/^(daily|weekly|every \d+ (minutes?|hours?|days?))$/.test(repeatRule)) throw new Error('Repeat must be daily, weekly, or like every 2 hours.')
    const [row] = await db.insert(reminders).values({ id: crypto.randomUUID(), userId, guildId: interaction.guildId, channelId: interaction.channelId, message, remindAt, repeatRule, timezone: 'UTC', delivery: 'channel' }).returning()
    await publishDashboardEvent({ type: 'reminder.created', guildId: interaction.guildId ?? '', actorUserId: userId, payload: { reminderId: row.id, remindAt: remindAt.toISOString() } })
    await interaction.reply({ content: `Reminder **${row.id.slice(0, 8)}** set for <t:${Math.floor(remindAt.getTime() / 1000)}:R>.` })
    return
  }
  if (interaction.commandName === 'reminders') {
    const rows = await db.select().from(reminders).where(and(eq(reminders.userId, userId), isNull(reminders.pausedAt))).orderBy(asc(reminders.remindAt)).limit(10)
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Your reminders').setDescription(rows.length ? rows.map(r => `**${r.id.slice(0, 8)}** · <t:${Math.floor(r.remindAt.getTime() / 1000)}:R> · ${r.message}`).join('\n') : 'No active reminders.')], ephemeral: true })
    return
  }
  const id = interaction.options.getString('id', true)
  const rows = await db.update(reminders).set({ pausedAt: new Date(), updatedAt: new Date() }).where(and(eq(reminders.userId, userId), eq(reminders.id, id))).returning({ id: reminders.id })
  if (!rows.length) throw new Error('Reminder not found.')
  await publishDashboardEvent({ type: 'reminder.cancelled', guildId: interaction.guildId ?? '', actorUserId: userId, payload: { reminderId: id } })
  await interaction.reply({ content: `Cancelled reminder **${id.slice(0, 8)}**.`, ephemeral: true })
}

function nextRepeat(rule: string, from: Date) { const match = /^every (\d+) (minutes?|hours?|days?)$/.exec(rule); if (rule === 'daily') return new Date(from.getTime() + 86400000); if (rule === 'weekly') return new Date(from.getTime() + 604800000); if (!match) return null; return new Date(from.getTime() + Number(match[1]) * (match[3].startsWith('minute') ? 60000 : match[3].startsWith('hour') ? 3600000 : 86400000)) }

export async function deliverDueReminders(client: { channels: { fetch(id: string): Promise<unknown> } }) {
  const due = await db.select().from(reminders).where(and(lte(reminders.remindAt, new Date()), isNull(reminders.pausedAt))).orderBy(asc(reminders.remindAt)).limit(50)
  for (const reminder of due) {
    const channel = await client.channels.fetch(reminder.channelId).catch(() => null) as TextChannel | null
    if (channel?.isTextBased()) await channel.send(`<@${reminder.userId}> reminder: ${reminder.message}`).catch(() => undefined)
    const next = reminder.repeatRule ? nextRepeat(reminder.repeatRule, reminder.remindAt) : null
    await db.update(reminders).set(next ? { remindAt: next, updatedAt: new Date() } : { pausedAt: new Date(), updatedAt: new Date() }).where(eq(reminders.id, reminder.id))
  }
}
