-- oura-export: D1 → R2 Iceberg エクスポートの最終実行日を管理
-- 既存の id='oura' (API 取り込み日) とは別の用途
INSERT OR IGNORE INTO sync_state (id, data_source_id, last_sync_at)
VALUES ('oura-export', 'oura', NULL);
