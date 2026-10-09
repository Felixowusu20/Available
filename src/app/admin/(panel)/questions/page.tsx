import Link from "next/link";
import { Icon } from "@/components/icons";
import { listFiltersSchema, listQuestions } from "@/lib/admin/questions";
import { SECTIONS, taxonomy } from "@/lib/taxonomy";
import { QuestionTable } from "./question-table";

export const metadata = { title: "Question bank" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const topic = one(sp.topic) ?? "";
  const [discipline, subtopic] = topic.split("|");

  const parsed = listFiltersSchema.safeParse({
    q: one(sp.q),
    status: one(sp.status),
    section: one(sp.section),
    discipline: discipline || undefined,
    subtopic: subtopic || undefined,
    untagged: one(sp.untagged),
    flagged: one(sp.flagged),
    page: one(sp.page),
  });
  const filters = parsed.success ? parsed.data : listFiltersSchema.parse({});
  const { items, total, page, pages } = await listQuestions(filters);

  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: one(sp.q), status: one(sp.status), section: one(sp.section), topic, untagged: one(sp.untagged), flagged: one(sp.flagged), ...extra })) if (v) p.set(k, v);
    return `/admin/questions?${p.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Question bank</h1>
          <p className="mt-1 text-sm text-muted">Tag each question, then publish it. Only published questions show up in student practice.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/questions/new" className="btn">
            <Icon name="plus" className="size-4" />
            New question
          </Link>
          <Link href="/admin/import" className="btn btn-ghost">
            <Icon name="upload" className="size-4" />
            Import
          </Link>
        </div>
      </div>

      <form method="get" className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Search</span>
          <input name="q" defaultValue={one(sp.q)} placeholder="Stem, explanation or source" className="input" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Status</span>
          <select name="status" defaultValue={one(sp.status) ?? ""} className="input">
            <option value="">Any</option>
            {["DRAFT", "IN_REVIEW", "PUBLISHED", "RETIRED"].map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Section</span>
          <select name="section" defaultValue={one(sp.section) ?? ""} className="input">
            <option value="">Any</option>
            <option value="PRECLINICAL">Preclinical</option>
            <option value="CLINICAL">Clinical</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Discipline / subtopic</span>
          <select name="topic" defaultValue={topic} className="input">
            <option value="">Any</option>
            {SECTIONS.map((s) => (
              <optgroup key={s} label={s === "PRECLINICAL" ? "Preclinical" : "Clinical"}>
                {Object.entries(taxonomy[s]).flatMap(([d, subs]) => [
                  <option key={d} value={d}>
                    {d} (all)
                  </option>,
                  ...(subs.length > 1 ? subs.map((sub) => (
                    <option key={`${d}|${sub}`} value={`${d}|${sub}`}>
                      {`${d} › ${sub}`}
                    </option>
                  )) : []),
                ])}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 self-end text-sm">
          <input type="checkbox" name="untagged" value="1" defaultChecked={!!one(sp.untagged)} className="size-5" /> Untagged only
        </label>
        <label className="flex min-h-10 items-center gap-2 self-end text-sm">
          <input type="checkbox" name="flagged" value="1" defaultChecked={!!one(sp.flagged)} className="size-5" /> Has AI suggestions
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <button className="btn">Filter</button>
          <Link href="/admin/questions" className="btn btn-ghost">
            Clear
          </Link>
        </div>
      </form>

      <p className="text-sm text-muted" aria-live="polite">
        {total} question{total === 1 ? "" : "s"}
        {pages > 1 && ` · page ${page} of ${pages}`}
      </p>

      <QuestionTable
        empty={
          <div className="space-y-3 p-4">
            <p className="text-muted">{one(sp.q) || one(sp.status) || one(sp.section) || topic || one(sp.untagged) || one(sp.flagged) ? "No questions match these filters." : "The bank is empty. Add a question or import a file. New questions stay drafts until you tag and publish them."}</p>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/questions/new" className="btn">
                New question
              </Link>
              <Link href="/admin/import" className="btn btn-ghost">
                Import
              </Link>
            </div>
          </div>
        }
        items={items.map((i) => ({
          id: i.id,
          stem: i.stem,
          status: i.status,
          section: i.section,
          discipline: i.discipline,
          subtopic: i.subtopic,
          pendingAi: i._count.suggestions,
        }))}
      />

      {pages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          {page > 1 ? (
            <Link className="btn btn-ghost" href={keep({ page: String(page - 1) })}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          {page < pages && (
            <Link className="btn btn-ghost" href={keep({ page: String(page + 1) })}>
              Next
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
