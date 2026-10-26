import { describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "api/app-router";
import { renderToStaticMarkup } from "react-dom/server";
import { AiProviders } from "../app/(app)/[slug]/settings/ai-providers";
import { TRPCReactProvider } from "../lib/trpc/client";
import { getQueryClient } from "../lib/trpc/query-client";

function renderSettings({
	encryptionConfigured = true,
	configured = false,
	anthropicConfigured = false,
}: {
	encryptionConfigured?: boolean;
	configured?: boolean;
	anthropicConfigured?: boolean;
} = {}) {
	const windowDescriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		"window",
	);
	Object.defineProperty(globalThis, "window", {
		value: {},
		configurable: true,
	});
	const queryClient = getQueryClient();
	const client = createTRPCClient<AppRouter>({
		links: [httpBatchLink({ url: "http://localhost/unused" })],
	});
	const trpc = createTRPCOptionsProxy<AppRouter>({ client, queryClient });
	queryClient.setQueryData(trpc.settings.aiProviders.queryKey(), {
		mode: "gateway",
		encryptionConfigured,
		openai: { configured, hint: configured ? "••••1234" : null },
		anthropic: {
			configured: anthropicConfigured,
			hint: anthropicConfigured ? "••••" : null,
		},
		directModelId: null,
	});
	queryClient.setQueryData(trpc.settings.agentModel.queryKey(), {
		selectedId: null,
		effectiveId: "gateway/model",
		defaultId: "gateway/model",
		effective: null,
		updatedAt: null,
	});
	queryClient.setQueryData(trpc.settings.modelCatalog.queryKey(), {
		models: [],
		available: true,
	});
	try {
		return renderToStaticMarkup(
			<TRPCReactProvider>
				<AiProviders />
			</TRPCReactProvider>,
		);
	} finally {
		queryClient.clear();
		if (windowDescriptor) {
			Object.defineProperty(globalThis, "window", windowDescriptor);
		} else {
			Reflect.deleteProperty(globalThis, "window");
		}
	}
}

describe("AI provider settings", () => {
	it("renders separate password inputs without returning saved keys", () => {
		const html = renderSettings({ configured: true });
		expect(html.match(/type="password"/g)).toHaveLength(2);
		expect(html).toContain("OpenAI API key");
		expect(html).toContain("Anthropic API key");
		expect(html).toContain('placeholder="••••1234"');
		expect(html).not.toContain('value="••••1234"');
		expect(html).toContain("Replace key");
		expect(html).toContain("Save key");
	});

	it("does not run a provider connection check when rendering", () => {
		const fetch = spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("Unexpected network request"),
		);
		try {
			renderSettings({ configured: true });
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			fetch.mockRestore();
		}
	});

	it("explains missing encryption without removing Gateway", () => {
		const html = renderSettings({ encryptionConfigured: false });
		expect(html).toContain("Secure key storage is not configured");
		expect(html).toContain("AI_PROVIDER_ENCRYPTION_KEY");
		expect(html).toContain("Gateway remains available");
		expect(html).toMatch(/disabled=""[^>]*>My API keys/);
	});

	it("requires a saved provider key before enabling direct mode", () => {
		expect(renderSettings()).toMatch(/disabled=""[^>]*>My API keys/);
		expect(renderSettings({ configured: true })).not.toMatch(
			/disabled=""[^>]*>My API keys/,
		);
	});

	it("allows either provider alone or both providers together", () => {
		for (const keys of [
			{ configured: true },
			{ anthropicConfigured: true },
			{ configured: true, anthropicConfigured: true },
		]) {
			expect(renderSettings(keys)).not.toMatch(/disabled=""[^>]*>My API keys/);
		}
	});

	it("explains pinned sessions and immutable team-agent models", () => {
		const html = renderSettings();
		expect(html).toContain("Existing sessions keep their provider and model");
		expect(html).toContain("New team-agent runs use the saved version");
		expect(html).toContain(
			"does not verify model billing or generation access",
		);
	});

	it("gates provider management before rendering and prefetching", () => {
		const source = readFileSync(
			new URL("../app/(app)/[slug]/settings/page.tsx", import.meta.url),
			"utf8",
		);
		expect(source).toContain("canManageAiProviders(workspace.viewerRole)");
		expect(source).toContain("if (canManageProviders)");
		expect(source).toContain("{canManageProviders ? <AiProviders /> : null}");
	});

	it("invalidates model and provider catalogs after settings mutations", () => {
		const source = readFileSync(
			new URL("../lib/trpc/cache.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain("trpc.settings.modelCatalog.queryKey()");
		expect(source).toContain("trpc.settings.aiProviders.queryKey()");
	});
});
