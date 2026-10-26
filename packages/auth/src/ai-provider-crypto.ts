import "@crm/env/load";

import { createSecretBox, type SecretBox } from "./secret-box";

export function createAiProviderSecretBox(
	source: string | undefined = process.env.AI_PROVIDER_ENCRYPTION_KEY,
): SecretBox | undefined {
	return createSecretBox(source);
}

export function aiProviderSecretPurpose(
	provider: "openai" | "anthropic",
): string {
	return `crm:ai-provider:${provider}`;
}
