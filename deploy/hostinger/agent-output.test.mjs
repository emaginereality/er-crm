import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishAgentOutput } from "./agent-output.mjs";

async function withOutput(run) {
	const root = await mkdtemp(join(tmpdir(), "crm-agent-output-"));
	const source = join(root, "source");
	const destination = join(root, "destination");
	try {
		await mkdir(join(source, "server"), { recursive: true });
		await mkdir(join(source, ".eve/compile"), { recursive: true });
		await mkdir(destination);
		await writeFile(join(source, "server/index.mjs"), "synthetic-output");
		await writeFile(
			join(source, ".eve/compile/sandbox-prepared-artifacts.json"),
			"{}",
		);
		await run(source, destination);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("completed output publishes and a matching source reuses it without mutation", async () => {
	await withOutput(async (source, destination) => {
		await publishAgentOutput(source, destination, "a".repeat(40));
		await writeFile(join(destination, "stale"), "old");
		await writeFile(join(source, "server/index.mjs"), "rebuilt-output");
		await publishAgentOutput(source, destination, "a".repeat(40));
		assert.equal(
			await readFile(join(destination, "server/index.mjs"), "utf8"),
			"synthetic-output",
		);
		assert.equal(await readFile(join(destination, "stale"), "utf8"), "old");
	});
});

test("unknown output contents remain untouched", async () => {
	await withOutput(async (source, destination) => {
		await writeFile(join(destination, "unknown"), "preserve");
		await assert.rejects(
			publishAgentOutput(source, destination, "a".repeat(40)),
			/unknown or incomplete contents/,
		);
		assert.equal(
			await readFile(join(destination, "unknown"), "utf8"),
			"preserve",
		);
	});
});

test("different source and incomplete builds preserve published output", async () => {
	await withOutput(async (source, destination) => {
		await publishAgentOutput(source, destination, "a".repeat(40));
		await assert.rejects(
			publishAgentOutput(source, destination, "b".repeat(40)),
			/another source/,
		);
		await rm(join(source, "server/index.mjs"));
		await assert.rejects(
			publishAgentOutput(source, destination, "a".repeat(40)),
			{ code: "ENOENT" },
		);
		assert.equal(
			await readFile(join(destination, "server/index.mjs"), "utf8"),
			"synthetic-output",
		);
	});
});

test("a damaged completed volume is rejected without repair or deletion", async () => {
	await withOutput(async (source, destination) => {
		await publishAgentOutput(source, destination, "a".repeat(40));
		await rm(join(destination, "server/index.mjs"));
		await writeFile(join(destination, "preserve"), "retained");
		await assert.rejects(
			publishAgentOutput(source, destination, "a".repeat(40)),
			{ code: "ENOENT" },
		);
		assert.equal(
			await readFile(join(destination, "preserve"), "utf8"),
			"retained",
		);
		await assert.rejects(readFile(join(destination, "server/index.mjs")), {
			code: "ENOENT",
		});
	});
});
