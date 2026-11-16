CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, branch TEXT NOT NULL, environment TEXT NOT NULL,
 endpoint TEXT NOT NULL, schema_sdl TEXT NOT NULL, schema_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS executions (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), test_name TEXT NOT NULL,
 operation TEXT, operation_name TEXT, query_text TEXT NOT NULL, analysis TEXT NOT NULL,
 status INTEGER NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL, graphql_errors INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS execution_run ON executions(run_id, created_at);
--> statement-breakpoint
