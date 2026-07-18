import type { EnvironmentName } from "../core/types.js";

export interface MixpanelRetentionQuery {
  projectId: string;
  fromDate: string;
  toDate: string;
  bornEvent: string;
  returningEvent: string;
  environment?: EnvironmentName;
}

export interface MixpanelMetricQuestion {
  projectId: string;
  question:
    | "retention"
    | "activation"
    | "conversion"
    | "active-users"
    | "event-count";
  fromDate: string;
  toDate: string;
  event?: string;
  environment?: EnvironmentName;
}

export interface ProductHealthMetric {
  label: string;
  value: number;
  unit: "count" | "percent" | "ratio";
  period: {
    fromDate: string;
    toDate: string;
  };
  source: "mixpanel";
  query: Record<string, unknown>;
}

export function buildMixpanelRetentionParams(input: MixpanelRetentionQuery): URLSearchParams {
  const params = new URLSearchParams({
    project_id: input.projectId,
    from_date: input.fromDate,
    to_date: input.toDate,
    retention_type: "birth",
    born_event: input.bornEvent,
    event: input.returningEvent
  });

  if (input.environment) {
    params.set("where", `properties["environment"] == "${input.environment}"`);
  }

  return params;
}

export function mixpanelRetentionEndpoint(input: MixpanelRetentionQuery): string {
  return `/api/query/retention?${buildMixpanelRetentionParams(input).toString()}`;
}

export function plannedMixpanelMetric(input: MixpanelMetricQuestion): ProductHealthMetric {
  return {
    label: input.question,
    value: 0,
    unit: input.question === "retention" || input.question === "conversion" || input.question === "activation" ? "percent" : "count",
    period: {
      fromDate: input.fromDate,
      toDate: input.toDate
    },
    source: "mixpanel",
    query: { ...input }
  };
}
