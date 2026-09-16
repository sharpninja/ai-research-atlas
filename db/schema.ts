import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

export const pageViewsDaily = sqliteTable('page_views_daily', {
  day: text('day').notNull(),
  path: text('path').notNull(),
  referrer: text('referrer').notNull(),
  views: integer('views').notNull().default(0),
}, table => [primaryKey({columns: [table.day, table.path, table.referrer]})]);

export const analyticsMeta = sqliteTable('analytics_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const deviceViewsDaily = sqliteTable('device_views_daily', {
  day: text('day').notNull(),
  deviceType: text('device_type', {enum: ['desktop', 'mobile', 'tablet', 'unknown']}).notNull(),
  views: integer('views').notNull().default(0),
}, table => [primaryKey({columns: [table.day, table.deviceType]})]);

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  entry: text('entry').notNull(),
  authorId: text('author_id').notNull(),
  authorName: text('author_name').notNull(),
  body: text('body').notNull(),
  status: text('status', {enum: ['pending', 'approved', 'rejected', 'removed']}).notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  moderatedAt: integer('moderated_at'),
  moderatedBy: text('moderated_by'),
  submissionKey: text('submission_key').notNull(),
}, table => [
  index('idx_comments_entry_status_created').on(table.entry, table.status, table.createdAt),
  index('idx_comments_author_created').on(table.authorId, table.createdAt),
  index('idx_comments_status_created').on(table.status, table.createdAt),
  uniqueIndex('idx_comments_author_submission').on(table.authorId, table.submissionKey),
]);

export const moderationEvents = sqliteTable('moderation_events', {
  id: text('id').primaryKey(),
  commentId: text('comment_id').notNull().references(() => comments.id),
  actorId: text('actor_id').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [index('idx_moderation_events_comment').on(table.commentId)]);

export const timelineSubmissions = sqliteTable('timeline_submissions', {
  id: text('id').primaryKey(),
  authorId: text('author_id').notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  reason: text('reason').notNull(),
  status: text('status', {enum: ['pending', 'shortlisted', 'declined']}).notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  reviewedAt: integer('reviewed_at'),
  reviewedBy: text('reviewed_by'),
  submissionKey: text('submission_key').notNull(),
}, table => [
  index('idx_submissions_author_created').on(table.authorId, table.createdAt),
  index('idx_submissions_status_created').on(table.status, table.createdAt),
  uniqueIndex('idx_submissions_author_key').on(table.authorId, table.submissionKey),
]);

export const submissionEvents = sqliteTable('submission_events', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id').notNull().references(() => timelineSubmissions.id),
  actorId: text('actor_id').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [index('idx_submission_events_submission').on(table.submissionId)]);
