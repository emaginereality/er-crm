import { resolve } from "node:path";

const bundle = await Bun.build({
	entrypoints: [resolve(import.meta.dir, "fixtures/ai-providers.tsx")],
	target: "browser",
	define: { "process.env.NODE_ENV": JSON.stringify("test") },
});
if (!bundle.success)
	throw new Error("The browser test fixture failed to build.");
const javascript = bundle.outputs.find(
	(output) => output.kind === "entry-point",
);
if (!javascript) throw new Error("The browser test bundle is missing.");

Bun.serve({
	hostname: "127.0.0.1",
	port: 4176,
	fetch(request) {
		const pathname = new URL(request.url).pathname;
		if (pathname === "/fixture.js") {
			return new Response(javascript, {
				headers: { "content-type": "text/javascript" },
			});
		}
		if (pathname === "/") {
			return new Response(
				'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AI provider component test</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
				{ headers: { "content-type": "text/html" } },
			);
		}
		return new Response("Not found", { status: 404 });
	},
});
