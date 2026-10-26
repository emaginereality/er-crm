import {
	aiProviderInput,
	aiProvidersOutput,
	aiProviderTestOutput,
	saveAiProviderKeyInput,
	setAiProviderModeInput,
} from "@crm/validation/ai-providers";
import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	agentModelOutput,
	archiveRetentionOutput,
	modelCatalogOutput,
	researchKeyOutput,
	setAgentModelInput,
	setArchiveRetentionDaysInput,
	setResearchKeyInput,
} from "./settings.contracts";
import { SettingsService } from "./settings.service";

@Router({ alias: "settings" })
@UseMiddlewares(AuthMiddleware)
export class SettingsRouter {
	constructor(
		@Inject(SettingsService) private readonly settings: SettingsService,
	) {}

	@Query({
		output: agentModelOutput,
		meta: restMeta("GET", "/settings/agent-model", ["Settings"]),
	})
	async agentModel() {
		return this.settings.agentModel();
	}

	@Query({
		output: modelCatalogOutput,
		meta: restMeta("GET", "/settings/model-catalog", ["Settings"]),
	})
	async modelCatalog() {
		return this.settings.modelCatalog();
	}

	@Mutation({
		input: setAgentModelInput,
		output: agentModelOutput,
		meta: restMeta("PATCH", "/settings/agent-model", ["Settings"]),
	})
	async setAgentModel(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setAgentModelInput>,
	) {
		return this.settings.setAgentModel(ctx.user.id, input.modelId);
	}

	@Query({
		output: aiProvidersOutput,
		meta: restMeta("GET", "/settings/ai-providers", ["Settings"]),
	})
	async aiProviders(@Ctx() ctx: AuthedTrpcContext) {
		return this.settings.aiProviders(ctx.user.id);
	}

	@Mutation({
		input: setAiProviderModeInput,
		output: aiProvidersOutput,
		meta: restMeta("PATCH", "/settings/ai-providers/mode", ["Settings"]),
	})
	async setAiProviderMode(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setAiProviderModeInput>,
	) {
		return this.settings.setAiProviderMode(ctx.user.id, input.mode);
	}

	@Mutation({
		input: saveAiProviderKeyInput,
		output: aiProvidersOutput,
		meta: restMeta("PUT", "/settings/ai-providers/key", ["Settings"]),
	})
	async saveAiProviderKey(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof saveAiProviderKeyInput>,
	) {
		return this.settings.saveAiProviderKey(
			ctx.user.id,
			input.provider,
			input.apiKey,
		);
	}

	@Mutation({
		input: aiProviderInput,
		output: aiProvidersOutput,
		meta: restMeta("DELETE", "/settings/ai-providers/key", ["Settings"]),
	})
	async removeAiProviderKey(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof aiProviderInput>,
	) {
		return this.settings.removeAiProviderKey(ctx.user.id, input.provider);
	}

	@Mutation({
		input: aiProviderInput,
		output: aiProviderTestOutput,
		meta: restMeta("POST", "/settings/ai-providers/test", ["Settings"]),
	})
	async testAiProviderKey(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof aiProviderInput>,
	) {
		return this.settings.testAiProviderKey(ctx.user.id, input.provider);
	}

	@Query({
		output: researchKeyOutput,
		meta: restMeta("GET", "/settings/research-key", ["Settings"]),
	})
	async researchKey() {
		return this.settings.researchKey();
	}

	@Mutation({
		input: setResearchKeyInput,
		output: researchKeyOutput,
		meta: restMeta("PATCH", "/settings/research-key", ["Settings"]),
	})
	async setResearchKey(@Input() input: z.infer<typeof setResearchKeyInput>) {
		return this.settings.setResearchKey(input.apiKey);
	}

	@Query({
		output: archiveRetentionOutput,
		meta: restMeta("GET", "/settings/archive-retention", ["Settings"]),
	})
	async archiveRetention() {
		return this.settings.archiveRetention();
	}

	@Mutation({
		input: setArchiveRetentionDaysInput,
		output: archiveRetentionOutput,
		meta: restMeta("PATCH", "/settings/archive-retention", ["Settings"]),
	})
	async setArchiveRetention(
		@Input() input: z.infer<typeof setArchiveRetentionDaysInput>,
	) {
		return this.settings.setArchiveRetention(input.days);
	}
}
