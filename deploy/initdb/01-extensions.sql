-- Runs once, when the database volume is first created.
-- pgvector stores textbook embeddings (content_chunks.embedding).
CREATE EXTENSION IF NOT EXISTS vector;
