# Relationships Graph Redesign

## Summary
Replace the current Relationships page with a pure graph landing view that opens directly to the selected instance's full manual-relationship graph. Remove the table-vs-graph toggle and the required selected-mod workflow. The page becomes a graph workspace first, with node interaction opening a modal for relationship inspection and editing.

This version uses only existing manual relationships stored by the app. It does not infer dependencies from metadata, jar contents, or scan-time heuristics.

## Product Decisions
- Landing view is a full graph of the current instance's manual relationships.
- Relationship data source is manual relationships only.
- Clicking a node opens a modal dialog.
- Relationship editing stays in the modal and reuses the existing per-mod update path.
- If an instance has no manual links yet, show an onboarding empty state instead of a blank graph.
- Simple graph controls only: pan, zoom, fit-to-view, and edge-type filtering.

## Data Shape
- Add an instance-level relationship graph query.
- Graph payload includes:
  - `nodes`: every mod in the instance with graph-safe display data
  - `edges`: every manual relationship in the instance
- Keep the existing per-mod relationships query for modal hydration.
- Keep the existing per-mod metadata update mutation for saving manual relationships.

## UI Shape
- The main Relationships screen shows:
  - instance selector
  - edge-type filter chips
  - full graph canvas
  - graph stats
- The node modal shows:
  - mod name
  - source link when available
  - incoming dependency/add-on sections
  - editable outgoing manual relationships
  - save action

## Out of Scope
- Inferred dependency discovery
- Automatic add-on detection
- Drag-to-create edges on the canvas
- Inline canvas editing
- Cluster logic or advanced layout controls
- Multi-step onboarding beyond a single empty state

## Verification
- Frontend must build cleanly.
- Backend must expose an instance-level graph payload.
- A backend test must confirm manual relationships are returned as a graph for one instance.
