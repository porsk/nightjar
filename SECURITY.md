# Security policy

Nightjar holds personal journal data, so we take security seriously.

## Reporting a vulnerability

Please report it privately with GitHub private vulnerability reporting:
[Report a vulnerability](https://github.com/porsk/nightjar/security/advisories/new).

Do not open a public issue, pull request or discussion for a security bug. Include what you found, how to
reproduce it, and which version or image tag you used. Please don't include real journal content.

You can expect a first reply within a few days. This is a small open source project, so fixes are best effort,
but security problems come first.

## In scope

- The Nightjar server, web app and Docker image (`porsk/nightjar`)
- Login, sessions, access tokens and the MCP server
- Anything that exposes journal text, audio, photos or transcripts to someone who should not see them
- Anything that makes the app send data out without the owner turning that on

## Out of scope

- Problems in your own setup (open ports, weak passwords, no HTTPS in front of the server)
- Vulnerabilities in third-party software that are already reported upstream (tell us if a Nightjar update is needed)
- Denial of service that needs an already logged-in owner

## Supported versions

Early development: only the latest `edge` build and, once released, the latest release get fixes.
