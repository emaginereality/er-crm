import { db } from "@crm/db";
import { defineAgent, defineDynamic } from "eve";
import { startSessionModel, stepModel } from "../../lib/model";
import { attribute, purposeOf } from "../../lib/session-purpose";

export default defineAgent({
	description:
		"Execute one immutable deployed CRM agent version and persist its result and every side effect.",
	model: defineDynamic({
		events: {
			"session.started": async (_event, ctx) => {
				const runId =
					purposeOf(ctx) === "team-agent" ? attribute(ctx, "runId") : null;
				if (!runId) return startSessionModel();
				const run = await db.agentRun.findUnique({
					where: { id: runId },
					select: {
						version: {
							select: { modelId: true, modelContextWindowTokens: true },
						},
					},
				});
				if (!run) throw new Error("This saved agent run is unavailable.");
				return startSessionModel({
					model: run.version.modelId,
					modelContextWindowTokens: run.version.modelContextWindowTokens,
				});
			},
			"step.started": stepModel,
		},
	}),
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 40_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
});
