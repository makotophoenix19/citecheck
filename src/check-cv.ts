import { extractDocumentText, formatOf } from "./ingest/index.js";
import { segmentReferences } from "./references/segment.js";
import { checkFreeTextRef, DEEP_PUBMED_MAX_REFS } from "./references/match.js";
import { parseCv } from "./cv-parser.js";
import { classifyRef, type RefType } from "./ref-classify.js";
import { CV_MAX_REFS, MAX_INPUT_BYTES, tooLargeMessage } from "./document.js";
import type { CitationCheckResult, CheckOptions } from "./quick-check.js";

export interface TypedCitation {
  citation: CitationCheckResult;
  type: RefType;
}
export interface CheckCvResult {
  refs: TypedCitation[];
  sawSections: boolean;
  detected: number;
  checked: number;
  truncated: boolean;
}

/**
 * CV mode pipeline: extract text locally, read the CV's structure into
 * type-tagged references, and existence-check each. Only reference strings leave
 * the machine (Crossref/PubMed/OpenAlex/DOAJ); the CV body is never sent.
 */
export async function checkCvDocument(
  input: { bytes: Uint8Array; filename: string },
  opts?: CheckOptions,
): Promise<CheckCvResult> {
  const format = formatOf(input.filename);
  if (format === null) throw new Error(`Unsupported document format: ${input.filename}`);
  if (input.bytes.length > MAX_INPUT_BYTES) throw new Error(tooLargeMessage(input.bytes.length));

  const text = await extractDocumentText(input);
  if (text.trim().length === 0) throw new Error(`No text could be extracted from ${input.filename}`);

  const parsed = parseCv(text, { reflow: format === "pdf" });
  let typed = parsed.refs;
  if (!parsed.sawSections || typed.length === 0) {
    // No recognized CV headings: segment the whole document and keep only lines
    // that actually classify as a reference (drop prose, headings, contact info).
    typed = segmentReferences(text)
      .map((t) => ({ text: t, type: classifyRef(t) }))
      .filter((r) => r.type !== "unknown");
  }

  const truncated = typed.length > CV_MAX_REFS;
  const use = truncated ? typed.slice(0, CV_MAX_REFS) : typed;

  const refs: TypedCitation[] = [];
  const batchSize = 10;
  // The deep PubMed rescue is the expensive, high-yield path, and it only ever
  // helps a JOURNAL article — a conference abstract is not in PubMed to be
  // rescued. So gate it on the journal count and spend it only on journal refs.
  //
  // Counting every reference toward the ceiling meant a CV with 43 articles and
  // 179 abstracts (227 total) switched the rescue OFF for exactly the references
  // the verdict is built from — the abstracts, which could never benefit, crowded
  // out the articles that could. Cost is unchanged: the same refs opt in, and no
  // non-journal ref ever fires the deep path now.
  const journalCount = use.filter((r) => r.type === "journal").length;
  const deepPubmed = journalCount <= DEEP_PUBMED_MAX_REFS;
  for (let i = 0; i < use.length; i += batchSize) {
    const batch = use.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((r) => checkFreeTextRef(r.text, deepPubmed && r.type === "journal")));
    for (let j = 0; j < results.length; j++) {
      refs.push({ citation: results[j]!, type: batch[j]!.type });
      opts?.onResult?.(results[j]!, refs.length, use.length);
    }
    opts?.onProgress?.(refs.length, use.length);
  }

  return { refs, sawSections: parsed.sawSections, detected: typed.length, checked: use.length, truncated };
}
