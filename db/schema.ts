import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("lobby"),
    currentQuestion: integer("current_question").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_rooms_code").on(table.code)],
);

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    score: integer("score").notNull().default(0),
    joinedAt: integer("joined_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [index("idx_players_room_score").on(table.roomId, table.score)],
);

export const answers = sqliteTable(
  "answers",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    questionIndex: integer("question_index").notNull(),
    optionIndex: integer("option_index").notNull(),
    isCorrect: integer("is_correct").notNull(),
    points: integer("points").notNull(),
    scoreApplied: integer("score_applied").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_answers_player_question").on(table.playerId, table.questionIndex),
    index("idx_answers_room_question").on(table.roomId, table.questionIndex),
  ],
);

export const scoreEvents = sqliteTable(
  "score_events",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    kind: text("kind").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_score_events_room_created").on(table.roomId, table.createdAt)],
);
