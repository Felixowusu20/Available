import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/guards";

export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold">Available</h1>
        <p className="mt-2 text-muted">
          Timed mocks and topic practice for the Ghana Medical and Dental Council licensure exam, with an explanation for every
          question.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/signup" className="btn flex-1">
          Create account
        </Link>
        <Link href="/login" className="btn btn-ghost flex-1">
          Sign in
        </Link>
      </div>
    </main>
  );
}
