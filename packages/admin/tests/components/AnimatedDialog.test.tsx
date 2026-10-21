import { Dialog } from "@cloudflare/kumo";
import * as React from "react";
import { flushSync } from "react-dom";
import { afterEach, expect, it } from "vitest";
import { cdp } from "vitest/browser";

import "../../dist/styles.css";
import { AnimatedDialog } from "../../src/components/AnimatedDialog.js";
import { heightAnimation, nextFrames, pauseHalfway } from "../utils/height-animation.js";
import { render } from "../utils/render.tsx";

afterEach(async () => {
	await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

function ResizingDialog({
	extra,
	open = true,
	style,
}: {
	extra: number;
	open?: boolean;
	style?: React.CSSProperties;
}) {
	return (
		<Dialog.Root open={open}>
			<AnimatedDialog className="overflow-y-auto p-6" style={style}>
				<Dialog.Title>Resizing dialog</Dialog.Title>
				<div style={{ height: 80 + extra }} />
			</AnimatedDialog>
		</Dialog.Root>
	);
}

function depth(element: Element): number {
	let count = 0;
	for (let node: Element | null = element; node; node = node.parentElement) count++;
	return count;
}

async function renderOpened(ui: React.ReactElement) {
	const screen = await render(ui);
	const popup = screen.getByRole("dialog", { name: "Resizing dialog" }).element();
	await nextFrames();
	const openingAnimation = heightAnimation(popup);
	await expect.poll(() => popup.getAnimations().length).toBe(0);
	return { screen, popup, openingAnimation, height: () => popup.getBoundingClientRect().height };
}

it("animates content growth from the old height without animating the opening", async () => {
	const { screen, popup, openingAnimation, height } = await renderOpened(
		<ResizingDialog extra={0} />,
	);
	expect(openingAnimation).toBeUndefined();
	const startHeight = height();

	await screen.rerender(<ResizingDialog extra={120} />);
	await expect.poll(() => heightAnimation(popup)).toBeDefined();
	const animation = heightAnimation(popup)!;
	pauseHalfway(animation);
	expect(height()).toBeGreaterThan(startHeight);
	expect(height()).toBeLessThan(startHeight + 120);
	expect(getComputedStyle(popup).overflowY).toBe("hidden");

	animation.finish();
	expect(height()).toBe(startHeight + 120);
	expect(getComputedStyle(popup).overflowY).toBe("auto");
});

it("restarts from the in-between height when the content changes mid-animation", async () => {
	const { screen, popup, height } = await renderOpened(<ResizingDialog extra={0} />);
	const startHeight = height();

	await screen.rerender(<ResizingDialog extra={120} />);
	await expect.poll(() => heightAnimation(popup)).toBeDefined();
	const growing = heightAnimation(popup)!;
	pauseHalfway(growing);
	const interruptedHeight = height();

	await screen.rerender(<ResizingDialog extra={0} />);
	await expect.poll(() => heightAnimation(popup)).not.toBe(growing);
	const shrinking = heightAnimation(popup)!;
	expect(growing.playState).toBe("idle");
	shrinking.pause();
	shrinking.currentTime = 0;
	expect(height()).toBeCloseTo(interruptedHeight, 1);

	shrinking.finish();
	expect(height()).toBe(startHeight);
});

it("resizes at once when reduced motion is preferred", async () => {
	await cdp().send("Emulation.setEmulatedMedia", {
		features: [{ name: "prefers-reduced-motion", value: "reduce" }],
	});
	const { screen, popup, height } = await renderOpened(<ResizingDialog extra={0} />);
	const startHeight = height();

	await screen.rerender(<ResizingDialog extra={120} />);
	await nextFrames();

	expect(heightAnimation(popup)).toBeUndefined();
	expect(height()).toBe(startHeight + 120);
});

it("animates to the max height and leaves the overflow scrollable", async () => {
	const style = { maxHeight: 240 };
	const { screen, popup, height } = await renderOpened(<ResizingDialog extra={0} style={style} />);
	const startHeight = height();
	expect(startHeight).toBeLessThan(240);

	await screen.rerender(<ResizingDialog extra={400} style={style} />);
	await expect.poll(() => heightAnimation(popup)).toBeDefined();
	const animation = heightAnimation(popup)!;
	pauseHalfway(animation);
	expect(height()).toBeGreaterThan(startHeight);
	expect(height()).toBeLessThan(240);
	expect(getComputedStyle(popup).overflowY).toBe("auto");

	animation.finish();
	expect(height()).toBe(240);
	popup.scrollTop = popup.scrollHeight;
	expect(popup.scrollTop).toBeGreaterThan(0);
});

it("starts from the height a window resize left the dialog at", async () => {
	const { screen, popup, height } = await renderOpened(
		<ResizingDialog extra={300} style={{ maxHeight: 400 }} />,
	);
	expect(height()).toBe(400);

	await screen.rerender(<ResizingDialog extra={300} style={{ maxHeight: 600 }} />);
	window.dispatchEvent(new Event("resize"));
	const resizedHeight = height();
	expect(resizedHeight).toBeGreaterThan(400);

	await screen.rerender(<ResizingDialog extra={350} style={{ maxHeight: 600 }} />);
	await expect.poll(() => heightAnimation(popup)).toBeDefined();
	const animation = heightAnimation(popup)!;
	animation.pause();
	animation.currentTime = 0;
	expect(height()).toBeCloseTo(resizedHeight, 1);
});

it("does not animate content that changes while the dialog closes", async () => {
	const { screen, popup } = await renderOpened(<ResizingDialog extra={0} />);

	await screen.rerender(<ResizingDialog extra={120} open={false} />);
	await nextFrames();

	expect(popup.isConnected).toBe(true);
	expect(heightAnimation(popup)).toBeUndefined();
});

it("leaves no resize notification undelivered when another observer closes the dialog", async () => {
	let close!: () => void;
	function ClosingDialog() {
		const [closed, setClosed] = React.useState(false);
		close = () => flushSync(() => setClosed(true));
		return <ResizingDialog extra={closed ? 120 : 0} open={!closed} />;
	}
	const { popup } = await renderOpened(<ClosingDialog />);
	const errors: string[] = [];
	const recordError = (event: ErrorEvent) => errors.push(event.message);
	window.addEventListener("error", recordError);
	// Like a toast that commits React updates from its own ResizeObserver callback, nested deeper
	// than the dialog content.
	const toast = document.createElement("div");
	let toastContent = toast;
	for (let level = 0; level < 4; level++) {
		toastContent = toastContent.appendChild(document.createElement("div"));
	}
	document.body.append(toast);
	expect(depth(toastContent)).toBeGreaterThan(depth(popup.firstElementChild!));
	let toastResized = false;
	const toastObserver = new ResizeObserver(() => {
		toastResized = true;
		toastObserver.disconnect();
		close();
	});
	toastObserver.observe(toastContent);

	try {
		await nextFrames(3);
		expect(toastResized).toBe(true);
		expect(errors).toEqual([]);
	} finally {
		window.removeEventListener("error", recordError);
		toast.remove();
	}
});
