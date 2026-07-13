/**
 * CV mode, part 1: classify a reference by TYPE, because a CV mixes reference
 * kinds that have very different "should this be in Crossref/PubMed?" expectations:
 *
 *   journal       → indexed; a "not found" is a real signal (hard-check)
 *   book          → patchy in Crossref; "not found" is weak (soft)
 *   presentation  → conference abstracts/posters are rarely indexed; "not found"
 *                   is expected and must NOT count as a problem (informational)
 *
 * This is content-based so it works on its own; CV section detection can also
 * pass a section hint to bias a borderline call (see reconcile()).
 */

export type RefType = "journal" | "book" | "presentation" | "unknown";

// A DOI (full or the truncated "doi: 10.1097" that CVs often carry) or a PMID.
const HAS_DOI = /\b10\.\d{4,9}\/\S+/;
const HAS_DOI_PREFIX = /\bdoi:\s*10\.\d/i;
const HAS_PMID = /\bpmid[:\s]\s*\d/i;

// year[ month day];vol(issue):page  — or an eLocator like e0133568 / e45834.
const JOURNAL_STRUCTURE = /\b(19|20)\d{2}[^;\n]{0,14};\s*\d+\s*(\(\d+\))?\s*:\s*[A-Za-z]?\d/;
const ELOCATOR = /:\s*e\d{3,}\b/i;

// Strong book-chapter signals.
const BOOK = /\bin:\s|\bedited by\b|\beds?\.\)|\bspringer\b|\belsevier\b|\bwiley|\bacademic press\b|\bcrc press\b|\bintech\b|\bp\.?\s?\d+[-–]\d+\b(?![^.]*doi)/i;

// Conference / meeting venues.
const PRESENTATION = /scientific sessions|annual meeting|\bcongress\b|\bretreat\b|\bsymposium\b|\bworkshop\b|poster (presentation|session)|platform presentation|\bproceedings\b|\bmeeting of the\b|abstract(s)? (presented|retreat)/i;

/** Classify one reference string by type, from its content alone. */
export function classifyRef(text: string): RefType {
  const hasJournalId = HAS_DOI.test(text) || HAS_DOI_PREFIX.test(text) || HAS_PMID.test(text);
  const journalStructure = JOURNAL_STRUCTURE.test(text) || ELOCATOR.test(text);

  // Book chapters first — they can carry a DOI too, so "In:/edited by/publisher"
  // outranks the journal signals.
  if (BOOK.test(text) && !journalStructure) return "book";

  // A DOI/PMID or a vol(issue):page structure is a strong journal signal, and it
  // also rescues published conference *reports* (which live in a journal) from
  // being mistaken for presentations.
  if (hasJournalId || journalStructure) return "journal";

  // No journal structure + a meeting/venue → a presentation or poster.
  if (PRESENTATION.test(text)) return "presentation";

  return "unknown";
}

/** Combine a section heading's type with the content-derived type. The section
 * is usually authoritative in a CV; content only overrides when the section is
 * unknown, or when content is a hard journal signal under a vague section. */
export function reconcile(sectionType: RefType | undefined, contentType: RefType): RefType {
  if (!sectionType || sectionType === "unknown") return contentType;
  // A DOI/structured journal ref filed under a non-journal heading is still a journal.
  if (contentType === "journal" && sectionType !== "journal") return "journal";
  return sectionType;
}

export function describeType(type: RefType): string {
  switch (type) {
    case "journal": return "journal article";
    case "book": return "book chapter";
    case "presentation": return "conference presentation";
    default: return "reference";
  }
}
