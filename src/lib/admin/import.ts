import Papa from "papaparse";
import { questionInputSchema, type QuestionInput } from "@/lib/question-schema";
import { sectionOfDiscipline, flatTaxonomy, taxonomy } from "@/lib/taxonomy";

export type ImportFormat = "json" | "csv";

export type ParsedRow = {
  /** 1-based row number as the admin sees it (data rows, not counting a CSV header). */
  row: number;
  input?: QuestionInput;
  errors: string[];
  warnings: string[];
  stemPreview: string;
};

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (v: unknown): string => (v === undefined || v === null ? "" : String(v).trim());

/** Case- and punctuation-insensitive field lookup so "Option A", "option_a" and "optionA" all work. */
function makeGetter(raw: Record<string, unknown>) {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(raw)) map.set(norm(k), v);
  return (...names: string[]): unknown => {
    for (const n of names) if (map.has(n) && clean(map.get(n)) !== "") return map.get(n);
    return undefined;
  };
}

function readOptions(get: ReturnType<typeof makeGetter>): string[] | null {
  const arr = get("options", "choices", "answers");
  if (Array.isArray(arr)) return arr.map(clean);
  if (typeof arr === "string") {
    const parts = arr.split(/\r?\n|\|/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts;
  }
  for (const names of [["optiona", "optionb", "optionc", "optiond"], ["a", "b", "c", "d"], ["option1", "option2", "option3", "option4"], ["choicea", "choiceb", "choicec", "choiced"], ["choice1", "choice2", "choice3", "choice4"]]) {
    const vals = names.map((n) => get(n));
    if (vals.some((v) => v !== undefined)) return vals.map(clean);
  }
  return null;
}

/** Index 0-3 of the correct option, or an error message. */
function readCorrect(get: ReturnType<typeof makeGetter>, options: string[]): { index?: number; error?: string } {
  const zero = get("correctindex", "correctindex0");
  if (zero !== undefined) {
    const n = Number(zero);
    return Number.isInteger(n) && n >= 0 && n <= 3 ? { index: n } : { error: "correctIndex must be 0, 1, 2 or 3" };
  }
  const v = get("correct", "answer", "correctanswer", "correctoption", "key");
  if (v === undefined) return { error: "Missing correct answer (use correct: A-D, or correctIndex: 0-3)" };
  const s = clean(v);
  if (/^[a-dA-D]$/.test(s)) return { index: s.toUpperCase().charCodeAt(0) - 65 };
  if (/^[1-4]$/.test(s)) return { index: Number(s) - 1 };
  const byText = options.findIndex((o) => o.toLowerCase() === s.toLowerCase());
  if (byText >= 0) return { index: byText };
  return { error: `Could not tell which option is correct from "${s.slice(0, 40)}" (use A-D, 1-4 or the exact option text)` };
}

function canonical(list: string[], value: string): string | undefined {
  return list.find((x) => x.toLowerCase() === value.toLowerCase());
}

function readTags(get: ReturnType<typeof makeGetter>, warnings: string[]) {
  const disciplineRaw = clean(get("discipline", "subject"));
  const subtopicRaw = clean(get("subtopic", "topic"));
  const sectionRaw = clean(get("section")).toUpperCase();
  const none = { section: null, discipline: null, subtopic: null } as const;
  if (!disciplineRaw && !subtopicRaw && !sectionRaw) return none;

  const allDisciplines = [...Object.keys(taxonomy.PRECLINICAL), ...Object.keys(taxonomy.CLINICAL)];
  const discipline = canonical(allDisciplines, disciplineRaw);
  if (!discipline) {
    warnings.push(`Tags ignored: "${disciplineRaw || "(no discipline)"}" is not in the taxonomy. The AI tagger can fill them in.`);
    return none;
  }
  const section = sectionOfDiscipline(discipline)!;
  if (sectionRaw && sectionRaw !== section) warnings.push(`Section set to ${section} to match ${discipline}`);
  const subtopic = canonical(flatTaxonomy().filter((t) => t.discipline === discipline).map((t) => t.subtopic), subtopicRaw);
  if (!subtopic) {
    warnings.push(`Tags ignored: "${subtopicRaw || "(no subtopic)"}" is not a ${discipline} subtopic.`);
    return none;
  }
  return { section, discipline, subtopic } as const;
}

/** Converts one raw record (JSON object or CSV row) into a validated question or a list of errors. */
export function normaliseRow(raw: Record<string, unknown>, row: number): ParsedRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const get = makeGetter(raw);

  const stem = clean(get("stem", "question", "text"));
  const options = readOptions(get);
  if (!stem) errors.push("Missing question text (stem)");
  if (!options) errors.push("Missing options (need exactly 4)");
  else if (options.length !== 4) errors.push(`Found ${options.length} options; exactly 4 are required`);

  let correctIndex = 0;
  if (options && options.length === 4) {
    const c = readCorrect(get, options);
    if (c.error) errors.push(c.error);
    else correctIndex = c.index!;
  }

  const tags = readTags(get, warnings);
  const difficultyRaw = clean(get("difficulty", "level")).toUpperCase();
  let difficulty: "EASY" | "MEDIUM" | "HARD" | null = null;
  if (difficultyRaw) {
    if (difficultyRaw === "EASY" || difficultyRaw === "MEDIUM" || difficultyRaw === "HARD") difficulty = difficultyRaw;
    else warnings.push(`Difficulty "${difficultyRaw}" ignored (use easy, medium or hard)`);
  }

  const out: ParsedRow = { row, errors, warnings, stemPreview: stem.slice(0, 140) };
  if (errors.length) return out;

  const parsed = questionInputSchema.safeParse({
    stem,
    options,
    correctIndex,
    explanation: clean(get("explanation", "rationale", "notes")),
    ...tags,
    difficulty,
    source: clean(get("source", "reference")) || null,
    status: "DRAFT", // imports always start as drafts, whatever the file says
  });
  if (!parsed.success) {
    for (const i of parsed.error.issues) errors.push(`${i.path.join(".") || "row"}: ${i.message}`);
    return out;
  }
  out.input = parsed.data;
  if (!parsed.data.explanation) warnings.push("No explanation (the AI quality check can draft one)");
  if (!parsed.data.section) warnings.push("Untagged: run AI tagging or tag it by hand before review");
  return out;
}

