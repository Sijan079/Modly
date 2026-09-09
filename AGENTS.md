# Engineering Guidelines

These guidelines apply to all work in this repository. They bias toward caution
over speed; use judgment for trivial changes.

## Think Before Coding

- State assumptions explicitly. If uncertain, ask rather than guess.
- When multiple interpretations are plausible, surface them rather than silently
  choosing one.
- Call out a simpler approach when it exists, and push back when warranted.
- If essential context is unclear, explain what is unclear and ask for it.

## Simplicity First

- Implement the minimum code that solves the requested problem.
- Do not add unrequested features, configurability, or speculative abstractions.
- Avoid error handling for impossible scenarios.
- Simplify an implementation when it is materially more complex than necessary.

## Surgical Changes

- Change only files and lines needed for the request.
- Do not refactor or reformat unrelated code, comments, or files.
- Match the existing style.
- Remove only imports, variables, or code made unused by your own change.
- Mention pre-existing dead code rather than deleting it unless asked.

Every changed line should trace directly to the requested work.

## Goal-Driven Execution

- Define concrete success criteria before non-trivial implementation.
- For bug fixes, reproduce the issue in a test when practical, then verify the
  fix.
- For refactors, verify behavior before and after the change.
- For multi-step work, state a brief plan and the verification for each step.
- Continue until the agreed success criteria are verified.
