# Security reporting and boundaries

This project is a local application and is currently distributed as a release candidate. Keep its HTTP listener on localhost. Do not expose an unauthenticated instance directly to the internet.

For a suspected vulnerability, use this repository's private vulnerability reporting option if it is available. Otherwise open an issue containing only a short, non-sensitive description and ask the maintainer for a private reporting channel. Do not post API keys, cookies, personal stories, downloaded cards, exploit payloads containing private data, or backups in a public issue.

Third-party scripts and frontends require the application's review and isolation controls. Compatibility does not grant a script permission to access credentials or the host filesystem. Report any bypass of those boundaries. Raw community resources and provider credentials must remain outside Git; see [repository content policy](docs/repository-content-policy.md).

There is no guaranteed response time or claim that this candidate has received a complete security audit. Only the current candidate is under active maintenance; fixes should be verified against the exact revision in the report.
