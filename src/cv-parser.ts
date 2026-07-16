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

/**
 * Heading matching is deliberately ASYMMETRIC: strict about what turns
 * collection ON, loose about what turns it OFF. A missed stop swallows an entire
 * non-publication section into the previous one; a missed start only skips a
 * section. So the "on" patterns are anchored to the END of the line while the
 * stops match on a prefix.
 *
 * The end-anchor is load-bearing for table-built CVs (the WCM template). A cell
 * routinely BEGINS with a section word without being a heading:
 *   "Books / Textbooks / Journals / Organization Name"  ← a column header
 *   "Abstract and potential publication"                ← a mentee's project
 * Matching either as a heading switches collection on inside a mentoring table.
 * A real heading names its section and then only qualifies itself — with a
 * parenthetical ("Abstracts (optional, list 10-20 best or most recent only):")
 * or a dash subtitle ("Peer-Reviewed Publications — Pathology & Laboratory
 * Medicine"). Both are allowed; trailing prose or a "/"-joined cell list is not.
 */
const END = String.raw`\s*(?:[—–]\s*.+?)?\s*(?:\(.*\))?$`;
const rx = (body: string) => new RegExp(`^(?:${body})${END}`);

const BOOK_H = rx(String.raw`book chapters?|books|monographs?|chapters?`);

/** Qualifier words that may precede the noun ("Poster Presentations", "Invited
 * Talks", "Selected Oral Presentations"), and the nouns themselves, which may be
 * joined ("Abstracts and Posters"). Listing the nouns as bare alternatives is
 * what missed "Poster Presentations": it matched neither `posters?` nor
 * `presentations?` alone, because it is the two-word phrase. */
const PRES_QUAL = String.raw`(?:selected|invited|peer[- ]reviewed|published|refereed|other|additional|oral|poster|platform|conference|scientific|national|international|regional|local)`;
const PRES_NOUN = String.raw`(?:presentations?|abstracts?|posters?|talks?|lectures?|proceedings)`;
// The joined noun may carry its own qualifier — "Posters & Oral Presentations".
// Without that, this heading fell through to COMPOUND_H, opened an umbrella, and
// its entries were dropped as untypable prose: 7 real posters lost from one CV.
const PRESENTATION_H = rx(
  String.raw`(?:${PRES_QUAL}\s+)*${PRES_NOUN}(?:\s*(?:and|&|/|,)\s*(?:${PRES_QUAL}\s+)*${PRES_NOUN})*`,
);

const JOURNAL_H = rx(String.raw`(?:peer[- ]?reviewed|original|refereed|journal)\b.*\b(?:publications?|articles?|research|papers?)`);
const JOURNAL_H2 = rx(
  String.raw`publications?|refereed publications?|journal articles?|reviews and editorials|case reports?|(?:articles?|papers?)\s+in\s+(?:peer[- ]?reviewed|refereed)\b.*`,
);
const UMBRELLA_H = rx(String.raw`bibliography|list of publications`);

/** A compound heading joining publication nouns: "Publications & Preprints",
 * "Publications and Presentations". The halves may be different types, so open an
 * umbrella and let each entry's content type it rather than guessing wrong for
 * half the section. Only "&"/"and" joins — never "/" — and every part must be
 * publication vocabulary, so a "/"-joined cell list ("Books / Textbooks /
 * Journals / Organization Name") still does not match. */
const PUB_NOUN = String.raw`(?:preprints?|publications?|presentations?|abstracts?|posters?|articles?|papers?|chapters?|books?|monographs?|manuscripts?|reviews?|editorials?|proceedings|talks?|lectures?)`;
const COMPOUND_H = rx(String.raw`(?:${PRES_QUAL}\s+)*${PUB_NOUN}(?:\s*(?:&|and)\s+(?:${PRES_QUAL}\s+)*${PUB_NOUN})+`);

const STOP_H =
  /^(education|degrees|honou?rs|awards|scholarships?|licens|certificat|examinations?|professional (membership|affiliation|service|experience|summary)|memberships?|affiliations?|clinical experience|research (&|and) supervisory|research and supervisory|teaching|educational service|postgraduate training|academic appointments?|employment|work experience|board certification|fellowships?|grants?|funding|patents?|skills|languages|personal|profile|contact|summary|objective|references|mentoring|invitations?|institutional|extramural)\b/;

