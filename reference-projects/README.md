# Reference Projects

This directory stores external repositories used only for comparison and implementation reference.

Rules:
- Keep third-party code inside its own subdirectory.
- Prefer shallow clones for faster setup.
- Do not mix reference code into the main project tree.
- Treat the contents here as read-only unless there is a clear reason to patch a local copy for inspection.

Current references:
- `N.E.K.O/`: shallow clone of `https://github.com/Project-N-E-K-O/N.E.K.O`
- Current local state: source snapshot downloaded from the `main` branch archive for reliable setup in this environment

Bootstrap:
- Run `pwsh -File scripts/setup-reference-projects.ps1`
- Use `-Force` to recreate a broken or partial clone
