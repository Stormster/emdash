import * as React from "react";

const DIALOG_POPUP_SELECTOR = '[role="dialog"], [role="alertdialog"]';
const HEIGHT_ANIMATION_ID = "emdash-dialog-height";
const HEIGHT_ANIMATION_DURATION_MS = 340;
const HEIGHT_ANIMATION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Layout height, unaffected by the scale transform of the dialog's open and close motion. */
function layoutHeight(popup: HTMLElement): number {
	return Number.parseFloat(getComputedStyle(popup).height);
}

function currentHeightAnimation(popup: HTMLElement): Animation | undefined {
	return popup.getAnimations().find((animation) => animation.id === HEIGHT_ANIMATION_ID);
}

function animateHeight(popup: HTMLElement, fromHeight: number, toHeight: number): Animation | null {
	if (Math.abs(toHeight - fromHeight) < 1) return null;
	// A scrollbar may only show mid-resize when the final layout keeps it.
	const clip = popup.scrollHeight <= popup.clientHeight ? { overflow: "hidden" } : {};
	return popup.animate(
		[
			{ height: `${fromHeight}px`, ...clip },
			{ height: `${toHeight}px`, ...clip },
		],
		{
			id: HEIGHT_ANIMATION_ID,
			duration: HEIGHT_ANIMATION_DURATION_MS,
			easing: HEIGHT_ANIMATION_EASING,
		},
	);
}

/**
 * Runs `update` and animates the dialog containing `element` from its previous height to the
 * new one. `update` must apply its DOM changes synchronously, so wrap React state updates in
 * `flushSync`. Returns the running animation, or `null` when nothing animates.
 */
export function transitionDialogHeight(
	element: Element | null,
	update: () => void,
): Animation | null {
	const popup = element?.closest<HTMLElement>(DIALOG_POPUP_SELECTOR);
	if (!popup || prefersReducedMotion()) {
		if (popup) currentHeightAnimation(popup)?.cancel();
		update();
		return null;
	}

	const fromHeight = layoutHeight(popup);
	currentHeightAnimation(popup)?.cancel();
	// Layout effects inside `update` measure the height that paints first, not the final one.
	const inlineHeight = popup.style.height;
	popup.style.height = `${fromHeight}px`;
	try {
		update();
	} finally {
		popup.style.height = inlineHeight;
	}
	return animateHeight(popup, fromHeight, layoutHeight(popup));
}

function observeDialogHeight(content: HTMLElement): () => void {
	const popup = content.closest<HTMLElement>(DIALOG_POPUP_SELECTOR);
	if (!popup) return () => {};

	let settledHeight: number | null = null;
	const settle = () => {
		currentHeightAnimation(popup)?.cancel();
		settledHeight = layoutHeight(popup);
	};
	// Resizing an observed popup from inside the callback would leave its notification
	// undelivered (a "ResizeObserver loop" error), so window resizes refresh its height instead.
	const resizeObserver = new ResizeObserver(() => {
		const running = currentHeightAnimation(popup);
		const fromHeight = running ? layoutHeight(popup) : settledHeight;
		running?.cancel();
		const toHeight = layoutHeight(popup);
		settledHeight = toHeight;
		if (fromHeight === null || prefersReducedMotion()) return;
		animateHeight(popup, fromHeight, toHeight);
	});
	// A closing dialog stops observing at once. Its content often resets inside another
	// observer's callback, such as a toast's flushSync, which would leave this notification
	// undelivered too.
	const syncOpenState = () => {
		settledHeight = null;
		if (popup.hasAttribute("data-closed")) resizeObserver.disconnect();
		else resizeObserver.observe(content);
	};
	const attributeObserver = new MutationObserver(syncOpenState);
	attributeObserver.observe(popup, { attributeFilter: ["data-closed"] });
	syncOpenState();
	window.addEventListener("resize", settle);
	return () => {
		resizeObserver.disconnect();
		attributeObserver.disconnect();
		window.removeEventListener("resize", settle);
	};
}

/**
 * Returns a ref for an element wrapping all of a dialog's content. Whenever that element changes
 * size, the dialog animates from its old height to the new one. The element must keep its natural
 * height inside the popup, so the popup, not the element, is what scrolls when it hits its max
 * height.
 */
export function useAnimatedDialogHeight<T extends HTMLElement>(): React.RefCallback<T> {
	const stopRef = React.useRef<(() => void) | null>(null);
	return React.useCallback((content: T | null) => {
		stopRef.current?.();
		stopRef.current = content ? observeDialogHeight(content) : null;
	}, []);
}
