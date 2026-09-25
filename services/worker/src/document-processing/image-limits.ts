/** 21.9/21.12 image limits, shared by the header check and the PNG sanitizer.
 * 40 MP covers phone photos and any realistic scan; the side cap stops
 * absurd strips that pass the area cap. */
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_SIDE = 20_000;
