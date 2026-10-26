import type { AiProvider } from "@crm/db/ai-providers";
import {
	type AiProviderTestResult,
	aiProviderTestOutput,
} from "@crm/validation/ai-providers";
import { bridge } from "../agent/bridge";
import { AI_PROVIDER_SETTINGS } from "./ai-provider-config";

export async function testSavedAiProvider(
	provider: AiProvider,
): Promise<AiProviderTestResult> {
	const agent = bridge();
	if (!agent) {
		return {
			outcome: "unknown",
			reason: "Configure AGENT_BRIDGE_SECRET to test provider connections.",
		};
	}

	try {
		const response = await fetch(
			agent.url("/internal/crm/verify-ai-provider"),
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${agent.secret}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ provider }),
				signal: AbortSignal.timeout(AI_PROVIDER_SETTINGS.testTimeoutMs),
			},
		);
		if (response.ok) {
			const result = aiProviderTestOutput.safeParse(await response.json());
			if (result.success) return result.data;
		}
	} catch {}

	return {
		outcome: "unknown",
		reason: "The provider connection test is unavailable. Try again later.",
	};
}
