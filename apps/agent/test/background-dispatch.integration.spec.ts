import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { db } from "@crm/db";
import { MAX_ATTEMPTS } from "@crm/db/agent-tasks";
import { agentManifest } from "@crm/validation/agent-manifest";
import crm from "../agent/channels/crm";
import { APP_AUTH } from "../agent/lib/app-auth";
import { backgroundDispatchPaused } from "../agent/lib/background-dispatch";
import dispatch from "../agent/schedules/dispatch";

const originalPause = process.env.CRM_BACKGROUND_DISPATCH_PAUSED;
const originalSecret = process.env.AGENT_BRIDGE_SECRET;
const secret = "test-background-dispatch-secret";
const paths = ["dispatch", "builder-dispatch", "agent-dispatch"] as const;

afterEach(() => {
	if (originalPause === undefined)
		delete process.env.CRM_BACKGROUND_DISPATCH_PAUSED;
	else process.env.CRM_BACKGROUND_DISPATCH_PAUSED = originalPause;
	if (originalSecret === undefined) delete process.env.AGENT_BRIDGE_SECRET;
	else process.env.AGENT_BRIDGE_SECRET = originalSecret;
	mock.restore();
});

function route(path: string) {
	const found = crm.routes.find(
		(candidate) => candidate.path === `/internal/crm/${path}`,
	);
	if (!found || found.transport === "websocket") {
		throw new Error(`Missing HTTP route: ${path}`);
	}
	return found;
}

function request(path: string, authorized = true) {
	return new Request(`https://agent.example.test/internal/crm/${path}`, {
		method: path === "dispatch-health" ? "GET" : "POST",
		headers: authorized ? { authorization: `Bearer ${secret}` } : {},
	});
}

describe("background dispatch configuration", () => {
	it.each([undefined, "", "0"])("defaults to active for %s", (value) => {
		if (value === undefined) delete process.env.CRM_BACKGROUND_DISPATCH_PAUSED;
		else process.env.CRM_BACKGROUND_DISPATCH_PAUSED = value;
		expect(backgroundDispatchPaused()).toBe(false);
	});

	it("pauses only for the explicit value 1", () => {
		expect(backgroundDispatchPaused("1")).toBe(true);
	});

	it.each(["true", "false", "yes", "2", " 1 ", " "])(
		"rejects invalid configured value %s",
		(value) => {
			expect(() => backgroundDispatchPaused(value)).toThrow(
				"CRM_BACKGROUND_DISPATCH_PAUSED must be 1, 0, or unset.",
			);
		},
	);
});

