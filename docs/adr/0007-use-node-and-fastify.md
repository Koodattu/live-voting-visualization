# Use Node.js and Fastify for the application server

The application server uses TypeScript on Node.js 24 LTS with Fastify 5 for HTTP routing, static delivery, request validation, and lifecycle management. This provides a supported long-running runtime and a small schema-aware API layer while allowing Socket.IO and embedded SQLite to remain explicit application components.
