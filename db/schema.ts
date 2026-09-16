import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
