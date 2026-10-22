"""İkinci migration. Tablo adımı biter, satır adımı yarım kalırsa kaldığı yerden sürer."""

STEPS = [
    """
    CREATE TABLE IF NOT EXISTS storage_marker (
      id INTEGER NOT NULL PRIMARY KEY,
      note VARCHAR(64) NOT NULL
    )
    """,
    """
    INSERT INTO storage_marker (id, note)
    SELECT 1, 'ready'
    WHERE NOT EXISTS (
      SELECT 1 FROM storage_marker WHERE id = 1
    )
    """,
]
