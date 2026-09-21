import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import {
  ACCEPTED_LABEL,
  ACCEPT_ATTRIBUTE,
  MAX_FILES_PER_SUBMISSION,
  MAX_FILE_BYTES,
} from "./upload-limits";

// Re-exported so server code has one import for everything about uploads.
export { ACCEPTED_LABEL, ACCEPT_ATTRIBUTE, MAX_FILES_PER_SUBMISSION, MAX_FILE_BYTES };

/**
 * File storage for student submissions.
 *
 * Bytes live on local disk, outside `public/`, and are served only through an
 * authorising route — never as a static asset. The database holds the
 * metadata; this module owns everything about the bytes.
 *
 * Three rules this file exists to enforce:
 *
 *  1. A filename from a client is DATA, never a path. Stored names are
 *     generated here; the student's name is kept only to show them back.
 *  2. The declared MIME type is also client-controlled, so the bytes are
 *     sniffed. A .jpg that is actually HTML is refused.
 *  3. Nothing is ever served inline. Downloads go out as attachments with a
 *     narrow content type, so a file that slips through cannot execute in the
 *     origin of a logged-in user.
 *
 * SVG and HTML are deliberately absent from the allowlist: both execute
 * script in the viewer's origin, and neither is a way anyone hands in
 * homework.
 */

/** Where submissions live. Override in production to a mounted volume. */
export const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.join(process.cwd(), "uploads");

interface AllowedType {
  ext: string;
  /** What we serve it back as, regardless of what was declared. */
  contentType: string;
  /** Leading bytes that must match. */
  magic: number[][];
  label: string;
}

/**
 * What a student may hand in: a photo of their working, a scan, or a typed
 * document. Each entry carries the byte signature that proves it.
 */
const ALLOWED: AllowedType[] = [
  {
    ext: "jpg",
    contentType: "image/jpeg",
    magic: [[0xff, 0xd8, 0xff]],
    label: "JPEG image",
  },
  {
    ext: "png",
    contentType: "image/png",
    magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    label: "PNG image",
  },
  {
    ext: "pdf",
    contentType: "application/pdf",
    magic: [[0x25, 0x50, 0x44, 0x46]], // %PDF
    label: "PDF",
  },
  {
    // WEBP is RIFF....WEBP — the tag at offset 8 is checked separately.
    ext: "webp",
    contentType: "image/webp",
    magic: [[0x52, 0x49, 0x46, 0x46]],
    label: "WebP image",
  },
  {
    // HEIC is what an iPhone produces by default: ....ftyp at offset 4.
    ext: "heic",
    contentType: "image/heic",
    magic: [[0x66, 0x74, 0x79, 0x70]], // matched at offset 4
    label: "HEIC image",
  },
  {
    // DOCX/XLSX are ZIP containers. We cannot tell them apart from any other
    // ZIP by magic alone, so the extension decides which of the two it is and
    // the ZIP signature only proves it is a real container.
    ext: "docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    magic: [[0x50, 0x4b, 0x03, 0x04]],
    label: "Word document",
  },
  {
    ext: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    magic: [[0x50, 0x4b, 0x03, 0x04]],
    label: "Excel workbook",
  },
];

export const ACCEPTED_EXTENSIONS = ALLOWED.map((a) => a.ext);

function matches(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  return sig.every((b, i) => buf[offset + i] === b);
}

/**
 * Decide what a file actually is.
 *
 * The extension picks the candidate, the bytes confirm it. A mismatch is
 * refused rather than corrected: if the two disagree, something is wrong and
 * guessing which to believe is how an upload filter gets bypassed.
 */
export function detectType(
  buf: Buffer,
  originalName: string,
): { ok: true; type: AllowedType } | { ok: false; error: string } {
  const ext = path.extname(originalName).slice(1).toLowerCase();
  const normalised = ext === "jpeg" ? "jpg" : ext === "heif" ? "heic" : ext;

  const candidate = ALLOWED.find((a) => a.ext === normalised);
  if (!candidate) {
    return {
      ok: false,
      error: `That file type is not accepted. Please upload ${ACCEPTED_LABEL}.`,
    };
  }

  // HEIC carries its signature at offset 4, not 0.
  const offset = candidate.ext === "heic" ? 4 : 0;
  const signatureOk = candidate.magic.some((sig) => matches(buf, sig, offset));
  if (!signatureOk) {
    return {
      ok: false,
      error: `That file does not look like a real ${candidate.label}. Please re-save it and try again.`,
    };
  }

  // WEBP: RIFF is shared with other formats, so require the WEBP tag too.
  if (candidate.ext === "webp" && !matches(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ok: false, error: "That file does not look like a real WebP image." };
  }

  return { ok: true, type: candidate };
}

export interface StoredFile {
  storedPath: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Write bytes to disk under a generated name.
 *
 * The layout is `submissions/<activityId>/<studentId>/<uuid>.<ext>`: grouped
 * so a whole activity or one student's work can be found or removed without
 * consulting the database, and named so nothing a student typed reaches the
 * filesystem.
 */
export async function storeSubmissionFile(params: {
  buf: Buffer;
  originalName: string;
  activityId: string;
  studentId: string;
}): Promise<{ ok: true; file: StoredFile } | { ok: false; error: string }> {
  const { buf, originalName, activityId, studentId } = params;

  if (buf.length === 0) return { ok: false, error: "That file is empty." };
  if (buf.length > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `That file is too large. The limit is ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
    };
  }

  const detected = detectType(buf, originalName);
  if (!detected.ok) return { ok: false, error: detected.error };

  // Every path component is server-generated, so there is nothing to escape.
  const relDir = path.posix.join("submissions", activityId, studentId);
  const relPath = path.posix.join(relDir, `${randomUUID()}.${detected.type.ext}`);
  const absPath = path.join(UPLOAD_ROOT, relPath);

  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buf);

  return {
    ok: true,
    file: {
      storedPath: relPath,
      contentType: detected.type.contentType,
      sizeBytes: buf.length,
      checksum: createHash("sha256").update(buf).digest("hex"),
    },
  };
}

/**
 * Absolute path for a stored file, or null if it escapes the upload root.
 *
 * `storedPath` comes from our own database, but this is the last point before
 * a filesystem read — so it is checked anyway rather than trusted because of
 * where it came from.
 */
export function resolveStoredPath(storedPath: string): string | null {
  const abs = path.resolve(UPLOAD_ROOT, storedPath);
  const root = path.resolve(UPLOAD_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** Best-effort removal. A missing file is not an error worth surfacing. */
export async function deleteStoredFile(storedPath: string): Promise<void> {
  const abs = resolveStoredPath(storedPath);
  if (!abs) return;
  try {
    await unlink(abs);
  } catch {
    /* already gone */
  }
}

/**
 * A filename safe to put in a Content-Disposition header.
 *
 * Quotes and control characters would let a crafted name break out of the
 * header value, so only a conservative set survives.
 */
export function safeDownloadName(originalName: string): string {
  const base = path.basename(originalName).replace(/[^\w.\- ]+/g, "_").trim();
  return base.slice(0, 100) || "submission";
}
