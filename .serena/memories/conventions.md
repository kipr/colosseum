# Codebase conventions

- Formatting: Prettier defaults plus single quotes; existing TypeScript uses semicolons and trailing commas from Prettier.
- TypeScript is strict. Client additionally rejects unused locals/parameters and switch fallthrough. Prefer explicit domain interfaces/types and `import type` for type-only imports.
- React: function components and hooks; JSX runtime means no React-in-scope import. Pages compose feature components; contexts own cross-page state such as auth, selected event, theme, and judge chat. CSS is primarily colocated beside pages/components.
- Client calls relative HTTP paths with `fetch`; authenticated requests normally pass `credentials: 'include'`. Development routing relies on Vite proxy entries, so new top-level backend route families may require a matching proxy rule.
- Backend layering: Express routers in `src/server/routes`; reusable business rules/calculations in `src/server/services`; middleware in `src/server/middleware`; configuration in `src/server/config`.
- Database access goes through the async `Database` abstraction in `src/server/database/connection.ts`. SQL generally uses `?` placeholders, converted by the PostgreSQL adapter. Keep SQLite/PostgreSQL behavior equivalent and use adapter transactions for multi-step state changes.
- Schema is modular: each `src/server/database/schema/*.ts` module contributes a `SchemaModule`; register it in `schema/index.ts`. Schema work requires SQLite tests and PostgreSQL parity awareness.
- Shared scoring/template contracts belong in `src/shared`, not duplicated between client and server. Validate untrusted schema-shaped data through shared validators.
- Tests mirror domains: `tests/client`, `tests/shared`, `tests/server`, `tests/http`, `tests/sql`; browser journeys live in `e2e`. HTTP tests create small Express apps with auth/judge-session shims and ephemeral ports; SQL tests use in-memory SQLite helpers.
- Preserve public/admin/judge authorization boundaries and event scoping when adding endpoints. Score acceptance, bracket advancement, ranking, queue versioning/sync, and audit effects are coupled workflows; change them transactionally and test side effects.