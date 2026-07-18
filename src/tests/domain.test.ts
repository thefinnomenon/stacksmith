import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultManifest } from "../core/defaults.js";
import { planDomainPromotion } from "../core/domain.js";

test("planDomainPromotion shows URL and manual OAuth changes", () => {
  const manifest = createDefaultManifest({
    name: "Push",
    baseDomain: "finternet.com",
    projectSubdomain: "push"
  });
  const plan = planDomainPromotion(manifest, "push.com");

  assert.equal(plan.from.activeDomain, "push.finternet.com");
  assert.equal(plan.to.activeDomain, "push.com");
  assert.ok(plan.urlChanges.some((change) => change.to === "https://push.com"));
  assert.ok(plan.manualActions.some((action) => action.includes("https://push.com/api/auth/callback/google")));
});
