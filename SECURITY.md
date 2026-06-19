# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Email security reports to the maintainers via GitHub private vulnerability
reporting on [poko-sh/poko-cli](https://github.com/poko-sh/poko-cli), or open a
private security advisory if you have maintainer access.

Please include:

- A clear description of the issue
- Steps to reproduce
- Impact assessment (what data or systems are affected)
- Your environment (OS, Bun version, affected agents)

We aim to acknowledge reports within 72 hours.

## Scope notes

Poko is a **local-first CLI**. The open-source tool:

- Reads and writes files on your machine (agent config, SQLite stores, `.poko/`)
- Does not send project chat history to Poko servers in the free CLI
- May surface MCP server configuration; review `poko doctor` warnings before sync

Treat `poko sync` and `poko restore` like any tool that modifies local agent
state: use `--dry-run` first, and `--backup` when overwriting static files.
