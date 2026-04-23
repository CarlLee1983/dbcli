# Security Policy

This policy applies to **[dbcli](https://github.com/CarlLee1983/dbcli)** (npm: `@carllee1983/dbcli`).

## Supported Versions

We provide security fixes for the **current major version line** on the [default branch](https://github.com/CarlLee1983/dbcli) and backport **critical** fixes to the **latest published minor** when practical.

| Version   | Status |
| --------- | ------ |
| **1.x**   | :white_check_mark: **Supported** — use the latest 1.x patch (see [CHANGELOG.md](CHANGELOG.md)). |
| **&lt; 1.0** (legacy / pre-release tags) | :x: **Not supported** — upgrade to **1.x**. |

If you are unsure which release you run: `dbcli --version` or `npm list -g @carllee1983/dbcli`.

## Reporting a Vulnerability

Please report security issues **privately** so we can address them before public disclosure.

**Do not** open a **public** GitHub issue for vulnerability reports (use a private channel below).

**Preferred (if available on the repo):** [GitHub **Report a vulnerability**](https://github.com/CarlLee1983/dbcli/security) — *Security* tab → *Report a vulnerability*.

**Or email:** **carllee1983@gmail.com**

Include where possible:

- A short description of the issue and affected area (CLI, config, a specific command, a dependency, etc.)
- **Steps to reproduce** (or a proof-of-concept) and your **dbcli / OS / Node or Bun** versions
- **Impact** (e.g. data exposure, auth bypass, arbitrary file access)
- **Suggested fix** (optional)

We may ask for follow-up details on a private thread.

## Response Timeline

- **Acknowledgement:** within **72 hours** (business days)
- **Initial assessment:** within **7 days** when possible
- **Remediation:** depends on severity; **critical** issues are prioritized; typical goal for a **patched release** is within **30 days** (not a guarantee for every class of issue)

We will coordinate disclosure after a fix is available, unless a shorter public timeline is required by a coordinated disclosure process you use.

## Scope (in scope for this policy)

We consider reports relevant when they affect **this repository’s shipped CLI** and **documented** behavior, for example:

- **Injection** — e.g. SQL or query handling that allows unintended execution beyond the user’s permission model
- **Authorization / data boundaries** — bypass of **permission levels**, **blacklist** rules, or cross-connection / cross-tenant data access
- **Secrets and configuration** — exposure of **credentials** or project binding data (including paths under `~/.config/dbcli/`, `.dbcli/`, and env files used by the tool)
- **Output & exports** — unintended **credential** or **sensitive** data in **logs**, **stdout**, or **export** files
- **Dependencies** — known **CVEs** in direct dependencies of the published package (we triage; not every advisory may warrant an immediate release)
- **MongoDB / network** — issues specific to how the CLI builds connections, handles SRV, or processes JSON filters when they lead to a security impact

**Out of scope (examples):** social engineering; bugs with no security impact; issues in your database server or driver versions unless the CLI is clearly the unsafe component; **denial of service** against a local `dbcli` process **without** a plausible confidentiality or integrity impact (we may still track these as regular bugs).

## Coordinated disclosure

We support responsible disclosure. If you plan a **CVE** or **public** write-up, please give us a reasonable window to ship a fix and release notes.

Thank you for helping keep dbcli and its users safe.
