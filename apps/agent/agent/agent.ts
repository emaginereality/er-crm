import "@crm/env/load";

import { onTelemetryProblem, syncVersion } from "@crm/telemetry";
import { defineAgent, defineDynamic } from "eve";
import { logCapabilities } from "./lib/capabilities";
import { startSessionModel, stepModel } from "./lib/model";

void logCapabilities();

onTelemetryProblem((message) => console.debug(`[telemetry] ${message}`));

void syncVersion();

export default defineAgent({
	model: defineDynamic({
		events: {
			"session.started": () => startSessionModel(),
			"step.started": stepModel,
		},
	}),
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 50_000,
		sessionTimeoutMs: 30 * 24 * 60 * 60 * 1000,
	},
});
