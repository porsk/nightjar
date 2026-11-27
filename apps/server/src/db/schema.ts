import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  isAdmin: boolean('is_admin').notNull().default(false),
  uiLanguage: text('ui_language', { enum: ['hu', 'en'] })
    .notNull()
    .default('en'),
  entryLanguage: text('entry_language', { enum: ['hu', 'en', 'auto'] })
    .notNull()
    .default('en'),
  timeZone: text('time_zone').notNull().default('UTC'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const instanceSettings = pgTable('instance_settings', {
  id: integer('id').primaryKey().default(1),
  transcriptionEnabled: boolean('transcription_enabled').notNull().default(false),
  modelDownloadState: text('model_download_state', { enum: ['idle', 'downloading', 'failed'] })
    .notNull()
    .default('idle'),
  modelDownloadedBytes: integer('model_downloaded_bytes').notNull().default(0),
  authSecret: text('auth_secret').notNull(),
  setupCodeHash: text('setup_code_hash'),
  updatedAt: updatedAt(),
})

export const entries = pgTable(
  'entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    bodyMd: text('body_md').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('entries_user_date_idx').on(
      table.userId,
      table.entryDate.desc(),
      table.createdAt.desc(),
      table.id,
    ),
  ],
)

export const recordings = pgTable(
  'recordings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms').notNull(),
    language: text('language', { enum: ['hu', 'en', 'auto'] }).notNull(),
    status: text('status', {
      enum: ['pending', 'transcribing', 'done', 'failed', 'skipped'],
    }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('recordings_entry_idx').on(table.entryId),
    index('recordings_status_idx').on(table.status),
  ],
)

export const transcripts = pgTable('transcripts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  recordingId: uuid('recording_id')
    .notNull()
    .unique()
    .references(() => recordings.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  language: text('language', { enum: ['hu', 'en'] }).notNull(),
  text: text('text').notNull(),
  isUserEdited: boolean('is_user_edited').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})
