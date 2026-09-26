# Historical feature notes

These notes predate the current [product boundary](docs/PRODUCT.md) and [architecture phases](docs/architecture/phase-0.md). Treat them as history, not the active roadmap.

Modly 1.2.2



1. export to .zip to also be included in actions in mod pages
2. export to .zip to have select mods either by for player (client \& both) for server (server \& both), by genre, by state (enabled or disabled)
3. relationship page, mod bridges



Modly 1.2.3



1. Automatic dependency detector - read \[META-INF/neoforge.mods.toml] from each .jar of the mod and build relationships from that; still allow editing in case of mismatch and breakage
2. base is maximized window, add support for fullscreen and windowed sizes



Modly 1.3



1. UI-focused changes, tokenization of elements for better consistency across the app
2. animations and better icons
3. UI/UX audit (focus on consistency)
4. several other themes + light mode
5. Source column in Mod Suggestions to be renamed as 'Link' and then use the same style as showing the icons of Modrinth and Curseforge if detected coming from either sources



Modly 1.4



1. Performance optimizations and security audits for the entire app
2. Logs page, more actions to be logged
3. audit Settings page, unneeded and needed settings
4. clear button for local cache of images from relationship page node's icons

