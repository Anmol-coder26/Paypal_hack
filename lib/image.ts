import sharp from "sharp";
import { HttpError } from "./errors";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB
export const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 2400;

export type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export function sniffImageType(magic: Uint8Array): ImageMimeType | null {
  if (magic.length < 12) return null;
  if (magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff) {
    return "image/jpeg";
  }
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, idx) => magic[idx] === b)) {
    return "image/png";
  }
  if (
    String.fromCharCode(...magic.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...magic.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function sanitizeImage(
  input: Uint8Array,
  declaredType?: string
): Promise<{
  bytes: Buffer;
  type: ImageMimeType;
  ext: "jpg" | "png" | "webp";
  width: number;
  height: number;
}> {
  if (input.byteLength === 0 || input.byteLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, "Images must be between 1 byte and 4 MB");
  }
  const type = sniffImageType(input.subarray(0, 12));
  if (!type) {
    throw new HttpError(415, "Only real JPG, PNG or WebP images are accepted");
  }
  if (declaredType && declaredType !== type) {
    throw new HttpError(415, "Image contents do not match the declared file type");
  }
  try {
    const pipeline = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });
    const encoded =
      type === "image/png"
        ? pipeline.png()
        : type === "image/webp"
        ? pipeline.webp({ quality: 88 })
        : pipeline.jpeg({ quality: 88, mozjpeg: true });

    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    return {
      bytes: data,
      type,
      ext: type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg",
      width: info.width,
      height: info.height,
    };
  } catch {
    throw new HttpError(415, "The image could not be decoded. Export it again as JPG, PNG or WebP.");
  }
}
