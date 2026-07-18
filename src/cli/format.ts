import type { HealthCheckResult, PlanResult } from "../core/types.js";
import type { DoctorReport } from "../core/doctor.js";

export function formatPlan(plan: PlanResult): string {
  const lines = [`Project: ${plan.project}`, ""];

  for (const message of plan.messages) {
    lines.push(message);
  }

  lines.push("");
  for (const change of plan.changes) {
    const marker = change.action === "noop" ? "=" : change.action === "create" ? "+" : change.action === "update" ? "~" : "-";
    lines.push(`${marker} [${change.provider}] ${change.summary}`);
  }

  return lines.join("\n");
}

export function formatHealth(results: HealthCheckResult[]): string {
  const lines = ["Provider health:"];

  for (const result of results) {
    lines.push(`- ${result.provider}: ${result.status}`);
    for (const check of result.checks) {
      lines.push(`  - ${check.name}: ${check.status} - ${check.message}`);
    }
  }

  return lines.join("\n");
}

export function formatDoctor(report: DoctorReport): string {
  const lines = [`Doctor: ${report.project} (${report.status})`];

  for (const check of report.checks) {
    const marker = check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "x";
    lines.push(`${marker} ${check.label}: ${check.message}`);
  }

  return lines.join("\n");
}
