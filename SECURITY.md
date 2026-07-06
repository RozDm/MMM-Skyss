# Security Policy

## Supported versions

Only the latest release on the `main` branch is supported. Please update before
reporting an issue to confirm it still reproduces.

## Reporting a vulnerability

Please report security issues **privately** rather than opening a public issue.

Use GitHub's private vulnerability reporting for this repository:
**Security → Advisories → Report a vulnerability**
(<https://github.com/RozDm/MMM-Skyss/security/advisories/new>).

Include steps to reproduce, the affected version, and the impact you observed.
You can expect an acknowledgement within a reasonable time, and a fix or
follow-up once the report has been assessed.

## Scope

This module reads a public departures API and renders text on a local
MagicMirror. It has **no runtime dependencies** and stores no secrets, so the
most relevant concerns are how untrusted API responses are parsed and rendered.
Findings in those areas are especially welcome.
