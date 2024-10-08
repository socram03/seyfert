export const DefaultUserAgent = 'DiscordBot (https://seyfert.dev, v2.0.0)';
export const ALLOWED_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'gif'] as const;
export const ALLOWED_STICKER_EXTENSIONS = ['png', 'json', 'gif'] as const;
export const ALLOWED_SIZES = [16, 32, 64, 100, 128, 256, 512, 1_024, 2_048, 4_096] as const;

export type ImageExtension = (typeof ALLOWED_EXTENSIONS)[number];
export type StickerExtension = (typeof ALLOWED_STICKER_EXTENSIONS)[number];
export type ImageSize = (typeof ALLOWED_SIZES)[number];
