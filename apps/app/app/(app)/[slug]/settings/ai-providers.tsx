"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@crm/ui/components/alert-dialog";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldTitle,
} from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Separator } from "@crm/ui/components/separator";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { AgentModel } from "./agent-model";

type Provider = "openai" | "anthropic";
type Mode = "gateway" | "direct";
type KeyStatus = { configured: boolean; hint: string | null };

function ProviderKey({
	provider,
	label,
	status,
	encryptionConfigured,
}: {
	provider: Provider;
	label: string;
	status: KeyStatus;
	encryptionConfigured: boolean;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const keyId = useId();
	const descriptionId = useId();
	const [draft, setDraft] = useState("");
	const [confirmation, setConfirmation] = useState<"save" | "remove" | null>(
		null,
	);

	const save = useMutation(
		trpc.settings.saveAiProviderKey.mutationOptions({
			gcTime: 0,
			onSuccess: async () => {
				setDraft("");
				await cache.settings();
				toast.success(`${label} key saved. Connection testing is separate.`);
			},
			onError: (error) => toast.error(error.message),
			onSettled: (): void => {
				save.reset();
			},
		}),
	);
	const remove = useMutation(
		trpc.settings.removeAiProviderKey.mutationOptions({
			onSuccess: async () => {
				setDraft("");
				await cache.settings();
				toast.success(
					`${label} key removed. CRM records and history stay intact.`,
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const test = useMutation(
		trpc.settings.testAiProviderKey.mutationOptions({
			onSuccess: (result) => {
				if (result.outcome === "valid") {
					toast.success(`${label} accepts the saved key.`);
				} else {
					toast.error(result.reason ?? "The connection check did not succeed.");
				}
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const busy = save.isPending || remove.isPending || test.isPending;
	const disabled = !encryptionConfigured || busy;

	return (
		<>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (!disabled && draft.trim()) setConfirmation("save");
				}}
			>
				<FieldGroup>
					<Field data-disabled={disabled}>
						<div className="flex items-center justify-between gap-3">
							<FieldLabel htmlFor={keyId}>{label} API key</FieldLabel>
							<StatusIndicator
								size="sm"
								tone={status.configured ? "success" : "warning"}
								label={status.configured ? "Saved" : "Not configured"}
							/>
						</div>
						<Input
							id={keyId}
							type="password"
							minLength={8}
							maxLength={500}
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							placeholder={status.hint ?? `Paste your ${label} key`}
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							aria-describedby={descriptionId}
							disabled={disabled}
						/>
						<FieldDescription id={descriptionId}>
							Keys stay encrypted on the server. Saved keys cannot be revealed.
							Testing checks the saved key, not unsaved text.
						</FieldDescription>
					</Field>
					<div className="flex flex-wrap gap-2">
						<Button type="submit" disabled={disabled || !draft.trim()}>
							{save.isPending ? <Spinner data-icon="inline-start" /> : null}
							{status.configured ? "Replace key" : "Save key"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={disabled || !status.configured || draft.trim() !== ""}
							onClick={() => test.mutate({ provider })}
						>
							{test.isPending ? <Spinner data-icon="inline-start" /> : null}
							Test connection
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={busy || !status.configured}
							onClick={() => setConfirmation("remove")}
						>
							{remove.isPending ? <Spinner data-icon="inline-start" /> : null}
							Remove key
						</Button>
					</div>
				</FieldGroup>
			</form>
			<AlertDialog
				open={confirmation !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmation(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirmation === "remove"
								? `Remove the ${label} key?`
								: `${status.configured ? "Replace" : "Save"} the ${label} key?`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmation === "remove"
								? "Existing sessions that use this key stop on their next model step. Switch the selected model or use Gateway first. CRM records and conversation history stay intact."
								: "The server encrypts this key. New model steps use the saved key, including existing sessions. Saving does not test the connection or send a prompt."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant={confirmation === "remove" ? "destructive" : "default"}
							onClick={() => {
								if (confirmation === "remove") remove.mutate({ provider });
								else save.mutate({ provider, apiKey: draft.trim() });
							}}
						>
							{confirmation === "remove" ? "Remove key" : "Save key"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

export function AiProviders() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const modeId = useId();
	const [nextMode, setNextMode] = useState<Mode | null>(null);
	const settings = useQuery(trpc.settings.aiProviders.queryOptions());
	const saveMode = useMutation(
		trpc.settings.setAiProviderMode.mutationOptions({
			onSuccess: async () => {
				await cache.settings();
				toast.success("AI provider mode saved for new sessions.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (settings.isError) {
		return (
			<Alert variant="warning">
				<AlertTitle>AI provider settings are unavailable</AlertTitle>
				<AlertDescription>{settings.error.message}</AlertDescription>
			</Alert>
		);
	}
	if (!settings.data) return null;
	const { mode, encryptionConfigured, openai, anthropic } = settings.data;
	const directAvailable =
		encryptionConfigured && (openai.configured || anthropic.configured);

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>AI providers</CardTitle>
					<CardDescription>
						Use Vercel AI Gateway, or connect your own OpenAI and Anthropic
						keys. You can save either key or both keys.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup>
						<Field data-disabled={saveMode.isPending}>
							<FieldTitle id={modeId}>Connection mode</FieldTitle>
							<ToggleGroup
								type="single"
								variant="outline"
								value={mode}
								aria-labelledby={modeId}
								disabled={saveMode.isPending}
								onValueChange={(value) => {
									if (
										value !== mode &&
										(value === "gateway" || value === "direct")
									) {
										setNextMode(value);
									}
								}}
							>
								<ToggleGroupItem value="gateway">
									Vercel AI Gateway
								</ToggleGroupItem>
								<ToggleGroupItem value="direct" disabled={!directAvailable}>
									My API keys
								</ToggleGroupItem>
							</ToggleGroup>
							<FieldDescription>
								Mode changes apply to new sessions. Model changes apply to new
								research and builder sessions. Existing sessions keep their
								provider and model. CRM records and history stay intact.
							</FieldDescription>
							<FieldDescription>
								New team-agent runs use the saved version’s model in the
								selected mode. Incompatible versions need a new model/version
								before running.
							</FieldDescription>
							{directAvailable ? null : (
								<FieldDescription>
									Save a provider key to enable My API keys.
								</FieldDescription>
							)}
						</Field>
						{encryptionConfigured ? null : (
							<Alert variant="warning">
								<AlertTitle>Secure key storage is not configured</AlertTitle>
								<AlertDescription>
									Set AI_PROVIDER_ENCRYPTION_KEY on the API and agent servers to
									enable your own keys. Gateway remains available.
								</AlertDescription>
							</Alert>
						)}
						<Separator />
						<ProviderKey
							provider="openai"
							label="OpenAI"
							status={openai}
							encryptionConfigured={encryptionConfigured}
						/>
						<ProviderKey
							provider="anthropic"
							label="Anthropic"
							status={anthropic}
							encryptionConfigured={encryptionConfigured}
						/>
						<FieldDescription>
							Test connection contacts the provider's model-list endpoint only
							after you click. It sends no CRM data or generation request. It
							does not verify model billing or generation access.
						</FieldDescription>
					</FieldGroup>
				</CardContent>
			</Card>
			<AgentModel mode={mode} disabled={saveMode.isPending} />
			<AlertDialog
				open={nextMode !== null}
				onOpenChange={(open) => {
					if (!open) setNextMode(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Change AI provider mode?</AlertDialogTitle>
						<AlertDialogDescription>
							{nextMode === "direct"
								? "New sessions use your provider keys and a supported model from a configured provider. Provider usage charges apply."
								: "New sessions use Vercel AI Gateway and the saved Gateway model. Gateway authentication must be configured on the agent."}{" "}
							Existing sessions keep their provider and model. This does not
							delete keys, records, or history.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (nextMode) saveMode.mutate({ mode: nextMode });
							}}
						>
							Change mode
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
