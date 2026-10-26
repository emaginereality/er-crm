import type { Db } from "./client";
import { SETTINGS_ID } from "./settings";

export type AiProvider = "openai" | "anthropic";

export type AiProviderMode = "gateway" | "direct";

export async function readAiProviderSettings(db: Pick<Db, "appSetting">) {
	const row = await db.appSetting.findUnique({
		where: { id: SETTINGS_ID },
		select: {
			aiProviderMode: true,
			directModelId: true,
			directModelContextWindow: true,
			openaiApiKeyEncrypted: true,
			anthropicApiKeyEncrypted: true,
		},
	});

	return {
		mode: row?.aiProviderMode ?? "gateway",
		directModelId: row?.directModelId ?? null,
		directModelContextWindow: row?.directModelContextWindow ?? null,
		openaiConfigured: Boolean(row?.openaiApiKeyEncrypted),
		anthropicConfigured: Boolean(row?.anthropicApiKeyEncrypted),
	};
}

export async function readEncryptedAiProviderKey(
	db: Pick<Db, "appSetting">,
	provider: AiProvider,
): Promise<string | null> {
	const row = await db.appSetting.findUnique({
		where: { id: SETTINGS_ID },
		select: { openaiApiKeyEncrypted: true, anthropicApiKeyEncrypted: true },
	});

	return provider === "openai"
		? (row?.openaiApiKeyEncrypted ?? null)
		: (row?.anthropicApiKeyEncrypted ?? null);
}
