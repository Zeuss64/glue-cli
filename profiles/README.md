# Profiles

A profile is a markdown system prompt, not code. Glue loads it after the built-in instructions and before project memory (`AGENT.md`).

Lookup order for `--profile <name>` (or `profile` in config):

1. `<workspace>/.agent/profiles/<name>/PROMPT.md`
2. `<package>/profiles/<name>/PROMPT.md`

Both files are concatenated when both exist. The workspace copy comes first. A profile can change vocabulary and workflow. It cannot widen the workspace sandbox or override a permission denial.

`default` is the profile a normal install uses (`profile = "default"`). It loads `profiles/default/PROMPT.md`, the CPLD system prompt v0.5. `cpld` loads the same prompt from `profiles/cpld/PROMPT.md`, so `--profile cpld` matches the default.
