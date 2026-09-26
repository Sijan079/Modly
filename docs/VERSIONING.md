# Application versioning

Modly desktop releases follow [Semantic Versioning 2.0.0](https://semver.org/)
(`MAJOR.MINOR.PATCH`). Treat existing pack data, settings, and documented
workflows as the compatibility surface. Increment MAJOR for incompatible
changes, MINOR for backward-compatible features, and PATCH for
backward-compatible fixes. For a maintenance build without a supplied version,
increment PATCH unless a same-version rebuild was explicitly requested. A
frontend-only verification build does not create a new release version.

Keep the same application version in all five places:

- `package.json`: root `version`
- `package-lock.json`: top-level `version` and `packages[""].version`
- `src-tauri/Cargo.toml`: `[package].version`
- `src-tauri/Cargo.lock`: `[[package]]` named `modpack-manager`
- `src-tauri/tauri.conf.json`: `version`

Before packaging, verify that these values match and that the intended version
is higher than the previous release, except for an explicitly requested
same-version rebuild. After packaging, verify the version embedded in the
desktop artifact and its final filename, then report both. Do not infer the
artifact version from source files alone.
