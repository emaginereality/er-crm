import { canManageAiProviders } from "@crm/auth/organization";
import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { AiProviders } from "./ai-providers";
import { ArchiveRetention } from "./archive-retention";
import { ResearchKey } from "./research-key";
import { WorkspaceForm } from "./workspace-form";

export const metadata: Metadata = {
	title: "General",
};

export default function GeneralSettingsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>General</PageShellTitle>
					<PageShellDescription>
						Workspace details, AI providers, and agent models.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Settings />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Settings() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	const [workspace] = await Promise.all([
		queryClient.fetchQuery(trpc.workspace.get.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.researchKey.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.archiveRetention.queryOptions()),
	]);

	const canManageProviders = canManageAiProviders(workspace.viewerRole);
	if (canManageProviders) {
		await Promise.all([
			queryClient.prefetchQuery(trpc.settings.aiProviders.queryOptions()),
			queryClient.prefetchQuery(trpc.settings.agentModel.queryOptions()),
			queryClient.prefetchQuery(trpc.settings.modelCatalog.queryOptions()),
		]);
	}

	return (
		<HydrateClient>
			<div className="flex max-w-3xl flex-col gap-6">
				<WorkspaceForm />
				<ResearchKey />
				<ArchiveRetention />
				{canManageProviders ? <AiProviders /> : null}
			</div>
		</HydrateClient>
	);
}
