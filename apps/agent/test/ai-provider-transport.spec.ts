import { describe, expect, it } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { protectDirectModel } from "../agent/lib/ai-provider-transport";

describe("direct provider stream safety", () => {
	it("consumes consecutive raw events without stalling text delivery", async () => {
		const model = protectDirectModel(
			new MockLanguageModelV4({
				doStream: {
					stream: new ReadableStream({
						start(controller) {
							for (let index = 0; index < 3; index++)
								controller.enqueue({
									type: "raw",
									rawValue: "test-only-sensitive-raw-value",
								});
							controller.enqueue({
								type: "text-delta",
								id: "text",
								delta: "Safe text",
							});
							controller.close();
						},
					}),
				},
			}),
		);
		const result = await model.doStream({ prompt: [] });
		const reader = result.stream.getReader();
		expect(await reader.read()).toEqual({
			done: false,
			value: { type: "text-delta", id: "text", delta: "Safe text" },
		});
		expect(await reader.read()).toEqual({ done: true, value: undefined });
	});

	it("replaces source stream errors without retaining causes", async () => {
		const model = protectDirectModel(
			new MockLanguageModelV4({
				doStream: {
					stream: new ReadableStream({
						start(controller) {
							controller.error(new Error("test-only-sensitive-source-error"));
						},
					}),
				},
			}),
		);
		const result = await model.doStream({ prompt: [] });
		try {
			await result.stream.getReader().read();
			throw new Error("Expected source failure");
		} catch (error) {
			expect(String(error)).toContain("direct AI provider request failed");
			expect(String(error)).not.toContain("test-only-sensitive-source-error");
			expect(error instanceof Error ? error.cause : undefined).toBeUndefined();
		}
	});
});
