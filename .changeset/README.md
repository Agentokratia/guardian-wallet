# Changesets

This project uses [changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

## Adding a changeset

When you make a change that should be released, run:

```bash
pnpm changeset
```

This will prompt you to:
1. Select which packages are affected
2. Choose a bump type (patch / minor / major)
3. Write a summary of the change

A markdown file is created in `.changeset/`. Commit it with your PR.

## What happens on merge

When your PR merges to `main`, the release workflow:
1. Collects all pending changesets
2. Opens a "Version Packages" PR that bumps versions and updates CHANGELOG.md
3. When that PR merges, packages are published to npm automatically

## No changeset needed?

If your change doesn't affect published packages (docs, tests, CI config), run:

```bash
pnpm changeset --empty
```
