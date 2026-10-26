import {
	aiProviderSecretPurpose,
	createAiProviderSecretBox,
} from "@crm/auth/ai-provider-crypto";
import { canManageAiProviders, workspaceRoleOf } from "@crm/auth/organization";
import type { Db, Prisma } from "@crm/db";
import {
	type AiProvider,
	type AiProviderMode,
	readAiProviderSettings,
} from "@crm/db/ai-providers";
import {
	DEFAULT_AGENT_MODEL,
	maskKey,
	readAgentModel,
	readArchiveRetentionDays,
	readContextDevKey,
	SETTINGS_ID,
	writeArchiveRetentionDays,
	writeContextDevKey,
} from "@crm/db/settings";
import {
	type AiProvidersSettings,
	configuredDirectAiModels,
	directAiModel,
} from "@crm/validation/ai-providers";
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	Logger,
} from "@nestjs/common";
import { ResearchKeyService } from "../agent/research-key.service";
import { BackfillService } from "../backfill/backfill.service";
import { InjectDatabase } from "../database/database.constants";
import { testSavedAiProvider } from "./ai-provider-test";
import { ModelCatalogService } from "./model-catalog.service";
import type {
	AgentModelSettings,
	ArchiveRetentionSettings,
	ModelCatalogResult,
	ResearchKeySettings,
} from "./settings.contracts";

@Injectable()
export class SettingsService {
	private readonly logger = new Logger(SettingsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly catalog: ModelCatalogService,
		private readonly researchKeys: ResearchKeyService,
		private readonly backfill: BackfillService,
	) {}

	async agentModel(): Promise<AgentModelSettings> {
		const [model, providers, row] = await Promise.all([
			readAgentModel(this.db),
			readAiProviderSettings(this.db),
			this.db.appSetting.findUnique({
				where: { id: SETTINGS_ID },
				select: { updatedAt: true },
			}),
		]);
		const direct = providers.mode === "direct";
		return {
			selectedId: model.isDefault ? null : model.id,
			effectiveId: model.id,
			defaultId: direct
				? (configuredDirectAiModels(providers)[0]?.id ?? model.id)
				: DEFAULT_AGENT_MODEL.id,
			effective: direct
				? (directAiModel(model.id) ?? null)
				: await this.catalog.find(model.id),
			updatedAt: row?.updatedAt.toISOString() ?? null,
		};
	}

	async setAgentModel(
		userId: string,
		modelId: string | null,
	): Promise<AgentModelSettings> {
		await this.requireAiAdmin(userId);
		const before = await readAiProviderSettings(this.db);
		const models =
			before.mode === "direct"
				? configuredDirectAiModels(before)
				: await this.catalog.models();
		if (!models && modelId !== null) {
			throw new BadRequestException(
				"The model catalog is unavailable. Try again later.",
			);
		}
		const chosen = models?.find((model) => model.id === modelId);
		if (modelId !== null && !chosen) {
			throw new BadRequestException(
				"Select an available tool-using model from the configured providers.",
			);
		}
		await this.db.$transaction(async (tx) => {
			const row = await this.lockAiSettings(tx);
			if (row.aiProviderMode !== before.mode) {
				throw new ConflictException(
					"The AI mode changed. Refresh settings and try again.",
				);
			}
			if (row.aiProviderMode === "direct") {
				this.requireEncryption();
				const available = configuredDirectAiModels({
					openaiConfigured: Boolean(row.openaiApiKeyEncrypted),
					anthropicConfigured: Boolean(row.anthropicApiKeyEncrypted),
				});
				const direct =
					modelId === null
						? available[0]
						: available.find((model) => model.id === modelId);
				if (!direct) {
					throw new BadRequestException(
						"Save a key for this provider before selecting its model.",
					);
				}
				await tx.appSetting.update({
					where: { id: SETTINGS_ID },
					data: {
						directModelId: direct.id,
						directModelContextWindow: direct.contextWindowTokens,
					},
				});
			} else {
				await tx.appSetting.update({
					where: { id: SETTINGS_ID },
					data: {
						agentModelId: chosen?.id ?? null,
						agentModelContextWindow: chosen?.contextWindowTokens ?? null,
					},
				});
			}
		});
		this.logger.log({ message: "Agent model changed" });
		return this.agentModel();
	}

	async modelCatalog(): Promise<ModelCatalogResult> {
		const providers = await readAiProviderSettings(this.db);
		if (providers.mode === "direct") {
			return { models: configuredDirectAiModels(providers), available: true };
		}
		const models = await this.catalog.models();
		return { models: models ?? [], available: models !== null };
	}

	async aiProviders(userId: string): Promise<AiProvidersSettings> {
		await this.requireAiAdmin(userId);
		const settings = await readAiProviderSettings(this.db);
		return {
			mode: settings.mode,
			encryptionConfigured: Boolean(createAiProviderSecretBox()),
			openai: {
				configured: settings.openaiConfigured,
				hint: settings.openaiConfigured ? "••••" : null,
			},
			anthropic: {
				configured: settings.anthropicConfigured,
				hint: settings.anthropicConfigured ? "••••" : null,
			},
			directModelId: settings.directModelId,
		};
	}

