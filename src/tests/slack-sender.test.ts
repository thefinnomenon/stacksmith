import assert from "node:assert/strict";
import test from "node:test";
import { sendSlackMessage } from "../operations/slack-sender.js";

const message = {
  channel: "C123",
  text: "Hello",
  blocks: []
};

test("sendSlackMessage dry-runs by default", async () => {
  const result = await sendSlackMessage({ message, execute: false });
  assert.equal(result.status, "planned");
});

test("sendSlackMessage skips execution when token is missing", async () => {
  const result = await sendSlackMessage({ message, execute: true });
  assert.equal(result.status, "skipped");
});

test("sendSlackMessage posts to Slack API when executed", async () => {
  const calls: unknown[] = [];
  const result = await sendSlackMessage({
    message,
    botToken: "xoxb-test",
    execute: true,
    fetchImpl: async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({ ok: true, ts: "1.23" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(result.status, "sent");
  assert.equal(calls.length, 1);
});
