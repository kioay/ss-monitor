# Project Rules

- After each implementation iteration, run the relevant local checks before handoff.
- Keep `.env`, credentials, cookies, deploy archives, `node_modules`, and build output out of Git.
- Production deploy archives must include a freshly generated `dist/` directory even though `dist/` stays out of Git. Use `scripts/create-deploy-archive.ps1` or an equivalent archive process; do not rely on the server to build frontend assets because production installs omit dev dependencies.
- Every completed iteration must be committed and pushed to the configured Git remote before reporting completion, unless the user explicitly asks not to push.
- Use concise commit messages that describe the shipped change.
- Do not rewrite shared history or force-push unless the user explicitly approves it.
