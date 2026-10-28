import "@crm/env/load";

export function backgroundDispatchPaused(
	value = process.env.CRM_BACKGROUND_DISPATCH_PAUSED,
): boolean {
	if (value === "1") return true;
	if (value === undefined || value === "" || value === "0") return false;
	throw new Error("CRM_BACKGROUND_DISPATCH_PAUSED must be 1, 0, or unset.");
}

export function skipPausedBackgroundDispatch(): boolean {
	if (!backgroundDispatchPaused()) return false;

	console.info(
		"[agent] Background dispatch is paused. Queued work remains pending.",
	);
	return true;
}
