import { liveEventSchema, type LiveEvent } from '@nightjar/shared/recordings'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { z } from 'zod'
import type { Database } from './database.ts'
import type { Logger } from './logger.ts'

const channel = 'nightjar_events'
const reconnectDelayMs = 1000

const messageSchema = z.object({
  audience: z.union([z.object({ userId: z.string() }), z.object({ admins: z.literal(true) })]),
  event: liveEventSchema,
})

export interface Subscriber {
  userId: string
  isAdmin: boolean
  send: (event: LiveEvent) => void
}

/**
 * Live events travel through Postgres LISTEN/NOTIFY, so any process that publishes reaches the
 * browsers connected to any web process.
 */
export function createEvents({
  databaseUrl,
  database,
  logger,
}: {
  databaseUrl: string
  database: Database
  logger: Logger
}) {
  const subscribers = new Set<Subscriber>()
  let listener: Client | undefined
  let stopped = false
  let reconnect: NodeJS.Timeout | undefined

  const dispatch = (payload: string | undefined) => {
    const parsed = messageSchema.safeParse(JSON.parse(payload ?? 'null'))
    if (!parsed.success) return
    const { audience, event } = parsed.data
    for (const subscriber of subscribers) {
      const wanted =
        'userId' in audience ? audience.userId === subscriber.userId : subscriber.isAdmin
      if (wanted) subscriber.send(event)
    }
  }

  async function connect() {
    const client = new Client({ connectionString: databaseUrl })
    let handled = false
    const lost = () => {
      if (handled) return
      handled = true
      if (listener === client) listener = undefined
      void client.end().catch(() => undefined)
      if (stopped) return
      logger.warn('lost the live events connection, reconnecting')
      reconnect = setTimeout(() => void connect(), reconnectDelayMs)
    }
    client.on('notification', (message) => {
      dispatch(message.payload)
    })
    client.on('error', lost)
    client.on('end', lost)
    try {
      await client.connect()
      listener = client
      await client.query(`listen ${channel}`)
    } catch {
      lost()
    }
  }

  const publish = async (audience: z.infer<typeof messageSchema>['audience'], event: LiveEvent) => {
    await database.db.execute(
      sql`select pg_notify(${channel}, ${JSON.stringify({ audience, event })})`,
    )
  }

  return {
    start: connect,
    stop: async () => {
      stopped = true
      clearTimeout(reconnect)
      const current = listener
      listener = undefined
      await current?.end().catch(() => undefined)
    },
    subscribe: (subscriber: Subscriber) => {
      subscribers.add(subscriber)
      return () => {
        subscribers.delete(subscriber)
      }
    },
    publishToUser: (userId: string, event: LiveEvent) => publish({ userId }, event),
    publishToAdmins: (event: LiveEvent) => publish({ admins: true }, event),
  }
}

export type Events = ReturnType<typeof createEvents>
