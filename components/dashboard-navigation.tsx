"use client";

import {
  CalendarDays,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  Settings
} from "lucide-react";
import { signOutOfDashboard } from "@/app/login/actions";
import type { ComponentType, SVGProps } from "react";

export type DashboardTabKey =
  | "overview"
  | "calendar"
  | "transactions"
  | "assistant"
  | "settings";

export function getDashboardTabId(tab: DashboardTabKey): string {
  return `dashboard-tab-${tab}`;
}

export function getDashboardPanelId(tab: DashboardTabKey): string {
  return `dashboard-panel-${tab}`;
}

type DashboardIcon = ComponentType<SVGProps<SVGSVGElement>>;

type DashboardNavItem = {
  key: DashboardTabKey;
  label: string;
  icon: DashboardIcon;
};

export const dashboardTabLabels: Record<DashboardTabKey, string> = {
  overview: "Overview",
  calendar: "Calendar",
  transactions: "Transactions",
  assistant: "Assistant",
  settings: "Settings"
};

const dashboardNavItems: DashboardNavItem[] = [
  { key: "overview", label: dashboardTabLabels.overview, icon: LayoutDashboard },
  { key: "calendar", label: dashboardTabLabels.calendar, icon: CalendarDays },
  { key: "transactions", label: dashboardTabLabels.transactions, icon: ListChecks },
  { key: "assistant", label: dashboardTabLabels.assistant, icon: MessagesSquare },
  { key: "settings", label: dashboardTabLabels.settings, icon: Settings }
];

type DashboardNavigationProps = {
  activeTab: DashboardTabKey;
  onSelect: (tab: DashboardTabKey) => void;
};

export function DashboardNavigation({ activeTab, onSelect }: DashboardNavigationProps) {
  return (
    <nav
      aria-label="Dashboard sections"
      className="dashboard-sidebar dashboard-mobile-rail flex min-w-0 gap-2 p-2 lg:top-5 lg:w-[15rem] lg:self-start lg:h-[calc(100vh-2.5rem)] lg:max-h-[calc(100vh-2.5rem)] lg:overflow-y-auto lg:gap-5 lg:p-4"
    >
      <div className="hidden px-2 py-2 lg:block">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Welcome back</p>
        <p className="mt-1 truncate text-xl font-bold text-white">Brian</p>
        <p className="mt-1 text-xs text-white/60">Your financial overview</p>
      </div>

      <div className="grid min-w-0 flex-1 grid-cols-5 gap-1 lg:flex lg:flex-1 lg:flex-col lg:gap-2" role="tablist">
        {dashboardNavItems.map(({ icon: Icon, key, label }) => {
          const isActive = activeTab === key;
          const stateClasses = isActive
            ? "bg-[var(--primary)] text-white shadow-sm lg:bg-white/15"
            : "text-[var(--muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--foreground)] lg:text-white/70 lg:hover:bg-white/10 lg:hover:text-white";

          return (
            <button
              aria-controls={getDashboardPanelId(key)}
              aria-label={label}
              aria-selected={isActive}
              className={`focus-ring flex h-11 min-w-0 items-center justify-center gap-2 rounded-2xl px-2 text-sm font-semibold transition-[background-color,color,box-shadow] duration-200 ease-out lg:justify-start lg:px-3 ${stateClasses}`}
              id={getDashboardTabId(key)}
              key={key}
              onClick={() => onSelect(key)}
              role="tab"
              title={label}
              type="button"
            >
              <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span className="sr-only lg:not-sr-only">{label}</span>
            </button>
          );
        })}
      </div>

      <form action={signOutOfDashboard} className="flex shrink-0 lg:mt-auto">
        <button
          aria-label="Sign out"
          className="focus-ring inline-flex h-11 w-11 items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-0 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--panel-soft)] lg:h-10 lg:w-full lg:justify-start lg:border-white/10 lg:bg-white/5 lg:px-3 lg:text-white/80 lg:hover:bg-white/10 lg:hover:text-white"
          title="Sign out"
          type="submit"
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          <span className="sr-only lg:not-sr-only">Sign out</span>
        </button>
      </form>
    </nav>
  );
}
