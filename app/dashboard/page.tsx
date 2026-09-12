import { DashboardClient } from "@/components/dashboard-client";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const dashboardData = await getDashboardData();

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {dashboardData.isDemoData ? (
          <div className="rounded-2xl border border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--foreground)]">
            {dashboardData.loadError ??
              "Dashboard data is unavailable, so sample transactions are shown for layout verification."}
          </div>
        ) : null}

        <DashboardClient
          accuracy={dashboardData.accuracy}
          canDelete={!dashboardData.isDemoData}
          expenses={dashboardData.expenses}
          financeTimezone={dashboardData.financeTimezone}
          incomeRecords={dashboardData.incomeRecords}
          reviewThreshold={dashboardData.reviewThreshold}
          savingsTarget={dashboardData.savingsTarget}
          trend={dashboardData.trend}
        />
      </div>
    </main>
  );
}
