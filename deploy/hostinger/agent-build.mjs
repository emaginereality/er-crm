import { spawn } from "node:child_process";
import { prepareBuildOutput, publishAgentOutput } from "./agent-output.mjs";
import { verifyRootlessDaemon } from "./sandbox-daemon.mjs";

await verifyRootlessDaemon();
await prepareBuildOutput("/srv/crm/apps/agent/.output");
process.umask(0o027);
const child = spawn("bun", ["run", "build"], {
	cwd: "/srv/crm/apps/agent",
	env: {
		...process.env,
		NODE_ENV: "production",
		DATABASE_URL: "postgresql://build:build@127.0.0.1:1/build",
		BETTER_AUTH_SECRET: "build-only-placeholder-not-a-runtime-credential",
		ALLOWED_SIGN_IN: "build@example.invalid",
	},
	stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"])
	process.once(signal, () => child.kill(signal));
await new Promise((resolve, reject) => {
	child.once("error", reject);
	child.once("exit", (code) => {
		if (code === 0) resolve();
		else reject(new Error(`The isolated agent build exits with code ${code}.`));
	});
});
await publishAgentOutput(
	"/srv/crm/apps/agent/.output",
	"/run/crm-agent-output",
	process.argv[2],
);
