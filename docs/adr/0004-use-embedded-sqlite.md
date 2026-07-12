# Use embedded SQLite

The application process opens a SQLite database file directly on a persistent volume; SQLite does not run in a separate container. The server creates a consistent backup daily, retains 14 days, and creates another backup before every migration. The single-server deployment and expected event size favor one durable file and no additional database service, accepting that horizontal application scaling would require revisiting the database architecture.
