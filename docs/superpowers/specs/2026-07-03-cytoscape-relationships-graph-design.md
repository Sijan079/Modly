# Cytoscape Relationships Graph Migration

## Summary
Migrate the Relationships page from `@xyflow/react` to Cytoscape.js and treat the page as a graph-native workspace driven by the existing manual relationship data. The graph uses a core-first visual model: core mods anchor local groups, add-ons branch around them, shared dependencies remain single nodes that connect to all related mods, and isolated mods remain stand-alone. No node duplication.

This pass is a visual and structural overhaul of the graph engine, not a relationship-data overhaul. Manual relationships remain the only source of truth. Bridge classification is deferred for now rather than inferred in v1.

## Product Decisions
- Landing view remains a full graph of the selected instance.
- Manual relationships remain the only source of truth.
- The modal stays focused on outgoing relationship editing.
- Shared dependencies are rendered once and may connect across multiple core groups.
- The graph uses a core-first visual story rather than a dependency-first one.
- `bridge` remains a future concept and is not classified in this pass.

## Data and Roles
- Keep the existing instance-level graph payload and current per-mod update mutation.
- No backend schema or API changes are required for this migration.
- Derive frontend roles from the current manual graph:
  - `core`
  - `dependency`
  - `addon`
  - `isolated`
- Default role rules for v1:
  - `addon`: mod has outgoing `addon_for` relationships
  - `dependency`: mod is a dependency target in the manual graph and is not already an add-on
  - `core`: connected mod that is neither dependency-first nor add-on
  - `isolated`: mod has no relationships

## UI Shape
- Replace the XYFlow canvas with a Cytoscape canvas on the Relationships page.
- Keep the existing page shell, instance selector, search, edge-type filters, graph stats, empty state, icon behavior, and node-click modal flow.
- Keep one node per mod only, including shared dependencies.
- Use one default Cytoscape layout tuned for readability rather than exposing multiple layout modes in v1.
- Keep the custom bottom-right graph controls:
  - zoom in
  - zoom out
  - fit view
- Preserve search focus and dimming behavior using Cytoscape class-based styling.

## Testing
- Relationships opens directly into the Cytoscape graph for the selected instance.
- Shared dependencies render as single nodes even when many mods connect to them.
- Core mods read as anchors, add-ons branch outward, and isolated mods remain separate when included.
- Search, filter chips, zoom, fit view, and node-click modal behavior all continue working.
- Saving outgoing relationships updates the graph after refresh/invalidation.
