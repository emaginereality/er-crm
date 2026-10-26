import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { fileURLToPath } from "node:url";
import { DefaultSandbox } from "eve/sandbox";
import { configuredSandbox } from "../agent/lib/sandbox-environment";

afterEach(() => {
	mock.restore();
});

describe("configured sandbox", () => {
	it("preserves the automatic provider for empty configuration", () => {
		const expected = DefaultSandbox.environment({
			vercel: { networkPolicy: "deny-all" },
		});
		expect(configuredSandbox("").environment.provider).toBe(expected.provider);
	});

	it("selects Docker explicitly", () => {
		expect(configuredSandbox("docker").environment.provider).toBe("docker");
	});

	it.each(["", "docker"])(
		"exports the configured environment for all agents with provider %s",
		(provider) => {
			const result = Bun.spawnSync({
				cmd: [
					process.execPath,
					"-e",
					`import { environment as root } from "./agent/sandbox/sandbox.ts";
import { environment as builder } from "./agent/subagents/agent_builder/sandbox/sandbox.ts";
import { environment as runner } from "./agent/subagents/agent_runner/sandbox/sandbox.ts";
console.log(JSON.stringify([root.provider, builder.provider, runner.provider]));`,
				],
				cwd: fileURLToPath(new URL("../", import.meta.url)),
				env: { ...process.env, CRM_SANDBOX_PROVIDER: provider },
			});
			const expected = configuredSandbox(provider).environment.provider;

			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.toString())).toEqual([
				expected,
				expected,
				expected,
			]);
		},
	);

	it.each(["default", "just-bash", "Docker", " docker ", " "])(
		"rejects unsupported configured provider %s",
		(provider) => {
			expect(() => configuredSandbox(provider)).toThrow(
				"CRM_SANDBOX_PROVIDER must be docker or unset.",
			);
		},
	);

	it("starts Docker with deny-all rather than applying policy afterward", async () => {
		const sandbox = configuredSandbox("docker");
		const unavailable = new Error("The isolated Docker daemon is unavailable.");
		const open = spyOn(sandbox.environment, "open").mockRejectedValue(
			unavailable,
		);

		await expect(sandbox.open()).rejects.toBe(unavailable);
		expect(open).toHaveBeenCalledTimes(1);
		expect(open).toHaveBeenCalledWith({ networkPolicy: "deny-all" });
		expect(sandbox.environment.provider).toBe("docker");
	});

	it("retains the automatic provider's post-open network restriction", async () => {
		const sandbox = configuredSandbox("");
		const setNetworkPolicy = mock(async () => {});
		const session = { setNetworkPolicy } as unknown as Awaited<
			ReturnType<typeof sandbox.open>
		>;
		const open = spyOn(sandbox.environment, "open").mockResolvedValue(session);

		expect(await sandbox.open()).toBe(session);
		expect(open).toHaveBeenCalledWith();
		expect(setNetworkPolicy).toHaveBeenCalledWith("deny-all");
	});
});
