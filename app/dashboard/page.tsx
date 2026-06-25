import { LogOut, WalletCards } from "lucide-react";

import { signOutOfDashboard } from "@/app/login/actions";
import { DashboardClient } from "@/components/dashboard-client";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const dashboardData = await getDashboardData();

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-white/90 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--panel-soft)] text-[var(--primary)]">
              <WalletCards aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--muted)]">BMO activity</p>
              <h1 className="truncate text-2xl font-semibold tracking-normal text-slate-950">
                Smart Finance Tracker
              </h1>
            </div>
          </div>

          <form action={signOutOfDashboard}>
            <button
              className="focus-ring inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:w-auto"
              type="submit"
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </header>

        {dashboardData.isDemoData ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {dashboardData.loadError ??
              "Dashboard data is unavailable, so sample transactions are shown for layout verification."}
          </div>
        ) : null}

        <DashboardClient expenses={dashboardData.expenses} />
      </div>
    </main>
  );
}
