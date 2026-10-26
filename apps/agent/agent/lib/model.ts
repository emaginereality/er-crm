import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
	aiProviderSecretPurpose,
	createAiProviderSecretBox,
} from "@crm/auth/ai-provider-crypto";
import { db } from "@crm/db";
import {
	type AiProvider,
	readAiProviderSettings,
	readEncryptedAiProviderKey,
} from "@crm/db/ai-providers";
import { readAgentModel } from "@crm/db/settings";
import { directAiModel } from "@crm/validation/ai-providers";
import type { LanguageModel } from "ai";
import type { DynamicSentinel } from "eve";
import { defineState, type StateHandle } from "eve/context";
import { AI_PROVIDER } from "./ai-provider-config";
import {
	directProviderFetch,
	protectDirectModel,
} from "./ai-provider-transport";

export interface ModelSelection {
	model: string;
	modelContextWindowTokens: number;
}

const pinnedModel = defineState<ModelSelection | null>(
	"crm.ai-model",
	() => null,
);

export const DIRECT_MODEL_PREFIX = "direct:";

class AiModelConfigurationError extends Error {}

export function selectModelRoute(
	settings: Awaited<ReturnType<typeof readAiProviderSettings>>,
	model: ModelSelection,
): ModelSelection {
	if (settings.mode === "gateway") return model;
	if (settings.mode !== "direct") {
		throw new AiModelConfigurationError(
			"The AI provider mode is invalid. Ask an administrator to update AI settings.",
		);
	}
	const direct = directAiModel(model.model);
	if (!direct) {
		throw new AiModelConfigurationError(
			"This saved model is unavailable with your API keys. Select a supported model and create a new agent version.",
		);
	}
	const configured =
		direct.provider === "openai"
			? settings.openaiConfigured
			: settings.anthropicConfigured;
	if (!configured) {
		throw new AiModelConfigurationError(
			"The selected model has no saved provider key. Ask an administrator to configure its provider.",
		);
	}
	return {
		model: `${DIRECT_MODEL_PREFIX}${direct.id}`,
		modelContextWindowTokens: direct.contextWindowTokens,
	};
}

async function readModelSettings() {
	return db.$transaction(
		async (tx) => ({
			providers: await readAiProviderSettings(tx),
			model: await readAgentModel(tx),
		}),
		{ isolationLevel: "RepeatableRead" },
	);
}

export async function selectedModel(
	preferred?: ModelSelection,
	readSettings: typeof readModelSettings = readModelSettings,
): Promise<ModelSelection> {
	try {
		const settings = await readSettings();
		const selected = preferred ?? {
			model: settings.model.id,
			modelContextWindowTokens: settings.model.contextWindowTokens,
		};
		return selectModelRoute(settings.providers, selected);
	} catch (error) {
		if (error instanceof AiModelConfigurationError) throw error;
		throw new Error(
			"AI settings are unavailable. No provider request was sent. Ask an administrator to check AI settings.",
		);
	}
}

export async function startSessionModel(
	preferred?: ModelSelection,
): Promise<ModelSelection> {
	return pinSessionSelection(pinnedModel, () => selectedModel(preferred));
}

export async function pinSessionSelection(
	state: StateHandle<ModelSelection | null>,
	resolve: () => Promise<ModelSelection>,
): Promise<ModelSelection> {
	const selection = state.get() ?? (await resolve());
	state.update(() => selection);
	return selection;
}

export async function providerApiKey(provider: AiProvider): Promise<string> {
	const box = createAiProviderSecretBox();
	if (!box) {
		throw new Error(
			"AI key encryption is unavailable. Ask an administrator to configure AI_PROVIDER_ENCRYPTION_KEY.",
		);
	}
	try {
		const encrypted = await readEncryptedAiProviderKey(db, provider);
		if (!encrypted) throw new Error("Missing key");
		const key = box.decrypt(encrypted, aiProviderSecretPurpose(provider));
		if (!key.trim()) throw new Error("Empty key");
		return key;
	} catch {
		throw new Error(
			"The saved AI provider key is unavailable. Ask an administrator to replace it in AI settings.",
		);
	}
}

export async function resolveStepModel(
	selection: { model: string; modelContextWindowTokens?: number },
	readKey: (provider: AiProvider) => Promise<string> = providerApiKey,
	request: typeof fetch = fetch,
): Promise<{ model: LanguageModel; modelContextWindowTokens?: number }> {
	if (!selection.model.startsWith(DIRECT_MODEL_PREFIX)) return selection;
	const direct = directAiModel(
		selection.model.slice(DIRECT_MODEL_PREFIX.length),
	);
	if (!direct)
		throw new Error(
			"The pinned direct model is unavailable. Start a new session with a supported model.",
		);
	const apiKey = await readKey(direct.provider);
	const directFetch = directProviderFetch(request);
	if (!apiKey.trim())
		throw new Error("The saved AI provider key is unavailable.");
	return {
		model: protectDirectModel(
			direct.provider === "openai"
				? createOpenAI({
						apiKey,
						baseURL: AI_PROVIDER.baseUrl.openai,
						fetch: directFetch,
					}).responses(direct.nativeModelId)
				: createAnthropic({
						apiKey,
						baseURL: AI_PROVIDER.baseUrl.anthropic,
						fetch: directFetch,
					})(direct.nativeModelId),
		),
		modelContextWindowTokens:
			selection.modelContextWindowTokens ?? direct.contextWindowTokens,
	};
}

export const stepModel: NonNullable<
	DynamicSentinel<{
		model: LanguageModel;
		modelContextWindowTokens?: number;
	}>["events"]["step.started"]
> = async (_event, ctx) => {
	const selection = pinnedModel.get();
	if (selection) return resolveStepModel(selection);
	if (!ctx.model)
		throw new Error("This session has no pinned model. Start a new session.");
	return resolveStepModel({ model: ctx.model.id });
};
