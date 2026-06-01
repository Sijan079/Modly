# Settings Planner Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Settings into planner preferences by removing launcher-oriented Java/memory controls and adding export default paths plus planner workflow settings.

**Architecture:** Extend the existing `AppSettings` model with planner/export preferences stored in the existing key-value settings table. Update Settings UI to edit these persisted preferences, then update export flows to use the configured default folders for ZIP and modlist save dialogs.

**Tech Stack:** Tauri Rust commands, SQLite via existing database service, React, TanStack Query, Tauri dialog plugin.

---

### Task 1: Extend Persisted Settings

**Files:**
- Modify: `src-tauri/src/models/settings.rs`
- Modify: `src-tauri/src/services/database.rs`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add planner settings fields**

Add optional export paths and workflow preferences to `AppSettings` in Rust and TypeScript:

```rust
pub export_modpack_dir: Option<String>,
pub export_modlist_dir: Option<String>,
pub auto_scan_on_instance_add: bool,
pub auto_scan_after_mod_add: bool,
pub auto_audit_after_scan: bool,
pub audit_stale_days: u32,
pub include_disabled_mods_in_exports: bool,
pub include_audit_in_exports: bool,
```

Defaults should enable current preload behavior, set audit staleness to 7 days, and keep export folders unset.

- [ ] **Step 2: Persist the new settings keys**

Update `Database::get_settings` and `Database::save_settings` to read/write the new keys using the current settings table.

### Task 2: Redesign Settings UI

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Remove launcher controls**

Remove Java executable, auto-detect Java, memory allocation, and disabled integration switches from the Settings page.

- [ ] **Step 2: Add planner sections**

Render sections for Workspace Defaults, Export Defaults, Scan & Preload, Audit & Health, Catalog & Reports, and Logs & Data. Use folder pickers for path fields, switches for booleans, and a numeric input for audit stale days.

### Task 3: Use Export Defaults

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/Instances.tsx`
- Modify: `src/pages/Mods.tsx`

- [ ] **Step 1: Add helper behavior inline**

Use configured export folders as the `defaultPath` prefix for ZIP and HTML export save dialogs.

- [ ] **Step 2: Preserve current fallback behavior**

When no export folder is configured, keep the current filename-only default paths.

### Task 4: Verify

**Files:**
- Test commands only.

- [ ] **Step 1: Type-check frontend**

Run: `npx tsc --noEmit`

- [ ] **Step 2: Check Rust**

Run: `cargo check` from `src-tauri`

- [ ] **Step 3: Production build**

Run: `npm run build`; if sandbox blocks Vite/esbuild with `spawn EPERM`, rerun with approved escalation.
