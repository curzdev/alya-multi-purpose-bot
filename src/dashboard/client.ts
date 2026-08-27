import { config } from '../config'

export type DashboardEvent = {
  type: string
  guildId: string
  actorUserId?: string
  targetUserId?: string
  payload: Record<string, unknown>
}

export async function publishDashboardEvent(event: DashboardEvent) {
  const endpoint = `${config.DASHBOARD_API_URL.replace(/\/$/, '')}/bot/events`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.DASHBOARD_API_SECRET) headers['x-alya-service-secret'] = config.DASHBOARD_API_SECRET
  try {
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(event) })
    if (!response.ok) console.warn(`[alya] dashboard event rejected: ${response.status}`)
  } catch (error) {
    console.warn('[alya] dashboard event unavailable', error)
  }
}
