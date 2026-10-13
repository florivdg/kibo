CREATE TABLE "legal_terms_version" (
	"version" text PRIMARY KEY NOT NULL,
	"agb" text,
	"avv" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
