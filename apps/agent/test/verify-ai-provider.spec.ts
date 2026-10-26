import { describe, expect, it, mock } from "bun:test";
import { verifyAiProvider } from "../agent/lib/verify-ai-provider";

const readKey = async () => "test-only-provider-key";

describe("explicit AI provider connection tests", () => {
	for (const provider of ["openai", "anthropic"] as const) {
		it(`checks ${provider} with a models GET and never generates`, async () => {
			const request = mock(
				async (url: URL | RequestInfo, init?: RequestInit) => {
					expect(String(url)).toContain("/v1/models");
					expect(init?.method).toBe("GET");
					expect(init?.body).toBeUndefined();
					expect(init?.redirect).toBe("error");
					expect(init?.signal).toBeInstanceOf(AbortSignal);
					const headers = new Headers(init?.headers);
					expect(
						headers.get(provider === "openai" ? "authorization" : "x-api-key"),
					).toContain("test-only-provider-key");
					return Response.json({ data: [] });
				},
			);
			const result = await verifyAiProvider(provider, readKey, request);
			expect(result.outcome).toBe("valid");
			expect(result.reason).toContain("billing, and quota are not checked");
			expect(request).toHaveBeenCalledTimes(1);
		});
	}

	for (const status of [401, 403, 429, 500, 302]) {
		it(`classifies status ${status} without returning provider bodies`, async () => {
			const request = mock(
				async () => new Response("Secret provider response", { status }),
			);
			const result = await verifyAiProvider("openai", readKey, request);
			expect(result.outcome).toBe(status === 401 ? "invalid" : "unknown");
			expect(JSON.stringify(result)).not.toContain("Secret provider response");
		});
	}

	it("does not send a request without a saved key", async () => {
		const request = mock(async () => Response.json({}));
		const result = await verifyAiProvider(
			"openai",
			async () => {
				throw new Error("Secret database details");
			},
			request,
		);
		expect(result.outcome).toBe("unknown");
		expect(JSON.stringify(result)).not.toContain("Secret database details");
		expect(request).not.toHaveBeenCalled();
	});

	it("does not expose transport errors or mislabel them as invalid keys", async () => {
		const request = mock(async () => {
			throw new Error("Secret transport details");
		});
		const result = await verifyAiProvider("anthropic", readKey, request);
		expect(result.outcome).toBe("unknown");
		expect(JSON.stringify(result)).not.toContain("Secret transport details");
	});
});
