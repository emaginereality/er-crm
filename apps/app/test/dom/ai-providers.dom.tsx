import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import type { AiProvidersSettings } from "@crm/validation/ai-providers";
import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiProviders } from "../../app/(app)/[slug]/settings/ai-providers";
import { TRPCReactProvider } from "../../lib/trpc/client";
import { getQueryClient } from "../../lib/trpc/query-client";
import { createProviderFixture } from "../fixtures/ai-provider-api";

const fetch = spyOn(globalThis, "fetch");

afterAll(() => fetch.mockRestore());

afterEach(() => {
	cleanup();
	getQueryClient().clear();
	fetch.mockReset();
});

async function mountSettings(initial: Partial<AiProvidersSettings> = {}) {
	const fixture = createProviderFixture(initial);
	fetch.mockImplementation(
		Object.assign(
			async (
				input: Parameters<typeof globalThis.fetch>[0],
				init?: Parameters<typeof globalThis.fetch>[1],
			) => {
				const rawUrl = input instanceof Request ? input.url : input.toString();
				const url = new URL(rawUrl, "http://localhost");
				if (
					url.origin !== "http://localhost" ||
					!url.pathname.startsWith("/api/trpc/")
				) {
					throw new Error(
						"The component test blocks external network requests.",
					);
				}
				const paths = url.pathname.replace("/api/trpc/", "").split(",");
				const body = init?.body
					? await new Response(init.body).text()
					: (url.searchParams.get("input") ?? "{}");
				return Response.json(
					fixture.respond(paths, body, init?.method ?? "GET"),
				);
			},
			{ preconnect: () => {} },
		),
	);
	const user = userEvent.setup({ document });
	render(
		<TRPCReactProvider>
			<AiProviders />
		</TRPCReactProvider>,
	);
	await screen.findByText("AI providers", { exact: true });
	return { ...fixture, user };
}

function providerForm(name: "OpenAI" | "Anthropic") {
	const input = screen.getByLabelText(`${name} API key`, { exact: true });
	const form = input.closest("form");
	if (!form) throw new Error("The key form is missing.");
	return { input, form: within(form) };
}

async function confirm(user: ReturnType<typeof userEvent.setup>, name: string) {
	await user.click(
		within(screen.getByRole("alertdialog")).getByRole("button", {
			name,
		}),
	);
}

