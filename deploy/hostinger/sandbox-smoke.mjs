import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runDocker, verifyRootlessDaemon } from "./sandbox-daemon.mjs";

await verifyRootlessDaemon();
const require = createRequire("/srv/crm/apps/agent/package.json");
const eveEntry = require.resolve("eve");
const providerPath = resolve(
	dirname(eveEntry),
	"execution/sandbox/bindings/docker.js",
);
const { createDockerSandboxProvider } = await import(
	pathToFileURL(providerPath)
);
const prepared = JSON.parse(
	await readFile(
		"/srv/crm/apps/agent/.output/.eve/compile/sandbox-prepared-artifacts.json",
		"utf8",
	),
);
assert.equal(prepared.entries.length, 3);
assert.deepEqual(prepared.entries.map((entry) => entry.nodeId).sort(), [
	"__root__",
	"subagents/agent_builder",
	"subagents/agent_runner",
]);
for (const entry of prepared.entries) {
	assert.equal(entry.providerName, "docker");
	assert.match(entry.artifact.imageReference, /^eve-sandbox-template:/);
}
const images = [
	...new Set(prepared.entries.map((entry) => entry.artifact.imageReference)),
];
for (const [index, imageReference] of images.entries()) {
	const provider = createDockerSandboxProvider();
	const context = {
		session: { id: `staging-isolation-${Date.now()}-${index}` },
	};
	const artifact = { imageReference };
	const opened = await provider.start(
		context,
		{ networkPolicy: "deny-all" },
		artifact,
	);
	try {
		const { stdout: inspected } = await runDocker("docker", [
			"inspect",
			opened.state.containerName,
		]);
		const [container] = JSON.parse(inspected);
		assert.equal(container.HostConfig.NetworkMode, "none");
		assert.equal(container.HostConfig.Privileged, false);
		assert.equal(container.Mounts.length, 0);
		assert.ok(
			!container.HostConfig.PortBindings ||
				Object.keys(container.HostConfig.PortBindings).length === 0,
		);
		for (const value of container.Config.Env) {
			assert.ok(
				!/^(DATABASE_URL|BETTER_AUTH_SECRET|AGENT_BRIDGE_SECRET|AI_PROVIDER_ENCRYPTION_KEY|CHAT_EVENT_ENCRYPTION_KEY|GOOGLE_CLIENT_SECRET|DOCKER_HOST)=/.test(
					value,
				),
			);
		}
		const written = await opened.handle.sandbox.run({
			command:
				"test ! -e /run/crm-secrets && test ! -S /var/run/docker.sock && test ! -S /run/crm-sandbox/docker.sock && printf staging-only > /workspace/isolation-check",
		});
		assert.equal(written.exitCode, 0);
		await opened.handle.onSessionStop();
		const resumed = await provider.resume(context, artifact, opened.state);
		const persisted = await resumed.sandbox.run({
			command: 'test "$(cat /workspace/isolation-check)" = staging-only',
		});
		assert.equal(persisted.exitCode, 0);
	} finally {
		await opened.handle.onSessionDelete();
	}
}
const health = await fetch("http://127.0.0.1:2000/eve/v1/health");
assert.equal(health.status, 200);
const unauthorized = await fetch("http://agent:2000/eve/v1/session", {
	method: "POST",
});
assert.equal(unauthorized.status, 401);
const bridge = await fetch(
	"http://agent:2000/internal/crm/verify-ai-provider",
	{
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider: "openai" }),
	},
);
assert.equal(bridge.status, 401);
console.log(
	"Agent health, anonymous denial, three prepared agent environments, isolated sandbox execution, and sandbox resume pass. No model call runs.",
);
