# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.5.x-beta | :white_check_mark: |
| < 0.5.0 | :x: |

## Reporting a Vulnerability

If you discover a security vulnerability in dbcli, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **carllee1983@gmail.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgement**: within 48 hours
- **Initial assessment**: within 7 days
- **Fix release**: depends on severity, typically within 30 days

## Scope

Security issues we care about:
- SQL injection through CLI inputs
- Blacklist bypass (accessing protected columns/tables)
- Configuration file permission issues
- Credential exposure in logs or exports
- Dependency vulnerabilities

Thank you for helping keep dbcli safe.