	async setAiProviderMode(
		userId: string,
		mode: AiProviderMode,
	): Promise<AiProvidersSettings> {
		await this.requireAiAdmin(userId);
		await this.db.$transaction(async (tx) => {
			const row = await this.lockAiSettings(tx);
			if (mode === "direct") {
				this.requireEncryption();
				const models = configuredDirectAiModels({
					openaiConfigured: Boolean(row.openaiApiKeyEncrypted),
					anthropicConfigured: Boolean(row.anthropicApiKeyEncrypted),
				});
				const selected =
					models.find((model) => model.id === row.directModelId) ?? models[0];
				if (!selected) {
					throw new BadRequestException(
						"Save an OpenAI or Anthropic API key before enabling direct mode.",
					);
				}
				await tx.appSetting.update({
					where: { id: SETTINGS_ID },
					data: {
						aiProviderMode: mode,
						directModelId: selected.id,
						directModelContextWindow: selected.contextWindowTokens,
					},
				});
			} else {
				await tx.appSetting.update({
					where: { id: SETTINGS_ID },
					data: { aiProviderMode: mode },
				});
			}
		});
		return this.aiProviders(userId);
	}

	async saveAiProviderKey(
		userId: string,
		provider: AiProvider,
		apiKey: string,
	): Promise<AiProvidersSettings> {
		await this.requireAiAdmin(userId);
		const encrypted = this.requireEncryption().encrypt(
			apiKey,
			aiProviderSecretPurpose(provider),
		);
		await this.db.$transaction(async (tx) => {
			await this.lockAiSettings(tx);
			await tx.appSetting.update({
				where: { id: SETTINGS_ID },
				data:
					provider === "openai"
						? { openaiApiKeyEncrypted: encrypted }
						: { anthropicApiKeyEncrypted: encrypted },
			});
		});
		return this.aiProviders(userId);
	}

	async removeAiProviderKey(
		userId: string,
		provider: AiProvider,
	): Promise<AiProvidersSettings> {
		await this.requireAiAdmin(userId);
		await this.db.$transaction(async (tx) => {
			const row = await this.lockAiSettings(tx);
			if (
				row.aiProviderMode === "direct" &&
				row.directModelId?.startsWith(`${provider}/`)
			) {
				throw new BadRequestException(
					"Select another provider's model or switch to AI Gateway before removing this key.",
				);
			}
			await tx.appSetting.update({
				where: { id: SETTINGS_ID },
				data:
					provider === "openai"
						? { openaiApiKeyEncrypted: null }
						: { anthropicApiKeyEncrypted: null },
			});
		});
		return this.aiProviders(userId);
	}

	async testAiProviderKey(userId: string, provider: AiProvider) {
		await this.requireAiAdmin(userId);
		this.requireEncryption();
		const settings = await readAiProviderSettings(this.db);
		if (
			!(provider === "openai"
				? settings.openaiConfigured
				: settings.anthropicConfigured)
		) {
			throw new BadRequestException(
				"Save this provider's API key before testing the connection.",
			);
		}
		return testSavedAiProvider(provider);
	}

	private async requireAiAdmin(userId: string) {
		if (!canManageAiProviders(await workspaceRoleOf(userId, this.db))) {
			throw new ForbiddenException(
				"Only workspace owners and administrators can manage AI providers.",
			);
		}
	}

	private requireEncryption() {
		const box = createAiProviderSecretBox();
		if (!box) {
			throw new BadRequestException(
				"Configure AI_PROVIDER_ENCRYPTION_KEY on the API and agent before using direct providers.",
			);
		}
		return box;
	}

	private lockAiSettings(tx: Prisma.TransactionClient) {
		return tx.appSetting.upsert({
			where: { id: SETTINGS_ID },
			create: { id: SETTINGS_ID },
			update: { id: SETTINGS_ID },
		});
	}

	async researchKey(): Promise<ResearchKeySettings> {
		const key = await readContextDevKey(this.db);

		return { configured: key !== null, hint: key ? maskKey(key) : null };
	}

	async setResearchKey(apiKey: string): Promise<ResearchKeySettings> {
		const check = await this.researchKeys.verify(apiKey);

		if (check.outcome === "invalid") {
			throw new BadRequestException(check.reason);
		}

		await writeContextDevKey(this.db, apiKey);

		this.logger.log({
			message: "Context key saved",
			verified: check.outcome === "valid",
		});

		// Every company added while there was no key is still PENDING, because a
		// brand task with nowhere to look leaves the record alone. The sign-in
		// sweep would find them, but the person who just fixed it is standing
		// here — so pick the work up now rather than on their next sign-in.
		void this.backfill
			.run("companies")
			.then(({ queued, remaining }) => {
				if (queued > 0) {
					this.logger.log({
						message: "Queued the research that was waiting on a key",
						queued,
						remaining,
					});
				}
			})
			.catch((cause: unknown) => {
				this.logger.warn(
					{ message: "Could not queue the waiting research" },
					cause instanceof Error ? cause.stack : String(cause),
				);
			});

		return this.researchKey();
	}

	async archiveRetention(): Promise<ArchiveRetentionSettings> {
		return { days: await readArchiveRetentionDays(this.db) };
	}

	async setArchiveRetention(days: number): Promise<ArchiveRetentionSettings> {
		const saved = await writeArchiveRetentionDays(this.db, days);

		this.logger.log({
			message: "Archive retention changed",
			days: saved,
		});

		return { days: saved };
	}
}
