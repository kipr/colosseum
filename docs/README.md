# Colosseum Documentation

Current documentation:

- [API Testing](API_TESTING.md) — service startup, authentication, smoke tests,
  and the route catalog
- [Database Architecture](DATABASE.md) — PostgreSQL schema ownership and table
  map
- [Score Sheet Template Schema](TEMPLATE_SCHEMA_GUIDE.md) — template and field
  definitions
- [Formula Engine](formula-engine.md) and
  [Formula Grammar](formula-grammar.txt) — calculated-field language and runtime
  behavior
- [Queue Team Presence Tracking](QUEUE_TRACKING.md) — paired-match arrival state
  and API behavior
- [Botball 2026 Cube Stack Rules](BOTBALL_2026_CUBE_STACK_RULES.md) — domain
  rules and the implemented repeatable-group mapping
- [Portable Scoresheet Export](../tools/portable-scoresheet/README.md) — offline
  HTML export

## Legacy documents

Files in [`legacy/`](legacy/) are retained as historical design and migration
records. They are not specifications for the current application. When a
legacy document conflicts with source code or a current document, source code
and current documentation take precedence.
