/** The animation currently changing `element`'s height, whether scripted or a CSS transition. */
export function heightAnimation(element: Element): Animation | undefined {
	return element
		.getAnimations()
		.find(
			(animation) =>
				animation.effect instanceof KeyframeEffect &&
				animation.effect.getKeyframes().some((keyframe) => "height" in keyframe),
		);
}

/** Pauses `animation` halfway through so a test can read its in-between state. */
export function pauseHalfway(animation: Animation): void {
	animation.pause();
	animation.currentTime = Number(animation.effect!.getComputedTiming().duration) / 2;
}

/** Waits past the next rendering updates, after ResizeObserver callbacks have run. */
export async function nextFrames(count = 2): Promise<void> {
	for (let frame = 0; frame < count; frame++) {
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}
}