/** Parses an uploaded/pasted file into rows. A `fatal` message means nothing usable was found. */
export function parseImport(text: string, format: ImportFormat): { rows: ParsedRow[]; fatal?: string } {
  if (!text.trim()) return { rows: [], fatal: "The file is empty." };
  if (text.length > MAX_IMPORT_BYTES) return { rows: [], fatal: "The file is larger than 5 MB. Split it into smaller imports." };

  let records: unknown[];
  if (format === "json") {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { rows: [], fatal: `Invalid JSON: ${(e as Error).message}` };
    }
    const list = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { questions?: unknown }).questions) ? (data as { questions: unknown[] }).questions : null;
    if (!list) return { rows: [], fatal: 'Expected a JSON array of questions (or { "questions": [...] }).' };
    records = list;
  } else {
    const res = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    if (res.data.length === 0) return { rows: [], fatal: "No data rows found. The first CSV line must be the column headers." };
    records = res.data;
  }

  if (records.length > MAX_IMPORT_ROWS) return { rows: [], fatal: `Too many rows (${records.length}). The limit is ${MAX_IMPORT_ROWS} per import.` };
  const rows = records.map((rec, i) =>
    rec && typeof rec === "object" && !Array.isArray(rec)
      ? normaliseRow(rec as Record<string, unknown>, i + 1)
      : ({ row: i + 1, errors: ["Row is not an object"], warnings: [], stemPreview: "" } satisfies ParsedRow),
  );
  return { rows };
}
