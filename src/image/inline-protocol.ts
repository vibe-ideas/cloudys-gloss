import { z } from 'zod';
import { ImageLineSchema, ImageOcrSchema } from './regions';
import { imageUrl } from './io';

export const InlineImageRequest = z.object({
  type: z.literal('start'), id: z.string().uuid(),
  url: z.string().max(12000).refine(value => { try { imageUrl(value); return true; } catch { return false; } }),
});
export type InlineImageJob = z.infer<typeof InlineImageRequest>;
export const InlineImageEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), id: z.string().uuid(), status: z.string().max(300) }),
  z.object({ type: z.literal('error'), id: z.string().uuid(), error: z.string().max(1000) }),
  z.object({
    type: z.literal('result'), id: z.string().uuid(), done: z.boolean(),
    image: ImageOcrSchema.shape.image,
    items: z.array(ImageLineSchema.extend({ translation: z.string().max(20000).optional(), error: z.string().max(1000).optional() })).max(1000),
    ms: z.number().finite().nonnegative(),
  }),
]);
export type InlineImageUpdate = z.infer<typeof InlineImageEvent>;
