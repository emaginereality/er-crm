import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	aiProviderSecretPurpose,
	createAiProviderSecretBox,
} from "@crm/auth/ai-provider-crypto";
import type { AppSettingModel, Db } from "@crm/db";
import { readAgentModel } from "@crm/db/settings";
import { saveAiProviderKeyInput } from "@crm/validation/ai-providers";
import type { ResearchKeyService } from "../src/agent/research-key.service";
import type { BackfillService } from "../src/backfill/backfill.service";
import type { ModelCatalogService } from "../src/settings/model-catalog.service";
import { SettingsService } from "../src/settings/settings.service";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const fixtureKey = "fixture-openai-key-not-a-credential";
const anthropicKey = "fixture-anthropic-key-not-a-credential";
const originalEncryptionKey = process.env.AI_PROVIDER_ENCRYPTION_KEY;
const originalBridgeSecret = process.env.AGENT_BRIDGE_SECRET;
const originalFetch = globalThis.fetch;

type SettingRow = Pick<
	AppSettingModel,
	| "id"
	| "aiProviderMode"
	| "directModelId"
	| "directModelContextWindow"
	| "openaiApiKeyEncrypted"
	| "anthropicApiKeyEncrypted"
	| "agentModelId"
	| "agentModelContextWindow"
	| "updatedAt"
>;

function harness(role: string | null = "admin") {
	let row: SettingRow = {
		id: "app",
		aiProviderMode: "gateway",
		directModelId: null,
		directModelContextWindow: null,
		openaiApiKeyEncrypted: null,
		anthropicApiKeyEncrypted: null,
		agentModelId: "zai/glm-5.2-fast",
		agentModelContextWindow: 1_000_000,
		updatedAt: new Date("2026-10-26T19:00:00Z"),
	};
	const findUnique = mock(async () => ({ ...row }));
	const update = mock(async ({ data }: { data: Partial<SettingRow> }) => {
		row = { ...row, ...data };
		return { ...row };
	});
	const upsert = mock(async () => ({ ...row }));
	const client = {
		member: { findUnique: mock(async () => (role ? { role } : null)) },
		appSetting: { findUnique, update, upsert },
		$transaction: async <T>(action: (tx: Db) => Promise<T>): Promise<T> => {
			const previous = { ...row };
			try {
				return await action(client as unknown as Db);
			} catch (error) {
				row = previous;
				throw error;
			}
		},
	};
	const gateway = {
		id: "zai/glm-5.2-fast",
		name: "GLM 5.2 Fast",
		provider: "zai",
		contextWindowTokens: 1_000_000,
		pricing: null,
	};
	const catalog = {
		models: mock(async () => [gateway]),
		find: mock(async () => gateway),
	};
	const service = new SettingsService(
		client as unknown as Db,
		catalog as unknown as ModelCatalogService,
		{} as ResearchKeyService,
		{} as BackfillService,
	);
	return { service, client, catalog, row: () => row };
}

beforeEach(() => {
	process.env.AI_PROVIDER_ENCRYPTION_KEY = encryptionKey;
	delete process.env.AGENT_BRIDGE_SECRET;
	globalThis.fetch = mock(async () => {
		throw new Error("Unexpected network request");
	}) as unknown as typeof fetch;
});

afterEach(() => {
	if (originalEncryptionKey === undefined) {
		delete process.env.AI_PROVIDER_ENCRYPTION_KEY;
	} else {
		process.env.AI_PROVIDER_ENCRYPTION_KEY = originalEncryptionKey;
	}
	if (originalBridgeSecret === undefined) {
		delete process.env.AGENT_BRIDGE_SECRET;
	} else {
		process.env.AGENT_BRIDGE_SECRET = originalBridgeSecret;
	}
	globalThis.fetch = originalFetch;
});

