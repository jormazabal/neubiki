# Contributing

Thanks for considering a contribution to Neubiki.

## License of Contributions

By submitting a contribution, you agree that it is licensed under the Apache
License, Version 2.0, the same license used by this repository.

Do not submit code, assets, text, generated output, or dependencies unless you
have the right to contribute them under Apache-2.0-compatible terms.

## Development

Install dependencies:

```bash
pnpm install
```

Run the frontend:

```bash
pnpm dev
```

Run the desktop app:

```bash
pnpm desktop
```

Run Rust runtime checks:

```bash
pnpm rust:test
```

Run the release gate:

```bash
pnpm release:check
```

## Pull Requests

- Discuss substantial changes in an issue before opening a pull request.
- Submit changes from a fork. The maintainer, [@jormazabal](https://github.com/jormazabal), reviews contributions and approves changes to the default branch. Repository write access is granted by invitation.
- Keep changes scoped.
- Add or update tests for behavioral changes.
- Update documentation when contracts, architecture, or release behavior change.
- Do not commit secrets, signing keys, local app data, generated build output,
  or private customer/project data.
