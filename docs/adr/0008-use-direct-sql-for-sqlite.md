# Use direct SQL for SQLite access

The server uses `better-sqlite3`, prepared statements, small typed repository functions, and immutable numbered SQL migrations instead of an ORM. The schema is small enough for explicit SQL to remain reviewable, and this avoids adding a second query abstraction while preserving transactions, constraints, and a straightforward future migration path.