describe("admin AI provider settings", () => {
	it("keeps Gateway as the default and uses the existing catalog", async () => {
		const h = harness();
		expect((await h.service.aiProviders("admin")).mode).toBe("gateway");
		expect((await h.service.modelCatalog()).models[0]?.provider).toBe("zai");
		expect((await h.service.agentModel()).effectiveId).toBe("zai/glm-5.2-fast");
		expect(h.catalog.models).toHaveBeenCalledTimes(1);
	});

	for (const role of ["member", null]) {
		it(`rejects provider reads and every mutation for ${role ?? "nonmembers"}`, async () => {
			const h = harness(role);
			await expect(h.service.aiProviders("user")).rejects.toThrow(
				"Only workspace owners",
			);
			await expect(
				h.service.setAiProviderMode("user", "direct"),
			).rejects.toThrow("Only workspace owners");
			await expect(
				h.service.saveAiProviderKey("user", "openai", fixtureKey),
			).rejects.toThrow("Only workspace owners");
			await expect(
				h.service.removeAiProviderKey("user", "openai"),
			).rejects.toThrow("Only workspace owners");
			await expect(
				h.service.testAiProviderKey("user", "openai"),
			).rejects.toThrow("Only workspace owners");
			await expect(h.service.setAgentModel("user", null)).rejects.toThrow(
				"Only workspace owners",
			);
			expect(h.client.appSetting.findUnique).not.toHaveBeenCalled();
			expect(h.client.appSetting.upsert).not.toHaveBeenCalled();
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});
	}

	it("allows owners and encrypts independent keys without reading them back", async () => {
		const h = harness("owner");
		await h.service.saveAiProviderKey("owner", "openai", fixtureKey);
		const first = h.row().openaiApiKeyEncrypted;
		const status = await h.service.saveAiProviderKey(
			"owner",
			"anthropic",
			anthropicKey,
		);
		expect(status.openai).toEqual({ configured: true, hint: "••••" });
		expect(status.anthropic).toEqual({ configured: true, hint: "••••" });
		expect(JSON.stringify(status)).not.toContain(fixtureKey);
		expect(JSON.stringify(status)).not.toContain(anthropicKey);
		expect(first).not.toContain(fixtureKey);
		const box = createAiProviderSecretBox();
		expect(box?.decrypt(first ?? "", aiProviderSecretPurpose("openai"))).toBe(
			fixtureKey,
		);
		expect(() =>
			box?.decrypt(first ?? "", aiProviderSecretPurpose("anthropic")),
		).toThrow();
		await h.service.saveAiProviderKey(
			"owner",
			"openai",
			`${fixtureKey}-replacement`,
		);
		expect(h.row().openaiApiKeyEncrypted).not.toBe(first);
		expect(
			box?.decrypt(
				h.row().openaiApiKeyEncrypted ?? "",
				aiProviderSecretPurpose("openai"),
			),
		).toBe(`${fixtureKey}-replacement`);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("refuses plaintext storage without a valid encryption key", async () => {
		const h = harness();
		delete process.env.AI_PROVIDER_ENCRYPTION_KEY;
		await expect(
			h.service.saveAiProviderKey("admin", "openai", fixtureKey),
		).rejects.toThrow("AI_PROVIDER_ENCRYPTION_KEY");
		expect(h.row().openaiApiKeyEncrypted).toBeNull();
		expect(h.client.appSetting.upsert).not.toHaveBeenCalled();
		expect((await h.service.aiProviders("admin")).encryptionConfigured).toBe(
			false,
		);
		process.env.AI_PROVIDER_ENCRYPTION_KEY = "invalid";
		await expect(
			h.service.setAiProviderMode("admin", "direct"),
		).rejects.toThrow("AI_PROVIDER_ENCRYPTION_KEY");
		expect(h.row().aiProviderMode).toBe("gateway");
	});

	it("requires a key before direct mode and never picks a Gateway default", async () => {
		const h = harness();
		await expect(
			h.service.setAiProviderMode("admin", "direct"),
		).rejects.toThrow("Save an OpenAI or Anthropic");
		await h.service.saveAiProviderKey("admin", "anthropic", anthropicKey);
		await h.service.setAiProviderMode("admin", "direct");
		expect(h.row().directModelId).toBe("anthropic/claude-sonnet-5.5");
		expect(h.row().directModelContextWindow).toBe(1_000_000);
		expect(
			(await h.service.modelCatalog()).models.every(
				(model) => model.provider === "anthropic",
			),
		).toBe(true);
		await h.service.setAgentModel("admin", null);
		expect((await h.service.agentModel()).effectiveId).toBe(
			"anthropic/claude-sonnet-5.5",
		);
		expect(h.catalog.models).not.toHaveBeenCalled();
		expect(h.catalog.find).not.toHaveBeenCalled();
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("limits direct models to configured providers and preserves both mode selections", async () => {
		const h = harness();
		await h.service.saveAiProviderKey("admin", "openai", fixtureKey);
		await h.service.setAiProviderMode("admin", "direct");
		await expect(
			h.service.setAgentModel("admin", "anthropic/claude-sonnet-5.5"),
		).rejects.toThrow("Select an available");
		await expect(
			h.service.setAgentModel("admin", "zai/glm-5.2-fast"),
		).rejects.toThrow("Select an available");
		await h.service.saveAiProviderKey("admin", "anthropic", anthropicKey);
		expect((await h.service.modelCatalog()).models).toHaveLength(7);
		await h.service.setAgentModel("admin", "openai/gpt-6.1-terra");
		expect(h.row().directModelContextWindow).toBe(1_050_000);
		await h.service.setAiProviderMode("admin", "gateway");
		expect((await h.service.agentModel()).effectiveId).toBe("zai/glm-5.2-fast");
		await h.service.setAiProviderMode("admin", "direct");
		expect((await h.service.agentModel()).effectiveId).toBe(
			"openai/gpt-6.1-terra",
		);
	});

	it("requires switching away from the selected provider before removing its key", async () => {
		const h = harness();
		await h.service.saveAiProviderKey("admin", "openai", fixtureKey);
		await h.service.saveAiProviderKey("admin", "anthropic", anthropicKey);
		await h.service.setAiProviderMode("admin", "direct");
		await expect(
			h.service.removeAiProviderKey("admin", "openai"),
		).rejects.toThrow("Select another provider");
		await h.service.setAgentModel("admin", "anthropic/claude-sonnet-5.5");
		await h.service.removeAiProviderKey("admin", "openai");
		expect(h.row().openaiApiKeyEncrypted).toBeNull();
		expect((await h.service.modelCatalog()).models).toHaveLength(3);
		await h.service.setAiProviderMode("admin", "gateway");
		await h.service.removeAiProviderKey("admin", "anthropic");
		expect(h.row().anthropicApiKeyEncrypted).toBeNull();
		expect(h.row().agentModelId).toBe("zai/glm-5.2-fast");
	});

	it("calls the agent only for explicit connection tests and sends no provider key", async () => {
		const h = harness();
		await expect(
			h.service.testAiProviderKey("admin", "openai"),
		).rejects.toThrow("Save this provider");
		await h.service.saveAiProviderKey("admin", "openai", fixtureKey);
		expect((await h.service.testAiProviderKey("admin", "openai")).outcome).toBe(
			"unknown",
		);
		expect(globalThis.fetch).not.toHaveBeenCalled();
		process.env.AGENT_BRIDGE_SECRET = "fixture-bridge-secret-not-a-credential";
		const fetchMock = mock(
			async (_url: string | URL | Request, init?: RequestInit) => {
				expect(init?.body).toBe(JSON.stringify({ provider: "openai" }));
				expect(JSON.stringify(init)).not.toContain(fixtureKey);
				return Response.json({ outcome: "valid", reason: null });
			},
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		expect((await h.service.testAiProviderKey("admin", "openai")).outcome).toBe(
			"valid",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("fails closed when direct context metadata is absent", async () => {
		const h = harness();
		await h.client.appSetting.update({
			data: {
				aiProviderMode: "direct",
				directModelId: "openai/gpt-6.1-sol",
				directModelContextWindow: null,
			},
		});
		await expect(readAgentModel(h.client as unknown as Db)).rejects.toThrow(
			"direct AI model is not configured",
		);
	});

	it("rejects unsupported providers and malformed keys at the boundary", () => {
		expect(
			saveAiProviderKeyInput.safeParse({
				provider: "google",
				apiKey: fixtureKey,
			}).success,
		).toBe(false);
		expect(
			saveAiProviderKeyInput.safeParse({
				provider: "openai",
				apiKey: "bad key with spaces",
			}).success,
		).toBe(false);
		expect(
			saveAiProviderKeyInput.safeParse({ provider: "openai", apiKey: "" })
				.success,
		).toBe(false);
	});
});
