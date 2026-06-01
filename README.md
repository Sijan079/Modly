# Modly

<p align="center">
  <img src="public/app-icon.png" alt="Modly icon" width="88" />
</p>

<p align="center">
  A desktop Minecraft instance and mod manager for organizing profiles, auditing mods, checking updates, and editing configuration files from one focused workspace.
</p>

<p align="center">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.0-24C8DB?style=flat-square" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=101827" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-desktop-000000?style=flat-square&logo=rust" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-local_data-003B57?style=flat-square&logo=sqlite" />
</p>

## Screenshots

<table>
  <tr>
    <td width="50%">
      <strong>Dashboard</strong><br />
      <img src="docs/screenshots/dashboard.png" alt="Modly dashboard" />
    </td>
    <td width="50%">
      <strong>Mods</strong><br />
      <img src="docs/screenshots/mods.png" alt="Modly mods page" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Updates</strong><br />
      <img src="docs/screenshots/updates.png" alt="Modly updates page" />
    </td>
    <td width="50%">
      <strong>Configs</strong><br />
      <img src="docs/screenshots/configs.png" alt="Modly configs page" />
    </td>
  </tr>
</table>

## Highlights

- Create, duplicate, import, export, and organize Minecraft instances.
- Scan mod folders and read metadata from Fabric, Forge, NeoForge, and legacy mod files.
- Enable or disable mods without permanently deleting them.
- Check Modrinth for compatible mod updates and update selected mods with backups.
- Audit mod files for missing, unreadable, or corrupted archives.
- Manage resource packs and shader packs alongside each instance.
- Browse and edit configuration files from the built-in editor.
- Review local activity logs and tune launcher settings.

## Install

Download the latest `.msi` installer from the [GitHub Releases](../../releases) page, run the installer, and launch **Modly**.

## Local Data

Modly stores its configuration and managed metadata locally on your device. Minecraft files remain in the instance folders you select.
