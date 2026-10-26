import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const health = await fetch("http://127.0.0.1:3001/health");
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { status: "ok", database: "up" });

const settings = await fetch(
	"http://127.0.0.1:3001/api/trpc/settings.aiProviders",
);
assert.equal(
	settings.status,
	401,
	"Anonymous users must not read provider settings.",
);

const page = await fetch("http://app:3000/sign-in");
assert.equal(page.status, 200);
const root = await fetch("http://app:3000/", { redirect: "manual" });
assert.ok([302, 303, 307, 308].includes(root.status));
assert.ok(root.headers.get("location")?.includes("/sign-in"));

for (const kind of ["database", "auth", "bridge", "provider", "chat"]) {
	const path = `/run/crm-secrets/${kind}/value`;
	const value = (await readFile(path, "utf8")).trim();
	assert.ok(value.length >= 44);
	assert.equal((await stat(path)).mode & 0o777, 0o400);
	assert.equal((await stat(`/run/crm-secrets/${kind}`)).mode & 0o777, 0o700);
}

console.log(
	"Staging health, anonymous denial, redirects, and secret-file permissions pass.",
);
