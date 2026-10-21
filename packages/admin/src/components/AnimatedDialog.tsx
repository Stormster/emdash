import { Dialog, type DialogProps } from "@cloudflare/kumo";

import { useAnimatedDialogHeight } from "../lib/dialog-height.js";

/**
 * Kumo `Dialog` panel that animates its height when its content changes size, such as an inline
 * error appearing or a section toggling. Suits dialogs whose content flows top to bottom and
 * scrolls as a whole; a dialog that lays out its own scroll regions can call
 * `transitionDialogHeight` around the state change instead.
 */
export function AnimatedDialog({ children, ...props }: DialogProps) {
	const contentRef = useAnimatedDialogHeight<HTMLDivElement>();
	return (
		<Dialog {...props}>
			<div ref={contentRef} className="flow-root">
				{children}
			</div>
		</Dialog>
	);
}
