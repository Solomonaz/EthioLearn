/**
 * Upload rules — the client-safe half.
 *
 * Kept apart from `lib/uploads`, which imports `fs` and `crypto` and must
 * never reach the browser bundle. The file picker needs only these three
 * values, so they live here and the server module imports them back.
 *
 * These are a courtesy to the student, not a control: the server re-checks
 * every one of them, and sniffs the bytes besides.
 */

/** Per file. A phone photo of a page is comfortably under this. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Per submission, so one student cannot fill the disk. */
export const MAX_FILES_PER_SUBMISSION = 8;

/** Extensions a student may hand in, in `accept` attribute form. */
export const ACCEPT_ATTRIBUTE = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.docx,.xlsx";

export const ACCEPTED_LABEL = "JPG, PNG, WebP, HEIC, PDF, Word or Excel";
