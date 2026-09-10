// @ts-nocheck
import assert from "node:assert/strict";

import {
  countMatchingMods,
  filterModsForExport,
  type ExportFilterMod,
} from "./export-filters.ts";

const mods: ExportFilterMod[] = [
  {
    id: "1",
    enabled: true,
    metadata: { side: "client" },
    categories: [{ id: "adventure", name: "Adventure" }],
  },
  {
    id: "2",
    enabled: false,
    metadata: { side: "server" },
    categories: [{ id: "adventure", name: "Adventure" }],
  },
  {
    id: "3",
    enabled: true,
    metadata: { side: "both" },
    categories: [{ id: "tech", name: "Tech" }],
  },
  {
    id: "4",
    enabled: true,
    metadata: { side: "unknown" },
    categories: [],
  },
];

assert.deepEqual(
  filterModsForExport(mods, {
    modAudience: "player",
    modCategoryId: null,
    modState: "enabled",
  }).map((mod) => mod.id),
  ["1", "3"]
);

assert.equal(
  countMatchingMods(mods, {
    modAudience: "any",
    modCategoryId: "adventure",
    modState: "disabled",
  }),
  1
);
