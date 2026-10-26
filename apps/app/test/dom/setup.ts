import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLButtonElement",
	"HTMLInputElement",
	"Node",
	"NodeFilter",
	"Element",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"MutationObserver",
	"ResizeObserver",
	"MouseEvent",
	"PointerEvent",
	"FocusEvent",
	"KeyboardEvent",
	"HTMLSelectElement",
	"HTMLTextAreaElement",
	"HTMLFormElement",
	"SVGElement",
] as const) {
	Object.defineProperty(globalThis, key, {
		value: window[key],
		configurable: true,
		writable: true,
	});
}
Object.defineProperties(globalThis, {
	window: { value: window, configurable: true },
	getComputedStyle: {
		value: window.getComputedStyle.bind(window),
		configurable: true,
	},
	requestAnimationFrame: {
		value: window.requestAnimationFrame.bind(window),
		configurable: true,
	},
	cancelAnimationFrame: {
		value: window.cancelAnimationFrame.bind(window),
		configurable: true,
	},
	IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

Object.defineProperty(window, "fetch", {
	value: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
	configurable: true,
});
