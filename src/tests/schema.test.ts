import assert from "node:assert/strict";
import test from "node:test";
import { printPostgresSchema } from "../db/schema.js";

test("Postgres schema includes generic webhook idempotency storage", () => {
  const schema = printPostgresSchema();

  assert.match(schema, /create table if not exists webhook_events/);
  assert.match(schema, /provider text not null/);
  assert.match(schema, /idempotency_key text not null/);
  assert.match(schema, /unique \(provider, idempotency_key\)/);
  assert.match(schema, /webhook_events_lookup_idx/);
});
