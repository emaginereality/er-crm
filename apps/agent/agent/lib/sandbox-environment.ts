import "@crm/env/load";

import { DefaultSandbox } from "eve/sandbox";
import { DockerSandbox } from "eve/sandbox/docker";
import { denySandboxNetwork } from "./sandbox-network";

export function configuredSandbox(provider = process.env.CRM_SANDBOX_PROVIDER) {
	if (provider === "docker") {
		const environment = DockerSandbox.environment();
		return {
			environment,
			open: () => environment.open({ networkPolicy: "deny-all" }),
		};
	}

	if (provider !== undefined && provider !== "") {
		throw new Error("CRM_SANDBOX_PROVIDER must be docker or unset.");
	}

	const environment = DefaultSandbox.environment({
		vercel: { networkPolicy: "deny-all" },
	});
	return {
		environment,
		open: async () => denySandboxNetwork(await environment.open()),
	};
}
