import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("created"), // created, payment_deposited, file_uploaded, under_review, revision_requested, completed
  buyerEmail: text("buyer_email").notNull(),
  sellerEmail: text("seller_email"),
  createdBy: text("created_by").notNull(), // "buyer" or "seller"
  deadline: timestamp("deadline"),
  fileName: text("file_name"),
  fileSize: text("file_size"),
  fileType: text("file_type"),
  filePath: text("file_path"),
  uploadedAt: timestamp("uploaded_at"),
  paymentStatus: text("payment_status").default("pending"), // pending, held, released
  buyerApproved: text("buyer_approved").default("false"), // "false", "true", "revision_requested"
  sellerApproved: text("seller_approved").default("false"), // "false", "true"
  currency: text("currency").default("USD"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`)
});

export const activities = pgTable("activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  description: text("description").notNull(),
  type: text("type").notNull(), // created, payment, upload, review, approval, completion
  createdAt: timestamp("created_at").default(sql`now()`)
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  uploadedAt: true,
  filePath: true,
  fileName: true,
  fileSize: true,
  fileType: true,
  deadline: true,
}).extend({
  deadline: z.string().optional().nullable().transform((val) => val ? new Date(val) : null)
});

export const insertActivitySchema = createInsertSchema(activities).omit({
  id: true,
  createdAt: true
});

export const updateProjectSchema = insertProjectSchema.partial();

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Project = typeof projects.$inferSelect;
export type Activity = typeof activities.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
