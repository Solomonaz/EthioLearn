import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

/**
 * GET /api/pdf-worker — pdf.js's worker script, served from our own origin.
 *
 * The CSP allows scripts (and therefore workers) only from 'self', so the
 * worker cannot come from a CDN. Reading it out of node_modules keeps it the
 * exact version the client bundle was built against. The legacy build is used
 * on both sides because it runs on older phone browsers.
 */
let cached: Buffer | null = null;

export async function GET() {
  if (!cached) {
    cached = await readFile(path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"));
  }
  return new NextResponse(new Uint8Array(cached), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
