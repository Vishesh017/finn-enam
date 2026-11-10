import { extractText, getDocumentProxy } from "unpdf";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const tidy = (s: string) =>
  s.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/**
 * Downloads a PDF and returns its text, or null if it cannot be fetched or read.
 * Never throws: one blocked document should not sink the whole analysis.
 */
export async function fetchPdfText(
  url: string,
  { maxBytes = 25_000_000, timeoutMs = 30_000 }: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  try {
    const host = new URL(url).hostname;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/pdf,*/*",
        ...(host.includes("bseindia") ? { Referer: "https://www.bseindia.com/" } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) {
      console.warn(`[fundamentals] ${res.status} for ${url}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      console.warn(`[fundamentals] skipped ${url}: ${bytes.byteLength} bytes`);
      return null;
    }
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") {
      console.warn(`[fundamentals] not a PDF: ${url}`);
      return null;
    }
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const out = tidy(text);
    return out.length > 500 ? out : null; // scanned image PDFs yield almost nothing
  } catch (err) {
    console.warn(`[fundamentals] failed for ${url}:`, (err as Error).message);
    return null;
  }
}

/** Annual reports run to hundreds of pages. Keep the Management Discussion section. */
export function sliceAnnualReport(text: string, max = 45_000): string {
  const hits = [...text.matchAll(/management discussion (?:and|&) analysis/gi)].map((m) => m.index ?? 0);
  // The first hit is usually the table of contents, so prefer the second.
  const start = hits.length > 1 ? hits[1] : (hits[0] ?? 0);
  return text.slice(start, start + max);
}
