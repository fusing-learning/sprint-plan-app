import type { Modifier } from '@dnd-kit/core';

/** Restrict dragging to the vertical axis. */
export const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });
