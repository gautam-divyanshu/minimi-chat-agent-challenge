-- Keyword recall over past messages. External-content FTS5 table: the text
-- lives once in `messages`; triggers keep the index in sync.
CREATE VIRTUAL TABLE `messages_fts` USING fts5(
  text,
  content='messages',
  content_rowid='id',
  tokenize='porter unicode61'
);
--> statement-breakpoint
CREATE TRIGGER `messages_fts_ai` AFTER INSERT ON `messages` BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER `messages_fts_ad` AFTER DELETE ON `messages` BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER `messages_fts_au` AFTER UPDATE OF text ON `messages` BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
