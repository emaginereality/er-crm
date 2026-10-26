import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";

function providerError(signal?: AbortSignal): Error {
	return signal?.aborted
		? new DOMException("The AI provider request was cancelled.", "AbortError")
		: new Error(
				"The direct AI provider request failed. Check the saved key, model access, and quota in AI settings.",
			);
}

export function directProviderFetch(request: typeof fetch): typeof fetch {
	return async (input, init) => {
		try {
			const response = await request(input, { ...init, redirect: "error" });
			if (!response.ok) {
				await response.body?.cancel();
				return Response.json(
					{
						error: {
							type: "provider_error",
							message: "The direct AI provider refused the request.",
						},
					},
					{ status: response.status },
				);
			}
			const headers = new Headers();
			const contentType = response.headers.get("content-type");
			if (contentType)
				headers.set(
					"content-type",
					contentType.startsWith("text/event-stream")
						? "text/event-stream"
						: "application/json",
				);
			return new Response(response.body, { status: response.status, headers });
		} catch {
			throw providerError(init?.signal ?? undefined);
		}
	};
}

const protectProviderErrors: LanguageModelMiddleware = {
	specificationVersion: "v4",
	async wrapGenerate({ doGenerate, params }) {
		try {
			return await doGenerate();
		} catch {
			throw providerError(params.abortSignal);
		}
	},
	async wrapStream({ doStream, params }) {
		try {
			const result = await doStream();
			const reader = result.stream.getReader();
			return {
				...result,
				stream: new ReadableStream({
					async pull(controller) {
						try {
							while (true) {
								const part = await reader.read();
								if (part.done) {
									controller.close();
									return;
								}
								if (part.value.type === "raw") continue;
								controller.enqueue(
									part.value.type === "error"
										? {
												type: "error",
												error: providerError(params.abortSignal),
											}
										: part.value,
								);
								return;
							}
						} catch {
							controller.error(providerError(params.abortSignal));
						}
					},
					async cancel() {
						await reader.cancel().catch(() => undefined);
					},
				}),
			};
		} catch {
			throw providerError(params.abortSignal);
		}
	},
};

export function protectDirectModel(
	model: Parameters<typeof wrapLanguageModel>[0]["model"],
): ReturnType<typeof wrapLanguageModel> {
	return wrapLanguageModel({ model, middleware: protectProviderErrors });
}
