## What changes

<!-- One or two sentences. What does this PR do, and why? -->

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] CI / tooling
- [ ] Refactor (no behaviour change)

## Security impact

- [ ] Touches `lib/jsx-safe.js` — escaping, validation, or the allowed-directory check
- [ ] Touches the platform driver: the PowerShell or AppleScript runner, or the temp files
- [ ] Touches the generic layer (`set_properties`, `call_method`) or its allow-lists
- [ ] Adds a tool argument that reaches the generated ExtendScript
- [ ] No security-relevant surface touched

If any box above is checked, say what changes in the threat model, and add a
payload case to `test/injection.test.mjs` or `test/generic.test.mjs`. A helper
without a payload test is an assertion, not a guarantee.

<!-- ... -->

## Verification

- [ ] `npm run lint` passes
- [ ] `npm test` passes (number of cases: ______)
- [ ] `npm run verify-api` passes against a running InDesign (version: ______)
- [ ] Ran the end-to-end script for the area you touched, and it reads the
      result back out of the document rather than trusting a return message
- [ ] No hardcoded paths, hostnames or personal data added

`node --check` validates the server, never the ExtendScript it generates. A
broken template passes the syntax check and fails inside InDesign, so
`npm test` is not optional when you touch a script template.

If you set a DOM property or name an enum member, `npm run verify-api` is not
optional either. A name this InDesign version dropped does not fail quietly —
it aborts the whole call, and the tool looks broken for unrelated reasons.

## Related issues

Closes #
