import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
	cp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";

const requiredArtifacts = [
	"server/index.mjs",
	".eve/compile/sandbox-prepared-artifacts.json",
];

async function validateOutput(root) {
	for (const path of requiredArtifacts)
		assert.ok((await stat(join(root, path))).isFile());
}

export async function publishAgentOutput(source, destination, sourceSha) {
	assert.match(sourceSha ?? "", /^[0-9a-f]{40}$/);
	await validateOutput(source);
	const marker = ".crm-source-sha";
	const entries = await readdir(destination);
	if (entries.length > 0) {
		assert.ok(
			entries.includes(marker),
			"The output volume has unknown or incomplete contents.",
		);
		assert.equal(
			await readFile(join(destination, marker), "utf8"),
			sourceSha,
			"The output volume belongs to another source commit.",
		);
		await validateOutput(destination);
		return;
	}
	const staging = join(destination, `.crm-build-${randomUUID()}`);
	try {
		await cp(source, staging, { recursive: true, preserveTimestamps: true });
		await validateOutput(staging);
		for (const entry of await readdir(staging))
			await rename(join(staging, entry), join(destination, entry));
		await writeFile(join(destination, marker), sourceSha, {
			flag: "wx",
			mode: 0o600,
		});
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}
