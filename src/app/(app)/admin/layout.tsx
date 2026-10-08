import Link from "next/link";
import { requireAdmin } from "@/lib/guards";

// Second gate (the (app) layout already requires sign-in): every page below needs the ADMIN role.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div>
      <nav className="border-b border-line bg-bg" aria-label="Admin">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-x-4 px-4 py-2 text-sm">
          <Link href="/admin" className="py-1 font-semibold">
            Admin
          </Link>
          <Link href="/admin/questions" className="py-1 hover:underline">
            Questions
          </Link>
          <Link href="/admin/import" className="py-1 hover:underline">
            Import
          </Link>
          <Link href="/admin/ai" className="py-1 hover:underline">
            AI review
          </Link>
        </div>
      </nav>
      {children}
    </div>
  );
}