describe("AI provider component interactions", () => {
	it("saves and replaces keys only after confirmation and never tests automatically", async () => {
		const { mutations, user } = await mountSettings();
		const { input, form } = providerForm("OpenAI");
		expect(
			form
				.getByRole("button", { name: "Test connection" })
				.hasAttribute("disabled"),
		).toBe(true);
		await user.type(input, "test-openai-key-one");
		await user.click(form.getByRole("button", { name: "Save key" }));
		expect(mutations).toEqual([]);
		await confirm(user, "Cancel");
		expect(mutations).toEqual([]);
		expect(input.getAttribute("value")).toBe("test-openai-key-one");
		await user.click(form.getByRole("button", { name: "Save key" }));
		await confirm(user, "Save key");
		await waitFor(() => expect(input.getAttribute("value")).toBe(""));
		await form.findByText("Saved", { exact: true });
		expect(input.getAttribute("placeholder")).toBe("••••");
		expect(mutations).toEqual([
			{
				path: "settings.saveAiProviderKey",
				input: { provider: "openai", apiKey: "test-openai-key-one" },
			},
		]);
		await user.type(input, "test-openai-key-two");
		expect(
			form
				.getByRole("button", { name: "Test connection" })
				.hasAttribute("disabled"),
		).toBe(true);
		await user.click(form.getByRole("button", { name: "Replace key" }));
		expect(
			screen.getByText("Replace the OpenAI key?", { exact: true }),
		).toBeTruthy();
		await confirm(user, "Save key");
		await waitFor(() => expect(input.getAttribute("value")).toBe(""));
		expect(
			mutations.filter((entry) => entry.path === "settings.saveAiProviderKey"),
		).toHaveLength(2);
		expect(
			mutations.filter((entry) => entry.path === "settings.testAiProviderKey"),
		).toHaveLength(0);
		await user.click(form.getByRole("button", { name: "Test connection" }));
		await waitFor(() =>
			expect(
				mutations.filter(
					(entry) => entry.path === "settings.testAiProviderKey",
				),
			).toEqual([
				{ path: "settings.testAiProviderKey", input: { provider: "openai" } },
			]),
		);
	});

	it("cancels removal without mutation and removes only the selected provider after confirmation", async () => {
		const { mutations, user, state } = await mountSettings({
			openai: { configured: true, hint: "••••" },
			anthropic: { configured: true, hint: "••••" },
		});
		const { input, form } = providerForm("OpenAI");
		await user.click(form.getByRole("button", { name: "Remove key" }));
		await confirm(user, "Cancel");
		expect(mutations).toEqual([]);
		expect(state.openai.configured).toBe(true);
		await user.click(form.getByRole("button", { name: "Remove key" }));
		await confirm(user, "Remove key");
		await form.findByText("Not configured", { exact: true });
		expect(state.openai.configured).toBe(false);
		expect(state.anthropic.configured).toBe(true);
		expect(input.getAttribute("value")).toBe("");
		expect(
			form
				.getByRole("button", { name: "Test connection" })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(mutations).toEqual([
			{ path: "settings.removeAiProviderKey", input: { provider: "openai" } },
		]);
	});

	it("cancels mode switching and preserves saved keys after confirmed switches", async () => {
		const { mutations, user, state } = await mountSettings({
			openai: { configured: true, hint: "••••" },
		});
		const direct = screen.getByRole("radio", {
			name: "My API keys",
		});
		const gateway = screen.getByRole("radio", {
			name: "Vercel AI Gateway",
		});
		await user.click(direct);
		await confirm(user, "Cancel");
		expect(mutations).toEqual([]);
		expect(gateway.getAttribute("aria-checked")).toBe("true");
		await user.click(direct);
		await confirm(user, "Change mode");
		await waitFor(() =>
			expect(direct.getAttribute("aria-checked")).toBe("true"),
		);
		await screen.findByRole("combobox", { name: "Model" });
		await waitFor(() =>
			expect(screen.getByRole("combobox", { name: "Model" }).textContent).toBe(
				"OpenAI fixture model",
			),
		);
		await user.click(gateway);
		await confirm(user, "Change mode");
		await waitFor(() =>
			expect(gateway.getAttribute("aria-checked")).toBe("true"),
		);
		expect(state.openai.configured).toBe(true);
		expect(mutations.map((entry) => entry.path)).toEqual([
			"settings.setAiProviderMode",
			"settings.setAiProviderMode",
		]);
	});

	it("filters direct models and refreshes the picker after saving the second provider", async () => {
		const { mutations, user } = await mountSettings({
			mode: "direct",
			openai: { configured: true, hint: "••••" },
		});
		const picker = await screen.findByRole("combobox", { name: "Model" });
		await user.click(picker);
		expect(
			await screen.findByRole("option", { name: /OpenAI fixture model/ }),
		).toBeTruthy();
		expect(
			screen.queryByRole("option", { name: /Anthropic fixture model/ }),
		).toBeNull();
		expect(screen.queryByRole("option", { name: /Default/ })).toBeNull();
		await user.keyboard("{Escape}");
		const { input, form } = providerForm("Anthropic");
		await user.type(input, "test-anthropic-key-one");
		await user.click(form.getByRole("button", { name: "Save key" }));
		await confirm(user, "Save key");
		await form.findByText("Saved", { exact: true });
		await user.click(picker);
		expect(
			await screen.findByRole("option", { name: /OpenAI fixture model/ }),
		).toBeTruthy();
		await user.click(
			await screen.findByRole("option", { name: /Anthropic fixture model/ }),
		);
		await waitFor(() =>
			expect(picker.textContent).toBe("Anthropic fixture model"),
		);
		expect(mutations).toContainEqual({
			path: "settings.setAgentModel",
			input: { modelId: "anthropic/claude-sonnet-5.5" },
		});
	});

	it("disables direct mode with no keys and disables key entry without encryption", async () => {
		const { user, mutations } = await mountSettings({
			encryptionConfigured: false,
		});
		expect(
			screen
				.getByRole("radio", { name: "My API keys" })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(providerForm("OpenAI").input.hasAttribute("disabled")).toBe(true);
		expect(providerForm("Anthropic").input.hasAttribute("disabled")).toBe(true);
		await user.click(screen.getByRole("radio", { name: "My API keys" }));
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(mutations).toEqual([]);
	});
});
