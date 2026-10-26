import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { secretFormats } from "./bootstrap.mjs";
import { verifyRootlessDaemon } from "./sandbox-daemon.mjs";

const role = process.argv[2];
const commands = {
	agent: {
		executable: "node",
		directory: "apps/agent",
		args: [
			"node_modules/eve/bin/eve.js",
			"start",
			"--host",
			"0.0.0.0",
			"--port",
			"2000",
		],
		secrets: ["auth", "bridge", "provider", "chat"],
	},
	api: {
		directory: "apps/api",
		args: ["dist/main.js"],
		secrets: ["auth", "bridge", "provider", "chat"],
	},
	app: {
		directory: "apps/app",
		args: ["run", "start", "--hostname", "0.0.0.0"],
		secrets: ["auth", "bridge"],
	},
	migrate: {
		directory: "packages/db",
		args: ["run", "db:deploy"],
		secrets: [],
	},
};
const secretNames = {
	auth: "BETTER_AUTH_SECRET",
	bridge: "AGENT_BRIDGE_SECRET",
	provider: "AI_PROVIDER_ENCRYPTION_KEY",
	chat: "CHAT_EVENT_ENCRYPTION_KEY",
};
const command = commands[role];
if (!command) throw new Error("Select app, api, agent, or migrate.");
if (
	role !== "migrate" &&
	!/^[^\s,@]+@[^\s,@]+$/.test(process.env.ALLOWED_SIGN_IN ?? "")
) {
	throw new Error("Staging requires one allowed email address.");
}

async function readSecret(kind) {
	const value = (
		await readFile(`/run/crm-secrets/${kind}/value`, "utf8")
	).trim();
	if (!secretFormats[kind].test(value))
		throw new Error(`Invalid ${kind} secret file.`);
	return value;
}

const environment = {
	...process.env,
	NODE_ENV: "production",
	CRM_TELEMETRY_DISABLED: "1",
	NEXT_TELEMETRY_DISABLED: "1",
	DATABASE_URL: `postgresql://crm:${await readSecret("database")}@postgres:5432/crm_staging?schema=public`,
};
for (const kind of command.secrets)
	environment[secretNames[kind]] = await readSecret(kind);

if (role === "agent") await verifyRootlessDaemon();

const child = spawn(command.executable ?? "bun", command.args, {
	cwd: `/srv/crm/${command.directory}`,
	env: environment,
	stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, () => child.kill(signal));
}
child.once("error", () => {
	console.error("The staging process failed to start.");
	process.exitCode = 1;
});
child.once("exit", (code) => {
	process.exitCode = code ?? 1;
});
