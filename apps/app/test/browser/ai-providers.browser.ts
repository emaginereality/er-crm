import type { AiProvidersSettings } from "@crm/validation/ai-providers";
import { expect, type Page, test } from "@playwright/test";
import { createProviderFixture } from "../fixtures/ai-provider-api";

async function mockSettings(
	page: Page,
	initial: Partial<AiProvidersSettings> = {},
) {
	const fixture = createProviderFixture(initial);
	const externalRequests: string[] = [];
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === "127.0.0.1") await route.continue();
		else {
			externalRequests.push(url.origin);
			await route.abort();
		}
	});
	await page.route("**/api/trpc/**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const paths = url.pathname.replace("/api/trpc/", "").split(",");
		const inputs = request.postData() ?? url.searchParams.get("input") ?? "{}";
		await route.fulfill({
			json: fixture.respond(paths, inputs, request.method()),
		});
	});
	await page.goto("/");
	await expect(page.getByText("AI providers", { exact: true })).toBeVisible();
	return { ...fixture, externalRequests };
}

const providerForm = (page: Page, name: "OpenAI" | "Anthropic") =>
	page
		.locator("form")
		.filter({ has: page.getByLabel(`${name} API key`, { exact: true }) });

test("save, replace, test, and remove require explicit confirmed clicks", async ({
	page,
}) => {
	const { mutations, externalRequests } = await mockSettings(page);
	const form = providerForm(page, "OpenAI");
	const key = form.getByLabel("OpenAI API key", { exact: true });
	await expect(
		page.getByRole("radio", { name: "My API keys", exact: true }),
	).toBeDisabled();
	await expect(
		form.getByRole("button", { name: "Test connection" }),
	).toBeDisabled();
	await key.fill("test-openai-key-one");
	await form.getByRole("button", { name: "Save key", exact: true }).click();
	await expect(page.getByRole("alertdialog")).toBeVisible();
	expect(mutations).toEqual([]);
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Cancel" })
		.click();
	expect(mutations).toEqual([]);
	await expect(key).toHaveValue("test-openai-key-one");
	await form.getByRole("button", { name: "Save key", exact: true }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Save key", exact: true })
		.click();
	await expect(key).toHaveValue("");
	await expect(key).toHaveAttribute("placeholder", "••••");
	await expect(form.getByText("Saved", { exact: true })).toBeVisible();
	expect(mutations).toEqual([
		{
			path: "settings.saveAiProviderKey",
			input: { provider: "openai", apiKey: "test-openai-key-one" },
		},
	]);
	await expect(
		page.getByRole("radio", { name: "My API keys", exact: true }),
	).toBeEnabled();
	await key.fill("test-openai-key-two");
	await expect(
		form.getByRole("button", { name: "Test connection" }),
	).toBeDisabled();
	await form.getByRole("button", { name: "Replace key", exact: true }).click();
	await expect(
		page
			.getByRole("alertdialog")
			.getByText("Replace the OpenAI key?", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Save key", exact: true })
		.click();
	await expect(key).toHaveValue("");
	expect(
		mutations.filter((entry) => entry.path === "settings.saveAiProviderKey"),
	).toHaveLength(2);
	expect(
		mutations.filter((entry) => entry.path === "settings.testAiProviderKey"),
	).toHaveLength(0);
	await form.getByRole("button", { name: "Test connection" }).click();
	await expect
		.poll(
			() =>
				mutations.filter((entry) => entry.path === "settings.testAiProviderKey")
					.length,
		)
		.toBe(1);
	await expect(form.getByRole("button", { name: "Remove key" })).toBeEnabled();
	await form.getByRole("button", { name: "Remove key" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Cancel" })
		.click();
	expect(
		mutations.filter((entry) => entry.path === "settings.removeAiProviderKey"),
	).toHaveLength(0);
	await form.getByRole("button", { name: "Remove key" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Remove key", exact: true })
		.click();
	await expect(form.getByText("Not configured", { exact: true })).toBeVisible();
	await expect(
		form.getByRole("button", { name: "Test connection" }),
	).toBeDisabled();
	await expect(key).toHaveValue("");
	expect(
		mutations.filter((entry) => entry.path === "settings.removeAiProviderKey"),
	).toEqual([
		{ path: "settings.removeAiProviderKey", input: { provider: "openai" } },
	]);
	expect(externalRequests).toEqual([]);
});

test("mode confirmation cancels without mutation and preserves keys when confirmed", async ({
	page,
}) => {
	const { mutations, state } = await mockSettings(page, {
		openai: { configured: true, hint: "••••" },
	});
	const direct = page.getByRole("radio", { name: "My API keys", exact: true });
	const gateway = page.getByRole("radio", {
		name: "Vercel AI Gateway",
		exact: true,
	});
	await direct.click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Cancel" })
		.click();
	await expect(gateway).toHaveAttribute("aria-checked", "true");
	expect(mutations).toEqual([]);
	await direct.click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Change mode" })
		.click();
	await expect(direct).toHaveAttribute("aria-checked", "true");
	await expect(page.getByRole("combobox", { name: "Model" })).toHaveText(
		"OpenAI fixture model",
	);
	expect(state.openai.configured).toBe(true);
	await gateway.click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Change mode" })
		.click();
	await expect(gateway).toHaveAttribute("aria-checked", "true");
	await expect(page.getByRole("combobox", { name: "Model" })).toHaveText(
		"Default — Gateway fixture model",
	);
	expect(state.openai.configured).toBe(true);
	expect(mutations.map((entry) => entry.path)).toEqual([
		"settings.setAiProviderMode",
		"settings.setAiProviderMode",
	]);
});

test("the direct model picker lists configured providers and refreshes after saving another key", async ({
	page,
}) => {
	const { mutations } = await mockSettings(page, {
		mode: "direct",
		openai: { configured: true, hint: "••••" },
	});
	const picker = page.getByRole("combobox", { name: "Model" });
	await expect(picker).toHaveText("OpenAI fixture model");
	await picker.click();
	await expect(
		page.getByRole("option", { name: /OpenAI fixture model/ }),
	).toBeVisible();
	await expect(
		page.getByRole("option", { name: /Anthropic fixture model/ }),
	).toHaveCount(0);
	await expect(page.getByRole("option", { name: /Default/ })).toHaveCount(0);
	await page.keyboard.press("Escape");
	const form = providerForm(page, "Anthropic");
	await form
		.getByLabel("Anthropic API key", { exact: true })
		.fill("test-anthropic-key-one");
	await form.getByRole("button", { name: "Save key", exact: true }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Save key", exact: true })
		.click();
	await expect(form.getByText("Saved", { exact: true })).toBeVisible();
	await picker.click();
	await expect(
		page.getByRole("option", { name: /OpenAI fixture model/ }),
	).toBeVisible();
	await page.getByRole("option", { name: /Anthropic fixture model/ }).click();
	await expect(picker).toHaveText("Anthropic fixture model");
	expect(mutations).toContainEqual({
		path: "settings.setAgentModel",
		input: { modelId: "anthropic/claude-sonnet-5.5" },
	});
});

test("Anthropic alone enables direct mode and missing encryption disables key entry", async ({
	page,
}) => {
	await mockSettings(page, {
		mode: "direct",
		anthropic: { configured: true, hint: "••••" },
	});
	const picker = page.getByRole("combobox", { name: "Model" });
	await expect(picker).toHaveText("Anthropic fixture model");
	await picker.click();
	await expect(
		page.getByRole("option", { name: /OpenAI fixture model/ }),
	).toHaveCount(0);
	await expect(
		page.getByRole("option", { name: /Anthropic fixture model/ }),
	).toBeVisible();
	await page.unrouteAll();
	await mockSettings(page, { encryptionConfigured: false });
	await expect(
		page.getByLabel("OpenAI API key", { exact: true }),
	).toBeDisabled();
	await expect(
		page.getByLabel("Anthropic API key", { exact: true }),
	).toBeDisabled();
	await expect(
		page.getByRole("radio", { name: "My API keys", exact: true }),
	).toBeDisabled();
	await expect(
		page.getByRole("radio", { name: "Vercel AI Gateway", exact: true }),
	).toBeEnabled();
});
