CREATE TABLE "chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mood" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"partner_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "connected_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"mood" text NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"disconnected_at" timestamp,
	CONSTRAINT "connected_users_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "mood_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mood" text NOT NULL,
	"socket_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mood_queue_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_active_idx" ON "chat_sessions" USING btree ("user_id") WHERE is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "connected_user_idx" ON "connected_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_id_idx" ON "mood_queue" USING btree ("user_id");