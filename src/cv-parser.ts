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

export function parseCv(text: string): CvParse {
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

  const refs: CvRef[] = [];
  for (const b of blocks) {
    const sectionType = b.type === "umbrella" ? undefined : b.type;
    for (const seg of segmentReferences(b.lines.join("\n"))) {
      refs.push({ text: seg, type: reconcile(sectionType, classifyRef(seg)) });
    }
  }
  return { refs, sawSections };
}
