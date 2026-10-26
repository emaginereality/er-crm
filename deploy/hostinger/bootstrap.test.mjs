import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initializeSecrets, secretFormats } from "./bootstrap.mjs";

const fixture = (kind) =>
	kind === "database" ? "a".repeat(64) : `${"A".repeat(43)}=`;

async function withSecretDirectories(run) {
	const root = await mkdtemp(join(tmpdir(), "crm-staging-contract-"));
	try {
		for (const kind of Object.keys(secretFormats))
			await mkdir(join(root, kind));
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("initialization writes private files and does not rotate existing values", async () => {
	await withSecretDirectories(async (root) => {
		await initializeSecrets(root, fixture);
		await initializeSecrets(root, () => {
			throw new Error("Unexpected rotation.");
		});
		for (const kind of Object.keys(secretFormats)) {
			const path = join(root, kind, "value");
			assert.equal((await readFile(path, "utf8")).trim(), fixture(kind));
			assert.equal((await stat(path)).mode & 0o777, 0o400);
			assert.equal((await stat(join(root, kind))).mode & 0o777, 0o700);
		}
	});
});

test("invalid stored values stop initialization without replacement", async () => {
	await withSecretDirectories(async (root) => {
		const path = join(root, "database", "value");
		await writeFile(path, "invalid");
		await assert.rejects(
			initializeSecrets(root, fixture),
			/Invalid database secret file/,
		);
		assert.equal(await readFile(path, "utf8"), "invalid");
	});
});

test("invalid generator output never becomes a secret file", async () => {
	await withSecretDirectories(async (root) => {
		await assert.rejects(
			initializeSecrets(root, () => "invalid"),
			/Invalid generated database secret/,
		);
		await assert.rejects(readFile(join(root, "database", "value")), {
			code: "ENOENT",
		});
	});
});
