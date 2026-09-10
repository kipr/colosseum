# Contributing

Thanks for helping improve KIPR's software. These guidelines apply to everyone,
whether you write the code yourself or with an AI coding agent. Agents also
read [AGENTS.md](AGENTS.md), which describes this repository in detail.

New to Colosseum? Start with [README.md](README.md) for setup, and use the
devcontainer (see [.devcontainer/README.md](.devcontainer/README.md)) to get a
working environment with PostgreSQL already running.

## Branches

Name branches after the person who owns the change, followed by a short topic:

```
<name>/<topic>        e.g. jdoe/bracket-bye-placement
```

This applies to agent-written changes too: the branch names the person
responsible for it. Branch from `master` and open pull requests against
`master`. If you don't have write access, work from a fork.

## Plan first

For anything beyond a small, obvious fix, write a short plan before changing
code: what you'll change, which files it touches, and how you'll verify it. Get
it reviewed before you start, in an issue, a draft pull request, or with the
maintainer you're working with. A wrong approach is much cheaper to catch in a
plan than in code review.

If you're working with an agent, have it present its plan and review the plan
yourself before it edits anything.

## Keep changes focused

- Make one logical change per pull request.
- Work within the existing architecture and conventions described in
  AGENTS.md. If you think the architecture itself should change, propose that
  separately.
- Don't reformat, rename, or reorganize code you aren't otherwise changing; it
  buries the real change in review. Preserve each file's existing formatting
  and line endings.

## Build for what's needed now

Avoid speculative changes: no abstractions, options, or extension points for
features that don't exist yet. If you spot a future need, open an
issue for it instead.

## Comments

Comment what a reader can't see from the code: competition rules and scoring
formulas, PostgreSQL or browser quirks, links to the relevant game rules or
docs, and the reason behind a non-obvious choice.
Don't describe what the code plainly does, and don't commit commented-out code;
version control keeps the history.

## Documentation

Update documentation in the same pull request as the change that affects it:
README.md, AGENTS.md, CONTRIBUTING.md, and anything under `docs/`.

## Pull requests

Open pull requests as drafts while they're in progress. The description should
cover what changed and why, how you verified it, and anything left undone.
State plainly what wasn't tested rather than implying it was.

## This repository

- CI runs Prettier, ESLint, both typechecks, the Vitest suite, and the build on
  every pull request. Run the same checks locally before opening one:
  `npm run pretty && npm run lint && npm run typecheck:client &&
npm run test:run && npm run build` (see
  [AGENTS.md](AGENTS.md#standard-commands-see-packagejson)). Outside the
  devcontainer, start PostgreSQL first with `npm run db:up && npm run db:wait`.
- CI does not run the Playwright suite. Changes to judge, admin, or spectator
  flows need `npm run test:e2e` run locally; say in the pull request whether
  you ran it.
- Schema changes go in the modules under `src/server/database/schema/` and are
  applied at server start against the existing production database, so they
  must be idempotent and additive: add columns through a module's `columns`
  list rather than editing an existing `CREATE TABLE`. Update the Database
  Schema section of the README in the same pull request.
- Changes to score sheet templates or field types must keep existing templates
  working and update
  [docs/TEMPLATE_SCHEMA_GUIDE.md](docs/TEMPLATE_SCHEMA_GUIDE.md). Note in the
  pull request whether the change affects the portable scoresheet exporter.
- Production deploys from version tags via Cloud Build (`cloudbuild.yaml`);
  merging to `master` does not deploy. Don't push tags or change deployment
  configuration without the maintainer's agreement.
