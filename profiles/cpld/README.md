# CPLD profile

`PROMPT.md` is the CPLD system prompt v0.5, the same text as `profiles/default/PROMPT.md`.

`glue --profile cpld` loads it. A normal install leaves the profile at `default` and loads the same prompt from `profiles/default/PROMPT.md`. Do not put toolchain or device logic in the core CLI; keep it in this prompt.
