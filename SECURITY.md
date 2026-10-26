# Security

Glue Cli runs on your machine and can read and edit the workspace you point it at. The shell tool is off until you enable it. File tools refuse paths outside the workspace, including symlink escapes. Deny rules and `.git/**` stay denied even in bypass mode.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/Zeuss64/glue-cli/security/advisories/new) for issues that could let a prompt, path, or tool call escape the workspace, leak a key, or run a command the user did not allow.

Do not open a public issue for an unfixed vulnerability, and do not paste API keys or session files into a report.

If private reporting is unavailable, email the maintainer through the address on their GitHub profile and include the words "Glue Cli security".

## Supported versions

Security fixes land on `main`. This project is pre-1.0 (`0.1.x`).