/** Work that is real but not database-checkable: unpublished manuscripts and
 * non-peer-reviewed trade pieces. Checking these would flag every entry as
 * "to confirm" — a false alarm, since nothing here is expected to be indexed. */
// Anchored via END, NOT ".*": "other.*" matched any line beginning with the word
// "Other" — including a reference, and including the common heading "Other
// Publications", which it would stop on and discard. Only the distinctive
// multi-word phrases keep a free tail.
const UNVERIFIABLE_H = rx(String.raw`in review|in preparation|submitted\b.*|non[- ]peer[- ]reviewed\b.*|other`);

/** Publication vocabulary. Used ONLY to read an ALL-CAPS heading we have no
 * specific pattern for — never to open a section on a mixed-case line, which is
 * how a table cell ("Abstract and potential publication") would sneak in. */
const PUB_WORD = /\b(?:publication|bibliograph|abstract|presentation|poster|manuscript|article|book|chapter|peer[- ]?review|refereed|journal|paper)/i;

/** An ALL-CAPS line is a section heading — but only if it is WORDS. A wrapped
 * citation tail has no lowercase either ("PMID: 35070478.",
 * "10.1080/10428194.2022.2140285. PMID: 36346368."), and reading one as a heading
 * STOPS collection mid-bibliography: it cost one CV every reference after its
 * first. Digits disqualify — section headings don't carry them, citation tails
 * are made of them. */
function isCapsHeading(t: string): boolean {
  return /[A-Z]{3}/.test(t) && !/[a-z]/.test(t) && !/\d/.test(t);
}

/** Classify a line as a CV section heading, or null if it isn't one. Headings
 * sit roughly alone on a line; a reference line is long and won't match here. */
function cvHeadingKind(line: string): HeadingKind | null {
  const t = line.trim();
  if (t.length === 0 || t.length > 74) return null; // headings are short; refs are long
  const label = headingLabel(line);

  if (BOOK_H.test(label)) return "book";
  if (PRESENTATION_H.test(label)) return "presentation";
  if (JOURNAL_H.test(label) || JOURNAL_H2.test(label)) return "journal";
  if (UMBRELLA_H.test(label) || COMPOUND_H.test(label)) return "umbrella";
  if (STOP_H.test(label)) return "stop";
  if (UNVERIFIABLE_H.test(label)) return "stop";
  if (isCapsHeading(t)) {
    // A shouted heading naming publications in a combination we have no pattern
    // for ("PUBLICATIONS & PRESENTATIONS") opens an umbrella — let each entry's
    // content type it. Stopping here would silently discard the whole section
    // and report zero publications, which is the false PASS again.
    return PUB_WORD.test(t) ? "umbrella" : "stop";
  }
  return null;
}

export function parseCv(text: string, opts?: { reflow?: boolean }): CvParse {
  const lines = text.split(/\r?\n/);
  const blocks: { type: RefType | "umbrella"; lines: string[] }[] = [];
  let current: RefType | "umbrella" | null = null;
  let sawSections = false;
  let buf: string[] = [];

  // Umbrella content IS collected (its entries are typed by content below).
  // Dropping it here silently discarded every reference under a heading we could
  // recognize but not type — "Publications & Preprints" cost one real CV its
  // entire peer-reviewed section, reported as zero journal articles.
  const flush = () => {
    if (current && buf.length) blocks.push({ type: current, lines: buf.slice() });
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
      // Bulleted .docx/.txt CVs keep their marker through the line segmenter; a
      // leading "•" would otherwise reach the author-list stripper as a token.
      const text = stripBullet(seg);
      if (!text) continue;
      const contentType = classifyRef(text);
      // Under an umbrella there is no section hint, so an entry content cannot
      // type is prose, not a reference — the template instructions that sit under
      // "BIBLIOGRAPHY" ("Entries should follow standard journal format…"). A
      // typed section keeps its entries either way, since the heading vouches.
      if (!sectionType && contentType === "unknown") continue;
      refs.push({ text, type: reconcile(sectionType, contentType) });
    }
  }
  return { refs, sawSections };
}

