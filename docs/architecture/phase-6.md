# Phase 6 — Add on-demand community issue intelligence for crash investigation

Source: [GitHub issue #7](https://github.com/Sijan079/Modly/issues/7)

## Goal
Use the issue/source links exposed by mod providers to find **similar community reports** for the small set of mods identified during crash investigation.

This is supporting evidence, not automated root-cause attribution.

## Architecture
Do **not** crawl/index every issue for every installed mod during normal pack scans.

Preferred flow:

`crash → local evidence extraction → candidate mods → issue-source lookup → cache/search relevant trackers → similarity ranking → user reviews original report`

## Tasks
- [ ] Store provider-supplied issue/source URLs for installed projects when available.
- [ ] Normalize supported repository/issue hosts, starting with GitHub where practical.
- [ ] Introduce an `issue source registry` containing project/mod mapping, issue URL, source URL, repository identity, provider, and last-check metadata.
- [ ] Search remote issue trackers **on demand** only for crash candidates.
- [ ] Build search queries from distinctive crash evidence: exception type, symbols/namespaces, mod/version, Minecraft version, loader, and interacting mods.
- [ ] Cache issue metadata/results locally with sensible freshness/TTL behavior.
- [ ] Avoid downloading or mirroring entire issue trackers.
- [ ] Rank results by similarity/relevance rather than "probability this caused the crash."
- [ ] Show matching and differing signals for each result.
- [ ] Link directly to the original issue for user verification.
- [ ] Handle missing issue trackers, non-GitHub trackers, inaccessible repositories, API failures, and rate limits gracefully.
- [ ] Never make Pack Health dependent on successful external issue searches.

## Evidence authority
Community evidence should distinguish, where detectable:
- **Maintainer-confirmed issue/fix**
- **Duplicate pointing to another report**
- **Similar community report**
- **Unresolved/unverified report**

A random issue report must never automatically become a known incompatibility.

## Example UX
> **3 similar reports found**
>
> Issue #123 — Startup crash after updating ExampleMod
>
> Similarities:
> - Same exception type
> - Same Minecraft version
> - Same installed mod version
>
> Differences:
> - Different loader version
>
> **This does not confirm that the report describes the cause of your crash.**
>
> View original issue

## Acceptance criteria
- Normal pack health scans make no bulk GitHub issue requests.
- Crash investigation searches only a bounded candidate set.
- Cached results prevent unnecessary repeat calls.
- API/rate-limit failure degrades to local diagnostics rather than breaking the investigation.
- Similar reports are clearly presented as supporting evidence, not conclusions.
