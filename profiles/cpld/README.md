# CPLD profile

This directory is a placeholder. It intentionally has no `PROMPT.md`.

`glue --profile cpld` resolves the name but loads no extra instructions until a prompt file is added here or in the project's `.agent/profiles/cpld/PROMPT.md`. Do not put toolchain or device logic in the core CLI; keep it in that prompt (and later, tools registered by the profile).
