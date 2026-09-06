# Contributing

Thanks for taking the time. This project is small and maintained in spare time — the rules below exist so a pull request can be reviewed in one sitting.

## Before you open a pull request

- Open an issue first for anything beyond a typo. A rejected PR wastes more of your time than a rejected issue.
- One change per PR. A refactor bundled with a fix is two PRs.
- Security issues never go into a public PR or issue — see [SECURITY.md](SECURITY.md).

## Development setup

```bash
git clone https://github.com/studio-prisma/indesign-mcp-server.git
cd indesign-mcp-server
npm ci
npm test          # 306 cases, no InDesign required
```

The test suite mocks the platform driver, so you can work on argument
handling and script generation without InDesign installed. Only `npm run
smoke`, `npm run verify-api` and the `npm run e2e-*` scripts need a running
instance.

Requirements are listed in [README.md](README.md#requirements). State versions you have verified, not versions you expect to work.

## What a change has to pass

```bash
npm run lint      # syntax check
npm test          # 306 cases
```

If your change touches a script template, `npm test` is not optional:
`node --check index.js` validates the server, never the ExtendScript it
generates. A broken template passes the syntax check and fails inside
InDesign.

If your change touches `lib/jsx-safe.js`, add a case to
`test/injection.test.mjs`. A helper without a payload test is an
assertion, not a guarantee.

If your change sets a DOM property or names an enum member, add it to
`scripts/verify-api.mjs` and run it against a real InDesign. A name this
version dropped does not fail quietly — it aborts the whole call, and the tool
looks broken for reasons unrelated to what it was asked to do. Reading the
code cannot catch that; only asking the application can.

Read values back out of the document in the end-to-end scripts rather than
trusting a return message. A tool reports what it did; only the document says
what happened.

CI runs the same checks on every push and pull request. The aggregating job is called **Gate**; it is the only status check the branch protection requires, and it is green only when every other job is.

A red pipeline is not mergeable. If a check fails for a reason unrelated to your change, say so in the PR instead of rerunning until it passes.

## Code conventions

- Match the surrounding style. This project does not have a formatter config for you to argue with.
- No new runtime dependency without a reason in the PR description.
- Comments explain *why*, not *what*. The code already says what.
- Code, comments and error messages are English. The German README is the only translated file.
- Generated ExtendScript must stay ES3: no template literals, no `let`/`const`, no arrow functions. The test suite enforces this.
- No placeholder or example data pointing at real hosts. Use `example.com`, `192.0.2.0/24`, `203.0.113.0/24`.

## Documentation

Documentation is part of the change, not a follow-up.

- Behaviour change → update `README.md` **and** `README.de.md` in the same PR.
- Anything a caller has to know *before* choosing a tool → `lib/guide.js`. It
  is served as the `indesign://guide` MCP resource, which is the only
  documentation the model reads. A tool description is the wrong place for it:
  it is read when the model is already reaching for that tool.
- Setup or configuration change → update the setup section of both READMEs. There is no separate install guide: setup is `npm ci` plus one JSON block, and a second copy would only drift.
- New limitation discovered → add it to "Known limitations". A limitation users find in production is a bug report; one they read in advance is a decision.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), imperative, English:

```
feat(driver): fall back to the generic ProgID when versioned lookup fails
fix(jsx-safe): escape U+2028 in json() as well as in str()
docs(readme): state which InDesign versions are actually verified
ci: pin actions to major versions
```

## Release process

Maintainer only.

1. `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty `Unreleased` block
2. bump the version in the manifest — it lives in exactly one place
3. `git commit -m "chore(release): vX.Y.Z"`, merge via PR
4. `git tag -a vX.Y.Z -m "vX.Y.Z"` from the merged `main`, push the tag
5. the release workflow builds the artifact and publishes the notes from the changelog

Tags are protected: they cannot be moved or deleted. A wrong tag is corrected with the next patch version, never by overwriting.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
