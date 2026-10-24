import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { InterviewSessionStatus } from './interview/InterviewSession';

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// ─── Refresh Tokens ──────────────────────────────────────────────────────────

export const refreshTokens = sqliteTable("refresh_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  revoked: integer("revoked", { mode: "boolean" }).default(false),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export type RefreshToken = typeof refreshTokens.$inferSelect;

// ─── Trial Usage ─────────────────────────────────────────────────────────────

export const trialUsage = sqliteTable("trial_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id)
    .unique(),
  usedSeconds: real("used_seconds").default(0),
  totalAllowedSeconds: real("total_allowed_seconds").default(3600), // 1 hour
  lastUpdated: text("last_updated").default(sql`(datetime('now'))`),
});

export type TrialUsage = typeof trialUsage.$inferSelect;

// ─── Subscriptions ───────────────────────────────────────────────────────────

export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id)
    .unique(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  status: text("status").notNull().default("inactive"), // active | inactive | past_due | canceled
  plan: text("plan").default("monthly"),
  currentPeriodEnd: text("current_period_end"),
  gracePeriodEnd: text("grace_period_end"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

// ─── Interview Sessions ──────────────────────────────────────────────────────

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  companyName: text("company_name").default(""),
  jobDescription: text("job_description").default(""),
  resumeText: text("resume_text").default(""),
  skillsJson: text("skills_json").default("[]"), // JSON array of strings
  notes: text("notes").default(""),
  status: text("status")
    .$type<InterviewSessionStatus>()
    .notNull()
    .default(InterviewSessionStatus.CREATED),
  failureCode: text("failure_code"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const insertSessionSchema = createInsertSchema(sessions, {
  status: z.nativeEnum(InterviewSessionStatus).optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

// ─── Messages ────────────────────────────────────────────────────────────────

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").references(() => sessions.id),
  userId: integer("user_id").references(() => users.id),
  transcription: text("transcription").notNull(),
  aiResponse: text("ai_response").notNull(),
  interviewType: text("interview_type").default("general"),
  audioDurationSeconds: real("audio_duration_seconds").default(0),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
