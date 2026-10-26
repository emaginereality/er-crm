import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runDocker = promisify(execFile);

export async function verifyRootlessDaemon() {
	assert.equal(process.env.CRM_SANDBOX_PROVIDER, "docker");
	assert.equal(process.env.DOCKER_HOST, "unix:///run/crm-sandbox/docker.sock");
	assert.equal(process.getuid(), 1000);
	const { stdout } = await runDocker(
		"docker",
		["info", "--format", "{{json .}}"],
		{
			maxBuffer: 1024 * 1024,
		},
	);
	const info = JSON.parse(stdout);
	assert.ok(info.SecurityOptions.includes("name=rootless"));
	assert.equal(info.CgroupDriver, "systemd");
	assert.equal(info.CgroupVersion, "2");
	return info;
}
