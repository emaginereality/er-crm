import { spawn } from "node:child_process";
import { verifyRootlessDaemon } from "./sandbox-daemon.mjs";

await verifyRootlessDaemon();
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
child.once("error", () => {
	console.error("The isolated agent build failed to start.");
	process.exitCode = 1;
});
child.once("exit", (code) => {
	process.exitCode = code ?? 1;
});
