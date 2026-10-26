import {
	type AiProvidersSettings,
	aiProviderInput,
	saveAiProviderKeyInput,
	setAiProviderModeInput,
} from "@crm/validation/ai-providers";
import { z } from "zod";

const fixtureModels = [
	{
		id: "openai/gpt-6.1-sol",
		name: "OpenAI fixture model",
		provider: "openai",
		contextWindowTokens: 1_050_000,
		pricing: null,
	},
	{
		id: "anthropic/claude-sonnet-5.5",
		name: "Anthropic fixture model",
		provider: "anthropic",
		contextWindowTokens: 1_000_000,
		pricing: null,
	},
];
const gatewayModel = {
	id: "zai/glm-5.2-fast",
	name: "Gateway fixture model",
	provider: "zai",
	contextWindowTokens: 1_000_000,
	pricing: null,
};
const batchInput = z.record(z.string(), z.json());
const modelInput = z.object({ modelId: z.string().nullable() });

export function createProviderFixture(
	initial: Partial<AiProvidersSettings> = {},
) {
	const state: AiProvidersSettings = {
		mode: "gateway",
		encryptionConfigured: true,
		openai: { configured: false, hint: null },
		anthropic: { configured: false, hint: null },
		directModelId: null,
		...initial,
	};
	let gatewayModelId: string | null = null;
	const mutations: {
		path: string;
		input: z.infer<typeof batchInput>[string];
	}[] = [];
	const models = () =>
		state.mode === "gateway"
			? [gatewayModel]
			: fixtureModels.filter((model) =>
					model.provider === "openai"
						? state.openai.configured
						: state.anthropic.configured,
				);
	const selection = () => {
		const id =
			state.mode === "gateway"
				? (gatewayModelId ?? gatewayModel.id)
				: (state.directModelId ?? models()[0]?.id);
		const model = models().find((entry) => entry.id === id);
		return {
			selectedId: state.mode === "gateway" ? gatewayModelId : id,
			effectiveId: id,
			defaultId: state.mode === "gateway" ? gatewayModel.id : models()[0]?.id,
			effective: model ?? null,
			updatedAt: null,
		};
	};

	const respond = (paths: string[], rawInputs: string, method: string) => {
		const inputs = batchInput.parse(JSON.parse(rawInputs));
		return paths.map((path, index) => {
			const input = inputs[String(index)] ?? null;
			if (method === "POST") mutations.push({ path, input });
			const data = (() => {
				switch (path) {
					case "settings.aiProviders":
						return state;
					case "settings.agentModel":
						return selection();
					case "settings.modelCatalog":
						return { models: models(), available: true };
					case "settings.saveAiProviderKey": {
						const { provider } = saveAiProviderKeyInput.parse(input);
						state[provider] = { configured: true, hint: "••••" };
						return state;
					}
					case "settings.removeAiProviderKey": {
						const { provider } = aiProviderInput.parse(input);
						state[provider] = { configured: false, hint: null };
						return state;
					}
					case "settings.setAiProviderMode": {
						state.mode = setAiProviderModeInput.parse(input).mode;
						return state;
					}
					case "settings.setAgentModel": {
						const { modelId } = modelInput.parse(input);
						if (state.mode === "gateway") gatewayModelId = modelId;
						else state.directModelId = modelId;
						return selection();
					}
					case "settings.testAiProviderKey":
						aiProviderInput.parse(input);
						return { outcome: "valid", reason: null };
					default:
						throw new Error(`Unexpected fixture request: ${path}`);
				}
			})();
			return { result: { data } };
		});
	};
	return { state, mutations, respond };
}
