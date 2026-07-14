import { segmentReferences } from "./references/segment.js";
import { classifyRef, reconcile, type RefType } from "./ref-classify.js";

/**
 * CV mode, part 2: read a CV's *structure*. Unlike a manuscript (one flat
 * bibliography), a CV has several publication sections plus non-publication
 * sections (Education, Honors, Memberships). We walk the headings, collect
 * references only inside publication sections, and tag each with that section's
 * type (refined by the content classifier). Non-publication content is ignored.
 */

export interface CvRef {
  text: string;
  type: RefType;
}
export interface CvParse {
  refs: CvRef[];
  /** True if any recognized CV publication heading was found. */
  sawSections: boolean;
}

type HeadingKind = RefType | "umbrella" | "stop";

/** Normalize a heading line (strip Markdown markers, numbering, trailing punctuation). */
function headingLabel(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[*_]{1,3}\s*/, "")
    .replace(/\s*[*_]{1,3}$/, "")
    .replace(/[.:]+$/, "")
    .toLowerCase();
}

/** Classify a line as a CV section heading, or null if it isn't one. Headings
 * sit roughly alone on a line; a reference line is long and won't match here. */
function cvHeadingKind(line: string): HeadingKind | null {
  const t = line.trim();
  if (t.length === 0 || t.length > 74) return null; // headings are short; refs are long
  const label = headingLabel(line);

  if (/^book chapters?\b|^books\b|^monographs?\b/.test(label)) return "book";
  if (/^(selected |invited )?(presentations?|abstracts?|posters?|invited (talks?|lectures?)|oral presentations?|conference (presentations?|proceedings))\b/.test(label)) return "presentation";
  if (/^(peer[- ]?reviewed|original|refereed|journal)\b.*\b(publications?|articles?|research|papers?)\b/.test(label) || /^(publications?|refereed publications?|journal articles?)\b/.test(label)) return "journal";
  if (/^bibliography\b|^list of publications\b/.test(label)) return "umbrella";
  if (/^(education|degrees|honou?rs|awards|scholarships?|licens|certificat|examinations?|professional (membership|affiliation|service|experience|summary)|memberships?|affiliations?|clinical experience|research (&|and) supervisory|research and supervisory|teaching|educational service|postgraduate training|academic appointments?|employment|work experience|board certification|fellowships?|grants?|funding|patents?|skills|languages|personal|profile|contact|summary|objective|references)\b/.test(label)) return "stop";
  return null;
}

export function parseCv(text: string, opts?: { reflow?: boolean }): CvParse {
  const lines = text.split(/\r?\n/);
  const blocks: { type: RefType | "umbrella"; lines: string[] }[] = [];
  let current: RefType | "umbrella" | null = null;
  let sawSections = false;
  let buf: string[] = [];

  const flush = () => {
    if (current && current !== "umbrella" && buf.length) blocks.push({ type: current, lines: buf.slice() });
    buf = [];
  };

  for (const line of lines) {
    const kind = cvHeadingKind(line);
    if (kind === null) {
      if (current) buf.push(line);
      continue;
    }
    flush();
    if (kind === "stop") current = null;
    else if (kind === "umbrella") { current = "umbrella"; sawSections = true; }
    else { current = kind; sawSections = true; }
  }
  flush();

  // PDFs wrap each reference across several lines with no separator, so reflow
  // them by citation boundaries; .docx/.txt already have one reference per line
  // and use the proven line segmenter.
  const segment = opts?.reflow
    ? reflowReferences
    : (ls: string[]) => segmentReferences(ls.join("\n"));

  const refs: CvRef[] = [];
  for (const b of blocks) {
    const sectionType = b.type === "umbrella" ? undefined : b.type;
    for (const seg of segment(b.lines)) {
      refs.push({ text: seg, type: reconcile(sectionType, classifyRef(seg)) });
    }
  }
  return { refs, sawSections };
}

/** A line that opens a reference: a numbered marker or an author-list start. A
 * bare "N." marker must be followed by an author, so a wrapped page range
 * ("…:35-40." → "40. Epub…") is not mistaken for a numbered list entry. */
function startsReference(l: string): boolean {
  return (
    /^\s*(\[\d+\]|\(\d+\))\s*[A-Z]/.test(l) ||
    /^\s*\d+\.\s+[A-Z][A-Za-zÀ-ÿ'’-]+\s+(?:[A-Z]\.?){1,3}[,. ]/.test(l) ||
    /^[A-Z][A-Za-zÀ-ÿ'’-]+\s+(?:[A-Z]\.?){1,3}\s*[,.]/.test(l) ||
    /^[A-Z][A-Za-zÀ-ÿ'’-]+\s+(?:[A-Z]\.?){1,3}\s+(?:and\s+)?[A-Z][A-Za-zÀ-ÿ'’-]+\s+[A-Z]/.test(l)
  );
}

/** Reassemble a PDF section's wrapped lines into whole references. A new
 * reference begins when a line starts like one AND the previous line did not end
 * mid-list (a wrapped author list ends "…, Fukuda K," with a trailing comma;
 * a finished citation does not). Otherwise the line continues the previous ref —
 * a wrapped author list, a spilled title, or a trailing annotation. */
function reflowReferences(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    const prev = out.length ? out[out.length - 1]! : null;
    const prevMidList = prev !== null && /[,;\-–]$/.test(prev);
    if (prev === null || (startsReference(l) && !prevMidList)) out.push(l);
    else out[out.length - 1] = prev + " " + l;
  }
  return out;
}
