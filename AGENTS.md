# Project instructions

Follow the repository structure, language rules, commands, and quality gates in [CLAUDE.md](CLAUDE.md).

## Verification

- This is a public open source project. Use GitHub Actions for full verification when local runs are slow, resource-constrained, or affected by environment issues.
- Run focused reproductions and affected tests locally, then push the candidate branch and open or update its pull request to trigger the existing CI workflow.
- Verify that the CI run belongs to the exact candidate commit. Inspect every required job and retain its URL and results; a local environment failure remains documented even when remote checks pass.
- Preserve existing assertions, test deadlines, and Git hooks unless the owner approved the change (the owner removed the pre-commit hook on 2026-11-27; the gates run in pre-push and CI, see CLAUDE.md). Treat a failing GitHub Actions run as a failure to investigate.
- Do not merge or deploy as a consequence of choosing remote verification unless the user has authorized that action.

<!-- thc:begin -->

Telegram chat history is available through the thc skill. Use thc search when earlier chat context is needed.
<!-- thc:end -->
