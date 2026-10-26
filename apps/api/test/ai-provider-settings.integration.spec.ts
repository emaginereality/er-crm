import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	aiProviderSecretPurpose,
	createAiProviderSecretBox,
} from "@crm/auth/ai-provider-crypto";
import { WORKSPACE_ID } from "@crm/auth/organization";
import { type AppSettingModel, db } from "@crm/db";
import { readAgentModel, SETTINGS_ID } from "@crm/db/settings";
import type { ResearchKeyService } from "../src/agent/research-key.service";
import type { BackfillService } from "../src/backfill/backfill.service";
import type { ModelCatalogService } from "../src/settings/model-catalog.service";
import { SettingsService } from "../src/settings/settings.service";

const suffix = `ai-provider-${crypto.randomUUID()}`;
const adminId = `admin-${suffix}`;
const memberId = `member-${suffix}`;
const contactId = `contact-${suffix}`;
const conversationId = `conversation-${suffix}`;
const eventId = `event-${suffix}`;
const originalEncryptionKey = process.env.AI_PROVIDER_ENCRYPTION_KEY;
let previous: AppSettingModel | null = null;
let createdWorkspace = false;
let prepared = false;

const gateway = {
	id: "zai/glm-5.2-fast",
	name: "GLM 5.2 Fast",
	provider: "zai",
	contextWindowTokens: 1_000_000,
	pricing: null,
};
const settings = new SettingsService(
	db,
	{
		models: async () => [gateway],
		find: async () => gateway,
	} as unknown as ModelCatalogService,
	{} as ResearchKeyService,
	{} as BackfillService,
);

beforeAll(async () => {
	process.env.AI_PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString(
		"base64",
	);
	previous = await db.appSetting.findUnique({ where: { id: SETTINGS_ID } });
	const workspace = await db.organization.findUnique({
		where: { id: WORKSPACE_ID },
	});
	createdWorkspace = workspace === null;
	await db.organization.upsert({
		where: { id: WORKSPACE_ID },
		create: {
			id: WORKSPACE_ID,
			name: "Provider test",
			slug: "provider-test",
			createdAt: new Date(),
		},
		update: {},
	});
	for (const [id, role] of [
		[adminId, "admin"],
		[memberId, "member"],
	] as const) {
		await db.user.create({
			data: { id, name: "Provider fixture", email: `${id}@example.test` },
		});
		await db.member.create({
			data: {
				id: `${id}-membership`,
				userId: id,
				organizationId: WORKSPACE_ID,
				role,
				createdAt: new Date(),
			},
		});
	}
	await db.appSetting.upsert({
		where: { id: SETTINGS_ID },
		create: { id: SETTINGS_ID },
		update: {
			aiProviderMode: "gateway",
			directModelId: null,
			directModelContextWindow: null,
			openaiApiKeyEncrypted: null,
			anthropicApiKeyEncrypted: null,
		},
	});
	await db.contact.create({
		data: {
			id: contactId,
			firstName: "Preserved",
			email: `${suffix}@example.test`,
		},
	});
	await db.agentConversation.create({
		data: {
			id: conversationId,
			contactId,
			userId: adminId,
			sessionId: `${suffix}-session`,
			title: "Preserved history",
			messageCount: 1,
		},
	});
	await db.agentEvent.create({
		data: {
			id: eventId,
			sessionId: `${suffix}-session`,
			conversationId,
			type: "message.received",
			data: { text: "Keep this history" },
			emittedAt: new Date(),
		},
	});
	prepared = true;
});

afterAll(async () => {
	if (prepared) {
		await db.contact.deleteMany({ where: { id: contactId } });
		await db.user.deleteMany({ where: { id: { in: [adminId, memberId] } } });
		if (createdWorkspace)
			await db.organization.delete({ where: { id: WORKSPACE_ID } });
		if (previous) {
			await db.appSetting.update({
				where: { id: SETTINGS_ID },
				data: {
					aiProviderMode: previous.aiProviderMode,
					directModelId: previous.directModelId,
					directModelContextWindow: previous.directModelContextWindow,
					openaiApiKeyEncrypted: previous.openaiApiKeyEncrypted,
					anthropicApiKeyEncrypted: previous.anthropicApiKeyEncrypted,
					agentModelId: previous.agentModelId,
					agentModelContextWindow: previous.agentModelContextWindow,
				},
			});
		} else {
			await db.appSetting.delete({ where: { id: SETTINGS_ID } });
		}
	}
	if (originalEncryptionKey === undefined)
		delete process.env.AI_PROVIDER_ENCRYPTION_KEY;
	else process.env.AI_PROVIDER_ENCRYPTION_KEY = originalEncryptionKey;
	await db.$disconnect();
});

describe("AI providers with PostgreSQL", () => {
	it("enforces database roles and preserves CRM records and chat history across switches", async () => {
		const originalContact = await db.contact.findUnique({
			where: { id: contactId },
		});
		const originalConversation = await db.agentConversation.findUnique({
			where: { id: conversationId },
		});
		const originalEvent = await db.agentEvent.findUnique({
			where: { id: eventId },
		});
		await expect(
			settings.saveAiProviderKey(
				memberId,
				"openai",
				"fixture-openai-not-a-credential",
			),
		).rejects.toThrow("Only workspace owners");
		await settings.setAgentModel(adminId, gateway.id);
		await settings.saveAiProviderKey(
			adminId,
			"openai",
			"fixture-openai-not-a-credential",
		);
		await settings.saveAiProviderKey(
			adminId,
			"anthropic",
			"fixture-anthropic-not-a-credential",
		);
		const stored = await db.appSetting.findUniqueOrThrow({
			where: { id: SETTINGS_ID },
		});
		expect(stored.openaiApiKeyEncrypted).toStartWith("v1.");
		expect(stored.anthropicApiKeyEncrypted).toStartWith("v1.");
		expect(JSON.stringify(stored)).not.toContain(
			"fixture-openai-not-a-credential",
		);
		expect(
			createAiProviderSecretBox()?.decrypt(
				stored.openaiApiKeyEncrypted ?? "",
				aiProviderSecretPurpose("openai"),
			),
		).toBe("fixture-openai-not-a-credential");
		await settings.setAiProviderMode(adminId, "direct");
		expect((await readAgentModel(db)).id).toBe("openai/gpt-6.1-sol");
		expect((await settings.modelCatalog()).models).toHaveLength(7);
		await settings.setAgentModel(adminId, "anthropic/claude-sonnet-5.5");
		await expect(
			settings.removeAiProviderKey(adminId, "anthropic"),
		).rejects.toThrow("Select another provider");
		await settings.removeAiProviderKey(adminId, "openai");
		expect((await settings.modelCatalog()).models).toHaveLength(3);
		await settings.setAiProviderMode(adminId, "gateway");
		expect((await readAgentModel(db)).id).toBe(gateway.id);
		await settings.setAiProviderMode(adminId, "direct");
		expect((await readAgentModel(db)).id).toBe("anthropic/claude-sonnet-5.5");
		expect((await settings.aiProviders(adminId)).anthropic.hint).toBe("••••");
		expect(await db.contact.findUnique({ where: { id: contactId } })).toEqual(
			originalContact,
		);
		expect(
			await db.agentConversation.findUnique({ where: { id: conversationId } }),
		).toEqual(originalConversation);
		expect(await db.agentEvent.findUnique({ where: { id: eventId } })).toEqual(
			originalEvent,
		);
	});
});
