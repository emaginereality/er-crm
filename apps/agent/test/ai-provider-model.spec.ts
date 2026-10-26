import { afterEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { DIRECT_AI_MODELS } from "@crm/validation/ai-providers";
import { generateText, streamText } from "ai";
import eveChannel from "../agent/channels/eve";
import {
	type ModelSelection,
	pinSessionSelection,
	resolveStepModel,
	selectedModel,
	selectModelRoute,
} from "../agent/lib/model";

const settings = {
	mode: "direct" as const,
	directModelId: "openai/gpt-6.1-sol",
	directModelContextWindow: 1_050_000,
	openaiConfigured: true,
	anthropicConfigured: true,
};
const selection = {
	model: "openai/gpt-6.1-sol",
	modelContextWindowTokens: 1_050_000,
};

const oldOpenAiUrl = process.env.OPENAI_BASE_URL;
const oldAnthropicUrl = process.env.ANTHROPIC_BASE_URL;
afterEach(() => {
	if (oldOpenAiUrl === undefined) delete process.env.OPENAI_BASE_URL;
	else process.env.OPENAI_BASE_URL = oldOpenAiUrl;
	if (oldAnthropicUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
	else process.env.ANTHROPIC_BASE_URL = oldAnthropicUrl;
	mock.restore();
});

describe("AI provider session routing", () => {
	it("retains the Gateway path without reading direct keys", async () => {
		const readKey = mock(async () => "test-only-not-a-real-key");
		const routed = selectModelRoute(
			{ ...settings, mode: "gateway" },
			selection,
		);
		expect(routed).toEqual(selection);
		expect(await resolveStepModel(routed, readKey)).toEqual(selection);
		expect(readKey).not.toHaveBeenCalled();
	});

	it("keeps legacy Gateway sessions on their original route without reading direct keys", async () => {
		const readKey = mock(async () => {
			throw new Error("Direct keys must not be read");
		});
		const legacy = { model: "anthropic/claude-sonnet-5" };
		expect(await resolveStepModel(legacy, readKey)).toEqual(legacy);
		expect(readKey).not.toHaveBeenCalled();
	});

	it("pins direct mode as a serializable string with explicit context metadata", () => {
		const routed = selectModelRoute(settings, selection);
		expect(routed).toEqual({
			model: "direct:openai/gpt-6.1-sol",
			modelContextWindowTokens: 1_050_000,
		});
		expect(JSON.parse(JSON.stringify(routed))).toEqual(routed);
	});

	it("rejects unsupported saved versions and absent provider keys", () => {
		expect(() =>
			selectModelRoute(settings, { ...selection, model: "zai/glm-5.2-fast" }),
		).toThrow("new agent version");
		expect(() =>
			selectModelRoute({ ...settings, openaiConfigured: false }, selection),
		).toThrow("no saved provider key");
	});

	it("restores a pinned session after settings changes without resolving again", async () => {
		let saved: ModelSelection | null = null;
		const state = {
			get: () => saved,
			update: (
				update: (current: ModelSelection | null) => ModelSelection | null,
			) => {
				saved = update(saved);
			},
		};
		const initial = mock(async () => selectModelRoute(settings, selection));
		const first = await pinSessionSelection(state, initial);
		saved = JSON.parse(JSON.stringify(saved));
		const changed = mock(async () =>
			selectModelRoute({ ...settings, mode: "gateway" }, selection),
		);
		expect(await pinSessionSelection(state, changed)).toEqual(first);
		expect(initial).toHaveBeenCalledTimes(1);
		expect(changed).not.toHaveBeenCalled();
	});

	it("fails closed when settings cannot be read", async () => {
		const readSettings = mock(async () => {
			throw new Error("private database details");
		});
		const result = selectedModel(undefined, readSettings);
		await expect(result).rejects.toThrow("No provider request was sent");
		await expect(result).rejects.not.toThrow("private database details");
		expect(readSettings).toHaveBeenCalledTimes(1);
	});

	it("rechecks the key on each step, including after rotation and removal", async () => {
		let key: string | null = "test-only-first-key";
		const readKey = mock(async () => {
			if (!key) throw new Error("Key removed");
			return key;
		});
		const pinned = selectModelRoute(settings, selection);
		await resolveStepModel(pinned, readKey);
		key = "test-only-replacement-key";
		await resolveStepModel(pinned, readKey);
		key = null;
		await expect(resolveStepModel(pinned, readKey)).rejects.toThrow(
			"Key removed",
		);
		expect(readKey).toHaveBeenCalledTimes(3);
	});

	it("never constructs an adapter for an unknown direct model or blank key", async () => {
		const readKey = mock(async () => "");
		await expect(
			resolveStepModel({ model: "direct:other/model" }, readKey),
		).rejects.toThrow("pinned direct model");
		expect(readKey).not.toHaveBeenCalled();
		await expect(
			resolveStepModel(selectModelRoute(settings, selection), readKey),
		).rejects.toThrow("key is unavailable");
	});

	for (const model of DIRECT_AI_MODELS) {
		it(`routes ${model.id} only to its official endpoint with its native ID`, async () => {
			process.env.OPENAI_BASE_URL = "https://untrusted.invalid/v1";
			process.env.ANTHROPIC_BASE_URL = "https://untrusted.invalid/v1";
			const requests: { url: string; headers: Headers; body: string }[] = [];
			const request = mock(
				async (url: URL | RequestInfo, init?: RequestInit) => {
					expect(init?.redirect).toBe("error");
					requests.push({
						url: String(url),
						headers: new Headers(init?.headers),
						body: String(init?.body),
					});
					return Response.json(
						{
							error: {
								message: "Synthetic test refusal",
								type: "invalid_request_error",
							},
						},
						{ status: 400 },
					);
				},
			);
			const pinned = selectModelRoute(settings, {
				model: model.id,
				modelContextWindowTokens: model.contextWindowTokens,
			});
			const resolved = await resolveStepModel(
				pinned,
				async () => "test-only-provider-key",
				request,
			);
			expect(resolved.modelContextWindowTokens).toBe(model.contextWindowTokens);
			await expect(
				generateText({
					model: resolved.model,
					prompt: "Synthetic test",
					maxRetries: 0,
				}),
			).rejects.toThrow();
			expect(requests).toHaveLength(1);
			const sent = requests[0];
			expect(sent?.url).toBe(
				model.provider === "openai"
					? "https://api.openai.com/v1/responses"
					: "https://api.anthropic.com/v1/messages",
			);
			expect(JSON.parse(sent?.body ?? "{}").model).toBe(model.nativeModelId);
			expect(
				sent?.headers.get(
					model.provider === "openai" ? "authorization" : "x-api-key",
				),
			).toBe(
				model.provider === "openai"
					? "Bearer test-only-provider-key"
					: "test-only-provider-key",
			);
		});
	}

	it("does not expose reflected keys in provider HTTP errors or headers", async () => {
		const key = "test-only-reflected-secret";
		const request = mock(async () =>
			Response.json(
				{ error: { message: key } },
				{ status: 401, headers: { "x-error": key } },
			),
		);
		const resolved = await resolveStepModel(
			selectModelRoute(settings, selection),
			async () => key,
			request,
		);
		try {
			await generateText({
				model: resolved.model,
				prompt: "Synthetic test",
				maxRetries: 0,
			});
			throw new Error("Expected the synthetic refusal");
		} catch (error) {
			expect(String(error)).toContain("direct AI provider request failed");
			expect(String(error)).not.toContain(key);
			expect(JSON.stringify(error)).not.toContain(key);
			expect(error instanceof Error ? error.cause : undefined).toBeUndefined();
		}
	});

	it("does not expose a key in a thrown transport error", async () => {
		const key = "test-only-reflected-secret";
		const request = mock(async () => {
			throw new Error(key);
		});
		const resolved = await resolveStepModel(
			selectModelRoute(settings, selection),
			async () => key,
			request,
		);
		await expect(
			generateText({
				model: resolved.model,
				prompt: "Synthetic test",
				maxRetries: 0,
			}),
		).rejects.toThrow("direct AI provider request failed");
	});

	for (const provider of ["openai", "anthropic"] as const) {
		it(`sanitizes ${provider} streamed error payloads`, async () => {
			const key = "test-only-streamed-secret";
			const model = DIRECT_AI_MODELS.find(
				(entry) => entry.provider === provider,
			);
			if (!model) throw new Error("Missing test model");
			const payload =
				provider === "openai"
					? {
							type: "error",
							code: "test_error",
							message: key,
							param: null,
							sequence_number: 1,
						}
					: {
							type: "error",
							error: { type: "authentication_error", message: key },
						};
			const request = mock(
				async () =>
					new Response(`event: error\ndata: ${JSON.stringify(payload)}\n\n`, {
						headers: { "content-type": "text/event-stream", "x-error": key },
					}),
			);
			const resolved = await resolveStepModel(
				selectModelRoute(settings, {
					model: model.id,
					modelContextWindowTokens: model.contextWindowTokens,
				}),
				async () => key,
				request,
			);
			const result = streamText({
				model: resolved.model,
				prompt: "Synthetic test",
				maxRetries: 0,
				onError: () => undefined,
			});
			const errors = [];
			for await (const part of result.fullStream) {
				if (part.type === "error") errors.push(String(part.error));
				expect(JSON.stringify(part)).not.toContain(key);
			}
			expect(errors.length).toBeGreaterThan(0);
			expect(errors.join(" ")).not.toContain(key);
		});
	}

	it("uses session pinning and the shared step adapter for every agent", () => {
		for (const file of [
			"../agent/agent.ts",
			"../agent/subagents/agent_builder/agent.ts",
			"../agent/subagents/agent_runner/agent.ts",
		]) {
			const source = readFileSync(new URL(file, import.meta.url), "utf8");
			expect(source).toContain('"session.started"');
			expect(source).toContain("startSessionModel(");
			expect(source).toContain('"step.started": stepModel');
		}
	});

	it("blocks manual compaction before the framework can bypass the step adapter", async () => {
		const route = eveChannel.routes.find(
			(route) => route.path === "/eve/v1/session/:sessionId/compact",
		);
		expect(route?.method).toBe("POST");
		if (!route || route.transport === "websocket")
			throw new Error("Missing manual compaction guard");
		const response = await route.handler(
			new Request("https://agent.example.com/eve/v1/session/test/compact", {
				method: "POST",
			}),
			{} as never,
		);
		expect(response.status).toBe(409);
		expect(await response.text()).toContain(
			"Automatic compaction remains enabled",
		);
	});
});