/** A list-item bullet. Many CVs mark each reference with one instead of a
 * number, and the marker defeats every author/number pattern below. ASCII
 * markers require a following space so a wrapped page range ("657-" → "-661.")
 * and a footnote ("*: Co-first author.") are not mistaken for bullets. */
const BULLET_RE = /^\s*(?:[•●○◦▪▫‣⁃∙]\s*|[*–-]\s+)/;

/** A year used as a list marker: "2024  Gastrointestinal Manifestations…". The
 * month exclusion is load-bearing — "2020 Nov-Dec; 11(6):e02707-20" is a wrapped
 * citation tail, not a new entry, and opens identically. */
const YEAR_START = /^(?:19|20)\d{2}\s+(?!(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)(?=[A-Z“"'])/;

/** Drop a leading bullet so the reference text starts at the author list. */
export function stripBullet(l: string): string {
  return l.replace(BULLET_RE, "").trim();
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
 * reference begins when the line carries a bullet, or when it starts like one
 * AND the previous line did not end mid-list (a wrapped author list ends
 * "…, Fukuda K," with a trailing comma; a finished citation does not).
 * Otherwise the line continues the previous ref — a wrapped author list, a
 * spilled title, or a trailing annotation.
 *
 * A bullet outranks the mid-list guard: it is an explicit structural marker, so
 * it opens a reference even where the author pattern can't (full first names,
 * "• Richard K. Yang, Gokce A. Toruner, …"). A line with no bullet still
 * continues the previous one, which is what carries a reference across a page
 * break. */
function reflowReferences(lines: string[]): string[] {
  const out: string[] = [];
  // A numbered bibliography RUNS IN SEQUENCE, and the sequence itself is what
  // identifies a real marker. That does the work no author pattern can: it
  // accepts any author format after the number ("2. Ghazaleh Eskandari, …", full
  // first names) and a marker with no period at all ("34 Richard D. Beger, …"),
  // while still rejecting a wrapped page range that merely looks like one
  // ("…:35-40." → "40. Epub 2012…") because 40 is not the next number.
  //
  // Direction is INFERRED, not assumed: a CV often numbers newest-first and
  // counts DOWN (34, 33, 32…). Assuming ascending made every such reference fuse
  // into its predecessor. The first marker seen starts the run, the second fixes
  // the step, and the rest must follow it — so a section numbered 65-99 works,
  // and a stray "2024 Gastrointestinal…" cannot hijack a run at 31.
  // A year-prefixed list ("2024  Gastrointestinal Manifestations…" / "2021
  // Longitudinal Plasma…") uses the YEAR as its marker. Years do not run in
  // sequence, so the step logic above cannot hold them and every entry fused.
  //
  // A lone year-start is far too weak to trust — a wrapped citation tail opens
  // the same way ("2020 Nov-Dec; 11(6): e02707-20"). So require the MODE, the
  // same evidence segmentReferences demands of numbered markers: several lines in
  // THIS block must open with one before any of them counts. Month tails are
  // excluded outright, since that is what a wrapped citation actually looks like.
  const yearMode = lines.filter((l) => YEAR_START.test(l.trim())).length >= 3;
  let last: number | null = null;
  let step: number | null = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    const bulleted = BULLET_RE.test(l);
    const text = bulleted ? stripBullet(l) : l;
    if (!text) continue;
    const m = /^(\d+)[.)]?\s+(?=[A-Z“"'])/.exec(text);
    const n = m ? Number(m[1]) : null;
    let numbered = false;
    if (n !== null) {
      if (last === null) numbered = true; // opens the run
      else if (step === null) {
        if (n === last + 1) { numbered = true; step = 1; }
        else if (n === last - 1) { numbered = true; step = -1; }
      } else if (n === last + step) numbered = true;
    }
    const yearStart = yearMode && YEAR_START.test(text);
    const prev = out.length ? out[out.length - 1]! : null;
    const prevMidList = prev !== null && /[,;\-–]$/.test(prev);
    if (prev === null || bulleted || numbered || yearStart || (startsReference(text) && !prevMidList)) {
      out.push(text);
      if (numbered) last = n;
    } else out[out.length - 1] = prev + " " + text;
  }
  return out;
}
