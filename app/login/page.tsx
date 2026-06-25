import { WalletCards } from "lucide-react";

import { signInWithGoogle } from "@/app/login/actions";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const nextPath = params.next ?? "/dashboard";
  const authConfigured = Boolean(
    process.env.AUTH_GOOGLE_ID &&
      process.env.AUTH_GOOGLE_SECRET &&
      process.env.AUTH_SECRET &&
      process.env.AUTH_ALLOWED_EMAIL
  );

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[var(--panel-soft)] text-[var(--primary)]">
            <WalletCards aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-normal">Smart Finance</h1>
            <p className="text-sm text-[var(--muted)]">Dashboard access</p>
          </div>
        </div>

        {!authConfigured ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Add Google OAuth environment variables to enable dashboard login.
          </div>
        ) : null}

        {params.error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Sign-in failed. Make sure you are using the allowed Google account.
          </div>
        ) : null}

        <form action={signInWithGoogle} className="mt-6">
          <input name="next" type="hidden" value={nextPath} />
          <button
            className="focus-ring flex h-11 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!authConfigured}
            type="submit"
          >
            Continue with Google
          </button>
        </form>
      </section>
    </main>
  );
}
