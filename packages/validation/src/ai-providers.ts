import { z } from "zod";

export const aiProvider = z.enum(["openai", "anthropic"]);

export const aiProviderMode = z.enum(["gateway", "direct"]);

export const DIRECT_AI_MODELS = [
	{
		id: "openai/gpt-6.1-sol",
		nativeModelId: "gpt-6.1-sol",
		name: "GPT-6.1 Sol",
		provider: "openai",
		contextWindowTokens: 1_050_000,
		pricing: null,
	},
	{
		id: "openai/gpt-6.1-terra",
		nativeModelId: "gpt-6.1-terra",
		name: "GPT-6.1 Terra",
		provider: "openai",
		contextWindowTokens: 1_050_000,
		pricing: null,
	},
	{
		id: "openai/gpt-6-astra",
		nativeModelId: "gpt-6-astra",
		name: "GPT-6 Astra",
		provider: "openai",
		contextWindowTokens: 1_050_000,
		pricing: null,
	},
	{
		id: "openai/gpt-6-luna",
		nativeModelId: "gpt-6-luna",
		name: "GPT-6 Luna",
		provider: "openai",
		contextWindowTokens: 1_050_000,
		pricing: null,
	},
	{
		id: "anthropic/claude-sonnet-5.5",
		nativeModelId: "claude-sonnet-5-5",
		name: "Claude Sonnet 5.5",
		provider: "anthropic",
		contextWindowTokens: 1_000_000,
		pricing: null,
	},
	{
		id: "anthropic/claude-opus-5.5",
		nativeModelId: "claude-opus-5-5",
		name: "Claude Opus 5.5",
		provider: "anthropic",
		contextWindowTokens: 1_000_000,
		pricing: null,
	},
	{
		id: "anthropic/claude-haiku-5.5",
		nativeModelId: "claude-haiku-5-5",
		name: "Claude Haiku 5.5",
		provider: "anthropic",
		contextWindowTokens: 1_000_000,
		pricing: null,
	},
] as const;

export function directAiModel(id: string) {
	return DIRECT_AI_MODELS.find((model) => model.id === id);
}

export function configuredDirectAiModels(configured: {
	openaiConfigured: boolean;
	anthropicConfigured: boolean;
}) {
	return DIRECT_AI_MODELS.filter((model) =>
		model.provider === "openai"
			? configured.openaiConfigured
			: configured.anthropicConfigured,
	);
}

export const aiProviderStatus = z.object({
	configured: z.boolean(),
	hint: z.string().nullable(),
});

export const aiProvidersOutput = z.object({
	mode: aiProviderMode,
	encryptionConfigured: z.boolean(),
	openai: aiProviderStatus,
	anthropic: aiProviderStatus,
	directModelId: z.string().nullable(),
});

export type AiProvidersSettings = z.infer<typeof aiProvidersOutput>;

export const setAiProviderModeInput = z.object({ mode: aiProviderMode });

export const aiProviderInput = z.object({ provider: aiProvider });

export const saveAiProviderKeyInput = aiProviderInput.extend({
	apiKey: z
		.string()
		.trim()
		.min(8, "Enter the complete API key.")
		.max(500, "The API key is too long.")
		.refine((key) => !/\s/.test(key), "An API key cannot contain spaces."),
});

export const aiProviderTestOutput = z.object({
	outcome: z.enum(["valid", "invalid", "unknown"]),
	reason: z.string().nullable(),
});

export type AiProviderTestResult = z.infer<typeof aiProviderTestOutput>;
