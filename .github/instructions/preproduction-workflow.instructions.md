---
description: Use for feature development, Cloudflare deployments, and migrations in this repository.
applyTo: '**/*'
---

# Preproduction and feature workflow

- Treat `casacareca.pages.dev` as shared preproduction for tests and experiments; its database and notifications are shared resources.
- Test isolated features on a dedicated Git branch and a separate Cloudflare application with separate resources. Do not connect feature experiments to the shared preproduction database.
- Keep the feature branch and application isolated through testing and user acceptance. Move accepted changes to `main` only after explicit user approval.
- Do not perform production migrations or deploy feature work to `main` without an explicit user command.
