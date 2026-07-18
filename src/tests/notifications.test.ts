import assert from "node:assert/strict";
import test from "node:test";
import { buildNotificationSlackMessage, createNotificationEvent, routeNotificationToSlack } from "../operations/notifications.js";

test("notification routing keeps preview info out of Slack by default", () => {
  const event = createNotificationEvent({
    projectId: "facereel",
    type: "preview.ready",
    severity: "info",
    environment: "preview",
    title: "Preview ready",
    summary: "PR 184 is ready."
  });

  assert.equal(routeNotificationToSlack(event, {
    activityChannel: "#facereel",
    alertsChannel: "#facereel-alerts",
    previewFailuresOnly: true
  }), undefined);
});

test("notification routing sends preview failures to alerts", () => {
  const event = createNotificationEvent({
    projectId: "facereel",
    type: "preview.failed",
    severity: "warning",
    environment: "preview",
    title: "Preview failed",
    summary: "PR 184 failed health checks."
  });

  assert.equal(routeNotificationToSlack(event, {
    activityChannel: "#facereel",
    alertsChannel: "#facereel-alerts",
    previewFailuresOnly: true
  }), "#facereel-alerts");
});

test("notification Slack message includes useful links", () => {
  const event = createNotificationEvent({
    projectId: "facereel",
    type: "stripe.payment_succeeded",
    severity: "info",
    environment: "production",
    title: "Payment succeeded",
    summary: "$29 subscription started.",
    links: [{ label: "Open Stripe", url: "https://dashboard.stripe.com/test/payments/pi_123" }]
  });

  const message = buildNotificationSlackMessage(event, "#facereel");
  assert.match(JSON.stringify(message.blocks), /Open Stripe/);
});
