## What changes

<!-- One or two sentences. What does this PR do, and why? -->

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] CI / tooling
- [ ] Refactor (no behaviour change)

## Security impact

- [ ] Touches token validation, the siteverify call, or the fail mode
- [ ] Touches the login gate or the CSP handling
- [ ] Touches configuration validation (`pre_save`)
- [ ] No security-relevant surface touched

If any box above is checked, describe the threat model change:

<!-- ... -->

## Verification

- [ ] `tests/run-all.sh` passes locally (state your PHP version: ______)
- [ ] Verified against a real osTicket 1.18.x instance
- [ ] Secret key does not appear in HTML, logs, or error messages
- [ ] No hardcoded hostnames, credentials, or absolute paths added

## Related issues

Closes #
