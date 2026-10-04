import { parentPort, workerData } from "node:worker_threads";
import { inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
// This worker accepts bytes, never paths/URLs. Decode work has a parent deadline.
try {
  const bytes = Buffer.from(workerData.bytes);
  let decoded;
  if (workerData.mimeType === "image/png") {
    if (
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw Error("PNG signature mismatch");
    let offset = 8,
      ended = false;
    const compressed = [];
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset),
        type = bytes.toString("ascii", offset + 4, offset + 8);
      if (size > bytes.length - offset - 12 || type === "acTL")
        throw Error("Invalid or animated PNG");
      if (offset === 8) {
        if (type !== "IHDR" || size !== 13) throw Error("Invalid PNG header");
        const w = bytes.readUInt32BE(offset + 8),
          h = bytes.readUInt32BE(offset + 12);
        if (!w || !h || w > 4096 || h > 4096 || w * h > 4000000)
          throw Error("Image dimensions exceed limit");
      }
      if (type === "IDAT")
        compressed.push(bytes.subarray(offset + 8, offset + 8 + size));
      offset += size + 12;
      if (type === "IEND") {
        if (size || offset !== bytes.length) throw Error("Trailing PNG data");
        ended = true;
        break;
      }
    }
    if (!ended || !compressed.length) throw Error("Incomplete PNG");
    // Bound inflation before pngjs' interlaced decoder can allocate output.
    inflateSync(Buffer.concat(compressed), { maxOutputLength: 36000000 });
    decoded = PNG.sync.read(bytes, { checkCRC: true });
  } else {
    if (
      bytes.readUInt16BE(0) !== 0xffd8 ||
      bytes.readUInt16BE(bytes.length - 2) !== 0xffd9
    )
      throw Error("JPEG signature mismatch");
    decoded = jpeg.decode(bytes, {
      useTArray: true,
      tolerantDecoding: false,
      maxResolutionInMP: 4,
      maxMemoryUsageInMB: 128,
    });
  }
  if (
    !decoded.width ||
    !decoded.height ||
    decoded.width > 4096 ||
    decoded.height > 4096 ||
    decoded.width * decoded.height > 4000000
  )
    throw Error("Image dimensions exceed limit");
  // Encode pixel data only: no EXIF, scripts, text chunks, or original metadata.
  const output =
    workerData.mimeType === "image/png"
      ? PNG.sync.write(decoded)
      : jpeg.encode(
          { width: decoded.width, height: decoded.height, data: decoded.data },
          90,
        ).data;
  if (output.length > 393216)
    throw Error("Sanitized image exceeds 384 KiB; resize before uploading");
  parentPort.postMessage({
    bytes: output,
    width: decoded.width,
    height: decoded.height,
  });
} catch (error) {
  parentPort.postMessage({
    error: error instanceof Error ? error.message : "Invalid image",
  });
}
