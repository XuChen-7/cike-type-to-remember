import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(), tokenHash: text('token_hash').notNull().unique(), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
});
export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }), name: text('name').notNull(), color: text('color').notNull().default('#1d6b5b'), coverType: text('cover_type').notNull().default('COLOR'), coverValue: text('cover_value'), sortOrder: integer('sort_order').notNull().default(0), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_cards_workspace').on(table.workspaceId)]);
export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(), cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }), name: text('name').notNull(), sortOrder: integer('sort_order').notNull().default(0), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_folders_card').on(table.cardId)]);
export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(), folderId: text('folder_id').notNull().references(() => folders.id, { onDelete: 'cascade' }), term: text('term').notNull(), meaning: text('meaning').notNull(), normalizedTerm: text('normalized_term').notNull(), sortOrder: integer('sort_order').notNull().default(0), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_entries_folder').on(table.folderId)]);
export const practiceSessions = sqliteTable('practice_sessions', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }), practiceType: text('practice_type').notNull(), contentMode: text('content_mode').notNull(), scopeKey: text('scope_key').notNull(), scopeLabel: text('scope_label').notNull(), totalCount: integer('total_count').notNull(), correctCount: integer('correct_count').notNull(), accuracy: real('accuracy').notNull(), averageItemMs: integer('average_item_ms').notNull(), itemsPerMinute: real('items_per_minute').notNull(), completedAt: integer('completed_at').notNull(),
}, (table) => [index('idx_sessions_compare').on(table.workspaceId, table.scopeKey, table.practiceType, table.completedAt)]);
