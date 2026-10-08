import raw from "../../taxonomy.json";

export type SectionName = "PRECLINICAL" | "CLINICAL";
export type Taxonomy = Record<SectionName, Record<string, string[]>>;

export const taxonomy = raw as Taxonomy;

export const SECTIONS: SectionName[] = ["PRECLINICAL", "CLINICAL"];

export function disciplinesOf(section: SectionName): string[] {
  return Object.keys(taxonomy[section]);
}

export function subtopicsOf(discipline: string): string[] {
  for (const s of SECTIONS) {
    const found = taxonomy[s][discipline];
    if (found) return found;
  }
  return [];
}

/** The section a discipline belongs to, or undefined if it is not in the taxonomy. */
export function sectionOfDiscipline(discipline: string): SectionName | undefined {
  return SECTIONS.find((s) => discipline in taxonomy[s]);
}

/** True only when discipline/subtopic exist in the taxonomy AND belong to the given section. */
export function isValidTags(section: string, discipline: string, subtopic: string): boolean {
  if (section !== "PRECLINICAL" && section !== "CLINICAL") return false;
  const subs = taxonomy[section][discipline];
  return !!subs && subs.includes(subtopic);
}

/** Flat list used for AI prompts and import validation. */
export function flatTaxonomy(): { section: SectionName; discipline: string; subtopic: string }[] {
  const out: { section: SectionName; discipline: string; subtopic: string }[] = [];
  for (const section of SECTIONS) {
    for (const [discipline, subs] of Object.entries(taxonomy[section])) {
      for (const subtopic of subs) out.push({ section, discipline, subtopic });
    }
  }
  return out;
}
