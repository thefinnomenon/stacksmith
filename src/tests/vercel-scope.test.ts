import assert from "node:assert/strict";
import test from "node:test";
import { parseVercelTeamsList } from "../providers/vercel-scope.js";

test("parseVercelTeamsList extracts selected and available scopes", () => {
  const scopes = parseVercelTeamsList(`
Vercel CLI 56.4.1
Fetching teams
Fetching user information
  id                          Team name
✔ chris-projects-2bda84b2     Chris' projects
  viamirror                   Mirror
`);

  assert.deepEqual(scopes, [
    {
      id: "chris-projects-2bda84b2",
      name: "Chris' projects",
      selected: true
    },
    {
      id: "viamirror",
      name: "Mirror",
      selected: false
    }
  ]);
});
