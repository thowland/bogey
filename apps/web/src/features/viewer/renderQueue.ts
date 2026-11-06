// The one render queue shared by the page view and the thumbnail strip (spec §10.3): two renders
// at a time, the page in view first, each limited by the render timeout (spec §11.4).
import { LIMITS, TIMING } from '../../config.ts';
import { RenderQueue } from '../../pdfjs/renderQueue.ts';

export const PRIORITY = Object.freeze({ current: 0, neighbor: 1, thumbnail: 2 });

export const renderQueue = new RenderQueue(LIMITS.maxConcurrentRenders, TIMING.renderTimeoutMs);
