import type { AiProvider } from "@crm/db/ai-providers";
import type { AiProviderTestResult } from "@crm/validation/ai-providers";
import { AI_PROVIDER } from "./ai-provider-config";
import { providerApiKey } from "./model";

export async function verifyAiProvider(
	provider: AiProvider,
	readKey: (provider: AiProvider) => Promise<string> = providerApiKey,
	request: typeof fetch = fetch,
): Promise<AiProviderTestResult> {
	try {
		const key = await readKey(provider);
		if (!key.trim())
			return { outcome: "invalid", reason: "No saved key is available." };
		const headers: Record<string, string> =
			provider === "openai"
				? { authorization: `Bearer ${key}` }
				: {
						"x-api-key": key,
						"anthropic-version": AI_PROVIDER.anthropicVersion,
					};
		const response = await request(AI_PROVIDER.modelsUrl[provider], {
			method: "GET",
			headers,
			redirect: "error",
			signal: AbortSignal.timeout(AI_PROVIDER.testTimeoutMs),
		});
		await response.body?.cancel();
		if (response.ok) {
			return {
				outcome: "valid",
				reason:
					"The provider accepted the saved key. Model access, billing, and quota are not checked. No generation ran.",
			};
		}
		if (response.status === 401) {
			return {
				outcome: "invalid",
				reason:
					"The provider rejected the saved key. Replace the key and test again.",
			};
		}
		if (response.status === 403) {
			return {
				outcome: "unknown",
				reason:
					"The key cannot list models. Check provider permissions. No generation ran.",
			};
		}
		return {
			outcome: "unknown",
			reason:
				"The provider did not complete the connection test. Check its availability and retry.",
		};
	} catch {
		return {
			outcome: "unknown",
			reason:
				"The connection test is unavailable. Check the saved key, encryption configuration, and agent connection.",
		};
	}
}
