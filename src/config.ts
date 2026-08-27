import { z } from 'zod'

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().optional(),
  DISCORD_TEST_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  DASHBOARD_API_URL: z.string().url().default('http://localhost:3000/api'),
  DASHBOARD_API_SECRET: z.string().optional(),
})

export const config = envSchema.parse({
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_APPLICATION_ID: process.env.DISCORD_APPLICATION_ID,
  DISCORD_TEST_GUILD_ID: process.env.DISCORD_TEST_GUILD_ID,
  DATABASE_URL: process.env.DATABASE_URL,
  DASHBOARD_API_URL: process.env.DASHBOARD_API_URL || 'http://localhost:3000/api',
  DASHBOARD_API_SECRET: process.env.DASHBOARD_API_SECRET,
})
