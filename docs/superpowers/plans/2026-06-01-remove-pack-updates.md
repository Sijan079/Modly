# Remove Pack Updates Implementation Plan

**Goal:** Return the Updates page and backend to mod-only behavior while preserving ordinary pack management.

1. Remove pack artifact identity fields and ZIP hashing from pack runtime models and scanning. Leave the SQLite column dormant.
2. Clear `update_checks` at startup and strip legacy pack artifact metadata when pack records are scanned or edited.
3. Remove pack targets, checks, confirmation, replacement, statuses, and generalized artifact API from Rust.
4. Restore mod-only TypeScript types, API hook, bulk update logic, filters, and details.
5. Run Rust formatting, tests, compile check, frontend build, and restart Tauri dev.
