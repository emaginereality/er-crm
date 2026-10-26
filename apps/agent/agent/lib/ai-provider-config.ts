export const AI_PROVIDER = {
	testTimeoutMs: 10_000,
	anthropicVersion: "2023-06-01",
	baseUrl: {
		openai: "https://api.openai.com/v1",
		anthropic: "https://api.anthropic.com/v1",
	},
	modelsUrl: {
		openai: "https://api.openai.com/v1/models",
		anthropic: "https://api.anthropic.com/v1/models?limit=1",
	},
} as const;
