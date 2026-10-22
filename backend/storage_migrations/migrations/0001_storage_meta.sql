-- v2 ilk şema işareti
CREATE TABLE IF NOT EXISTS storage_meta (
  meta_key VARCHAR(64) NOT NULL PRIMARY KEY,
  meta_value VARCHAR(255) NOT NULL
);

INSERT INTO storage_meta (meta_key, meta_value)
SELECT 'schema', 'v2'
WHERE NOT EXISTS (
  SELECT 1 FROM storage_meta WHERE meta_key = 'schema'
);