describe("paused background entry points", () => {
	const suffix = crypto.randomUUID();
	const userId = `dispatch-pause-${suffix}`;
	const taskIds = [`${suffix}-queued`, `${suffix}-exhausted`];
	let agentId = "";
	let versionId = "";
	let conversationId = "";
	let submissionId = "";
	let runId = "";
	let triggerId = "";
	let queued: Awaited<ReturnType<typeof snapshot>>;

	async function snapshot() {
		return Promise.all([
			db.agentTask.findMany({
				where: { id: { in: taskIds } },
				orderBy: { id: "asc" },
			}),
			db.agentConversationSubmission.findUnique({
				where: { id: submissionId },
			}),
			db.agentRun.findMany({ where: { agentId }, orderBy: { id: "asc" } }),
			db.agentTrigger.findUnique({ where: { id: triggerId } }),
		]);
	}

	beforeAll(async () => {
		await db.user.create({
			data: {
				id: userId,
				name: "Dispatch Pause",
				email: `${userId}@example.test`,
			},
		});
		const agent = await db.agentDefinition.create({
			data: { name: "Dispatch Pause", status: "LIVE", createdById: userId },
		});
		agentId = agent.id;
		const version = await db.agentVersion.create({
			data: {
				agentId,
				number: 1,
				status: "DEPLOYED",
				instructions: "Summarize synthetic test records.",
				manifest: agentManifest.parse({
					actions: [
						{ type: "run.summary", provider: "crm", summary: "Summarize" },
					],
					triggers: [
						{ type: "MANUAL", name: "Manual", summary: "Manual", config: {} },
						{
							type: "SCHEDULE",
							name: "Synthetic schedule",
							summary: "Synthetic scheduled run",
							config: {
								intervalMinutes: 60,
								nextRunAt: new Date(Date.now() - 60_000).toISOString(),
							},
						},
					],
					dataScope: {
						mode: "WORKSPACE",
						summary: "Synthetic records",
						resources: [],
					},
				}),
				modelId: "zai/glm-5.2-fast",
				sandboxPolicy: {},
				createdById: userId,
			},
		});
		versionId = version.id;
		await db.agentDefinition.update({
			where: { id: agentId },
			data: { currentVersionId: versionId },
		});
		const trigger = await db.agentTrigger.create({
			data: {
				agentId,
				versionId,
				type: "SCHEDULE",
				name: "Synthetic schedule",
				config: { intervalMinutes: 60 },
				createdById: userId,
				enabled: true,
				nextRunAt: new Date(Date.now() - 60_000),
			},
		});
		triggerId = trigger.id;
		const run = await db.agentRun.create({
			data: {
				agentId,
				versionId,
				triggerType: "MANUAL",
				idempotencyKey: suffix,
				correlationId: suffix,
			},
		});
		runId = run.id;
		const conversation = await db.agentConversation.create({
			data: { userId, kind: "BUILDER" },
		});
		conversationId = conversation.id;
		const submission = await db.agentConversationSubmission.create({
			data: {
				conversationId,
				submittedById: userId,
				clientRequestId: suffix,
				message: { text: "Synthetic queued builder message" },
			},
		});
		submissionId = submission.id;
		await db.agentTask.createMany({
			data: taskIds.map((id, index) => ({
				id,
				kind: "test-background-pause",
				reason: "Synthetic queued task",
				dueAt: new Date(Date.now() - 60 * 60_000),
				attempts: index === 0 ? 0 : MAX_ATTEMPTS,
			})),
		});
		queued = await snapshot();
	});

	beforeEach(() => {
		process.env.CRM_BACKGROUND_DISPATCH_PAUSED = "1";
		process.env.AGENT_BRIDGE_SECRET = secret;
		spyOn(console, "info").mockImplementation(() => {});
	});

	afterEach(async () => {
		expect(await snapshot()).toEqual(queued);
	});

	afterAll(async () => {
		await db.agentTask.deleteMany({ where: { id: { in: taskIds } } });
		await db.agentConversation.deleteMany({ where: { id: conversationId } });
		await db.agentRun.deleteMany({ where: { agentId } });
		await db.agentTrigger.deleteMany({ where: { id: triggerId } });
		await db.agentDefinition.updateMany({
			where: { id: agentId },
			data: { currentVersionId: null },
		});
		await db.agentVersion.deleteMany({ where: { id: versionId } });
		await db.agentDefinition.deleteMany({ where: { id: agentId } });
		await db.user.deleteMany({ where: { id: userId } });
	});

	it.each(paths)("does not start work from %s", async (path) => {
		const from = mock(() => {
			throw new Error("Unexpected dispatch");
		});
		const waitUntil = mock(() => {
			throw new Error("Unexpected background work");
		});
		const response = await route(path).handler(request(path), {
			from,
			waitUntil,
		} as never);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ paused: true, dispatched: false });
		expect(from).not.toHaveBeenCalled();
		expect(waitUntil).not.toHaveBeenCalled();
		expect(console.info).toHaveBeenCalledWith(
			"[agent] Background dispatch is paused. Queued work remains pending.",
		);
	});

	it.each([...paths, "dispatch-health"])(
		"authenticates %s before reading pause configuration",
		async (path) => {
			process.env.CRM_BACKGROUND_DISPATCH_PAUSED = "invalid";
			const response = await route(path).handler(
				request(path, false),
				{} as never,
			);
			expect(response.status).toBe(401);
			expect(console.info).not.toHaveBeenCalled();
		},
	);

	it("does not start scheduled work or change queued rows", async () => {
		const to = mock(() => {
			throw new Error("Unexpected dispatch");
		});
		const waitUntil = mock(() => {
			throw new Error("Unexpected background work");
		});
		await dispatch.run({ to, waitUntil, appAuth: APP_AUTH });
		expect(to).not.toHaveBeenCalled();
		expect(waitUntil).not.toHaveBeenCalled();
	});

	it.each(paths)(
		"fails closed for invalid pause configuration on %s",
		async (path) => {
			process.env.CRM_BACKGROUND_DISPATCH_PAUSED = "invalid";
			await expect(
				route(path).handler(request(path), {} as never),
			).rejects.toThrow(
				"CRM_BACKGROUND_DISPATCH_PAUSED must be 1, 0, or unset.",
			);
		},
	);

	it("fails closed for invalid scheduled pause configuration", async () => {
		process.env.CRM_BACKGROUND_DISPATCH_PAUSED = "invalid";
		await expect(dispatch.run({} as never)).rejects.toThrow(
			"CRM_BACKGROUND_DISPATCH_PAUSED must be 1, 0, or unset.",
		);
	});

	it.each(["taskId", "builderSubmissionId", "runId"] as const)(
		"blocks the queued %s channel handoff",
		async (targetKey) => {
			if (!crm.receive) throw new Error("Missing CRM receive handler");
			const targets = {
				taskId: taskIds[0],
				builderSubmissionId: submissionId,
				runId,
			};
			const from = mock(() => {
				throw new Error("Unexpected dispatch");
			});
			await expect(
				crm.receive(
					{
						target: { [targetKey]: targets[targetKey] },
						message: "Synthetic queued work",
						auth: APP_AUTH,
					},
					{ from } as never,
				),
			).rejects.toThrow("Background dispatch is paused.");
			expect(from).not.toHaveBeenCalled();
		},
	);

	it.each(["taskId", "builderSubmissionId", "runId"] as const)(
		"authenticates the queued %s handoff before the pause guard",
		async (targetKey) => {
			if (!crm.receive) throw new Error("Missing CRM receive handler");
			process.env.CRM_BACKGROUND_DISPATCH_PAUSED = "invalid";
			await expect(
				crm.receive(
					{
						target: { [targetKey]: "synthetic-id" },
						message: "Synthetic queued work",
						auth: null,
					},
					{} as never,
				),
			).rejects.toThrow(
				"Internal agent dispatch requires Eve app authentication.",
			);
		},
	);

	it("reports an intentional pause without treating its backlog as a failed health check", async () => {
		const response = await route("dispatch-health").handler(
			request("dispatch-health"),
			{} as never,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ok: true,
			paused: true,
			wedged: false,
		});
	});

	it("still reports overdue work as unhealthy when the pause is disabled", async () => {
		process.env.CRM_BACKGROUND_DISPATCH_PAUSED = "0";
		const response = await route("dispatch-health").handler(
			request("dispatch-health"),
			{} as never,
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ ok: false, paused: false });
	});

	it("keeps ad-hoc interactive messages available while paused", async () => {
		if (!crm.receive) throw new Error("Missing CRM receive handler");
		const session = { id: "synthetic-interactive-session" };
		const send = mock(async () => session);
		const from = mock(() => ({ send }));
		const auth = {
			authenticator: "crm-app",
			principalId: userId,
			principalType: "user",
		};
		expect(
			await crm.receive({ target: {}, message: "Hello", auth }, {
				from,
			} as never),
		).toBe(session);
		expect(send).toHaveBeenCalledWith("Hello", { auth });
	});
});
