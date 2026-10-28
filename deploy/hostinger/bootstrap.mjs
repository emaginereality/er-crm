import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const secretFormats = {
	database: /^[a-f0-9]{64}$/,
	auth: /^[A-Za-z0-9+/]{43}=$/,
	bridge: /^[A-Za-z0-9+/]{43}=$/,
	provider: /^[A-Za-z0-9+/]{43}=$/,
	chat: /^[A-Za-z0-9+/]{43}=$/,
};

export async function initializeSecrets(
	root,
	generate = (kind) =>
		randomBytes(32).toString(kind === "database" ? "hex" : "base64"),
) {
	for (const [kind, format] of Object.entries(secretFormats)) {
		const directory = join(root, kind);
		const path = join(directory, "value");
		await chmod(directory, 0o700);
		try {
			const existing = (await readFile(path, "utf8")).trim();
			if (!format.test(existing))
				throw new Error(`Invalid ${kind} secret file.`);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			const value = generate(kind);
			if (!format.test(value))
				throw new Error(`Invalid generated ${kind} secret.`);
			await writeFile(path, `${value}\n`, { flag: "wx", mode: 0o400 });
		}
		await chmod(path, 0o400);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await initializeSecrets("/run/crm-secrets");
	console.log("Staging secret files are ready. Existing values are unchanged.");
}
