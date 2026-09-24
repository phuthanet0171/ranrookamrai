// Shapes of the JSON returned by the SQL functions in supabase/migrations/002_analytics.sql

// orders / items / customers / aov are null when the data cannot answer them
// (an imported file without bill numbers, quantities or customer ids)
export type Kpis = {
  revenue: number;
  orders: number | null;
  items: number | null;
  customers: number | null;
  aov: number | null;
  on_time_rate: number | null;
};

export type TrendPoint = { date: string; revenue: number; orders: number; revenue_ma7: number };

export type BreakdownRow = { key: string; label: string; revenue: number; orders: number; share: number | null };

export type DriverSegment = {
  dimension: "category" | "state" | "time_of_day";
  segment: string;
  direction: "up" | "down";
  current: number;
  baseline: number;
  change: number;
  change_pct: number | null;
  share_of_total_change: number | null;
};

export type Drivers = {
  current_period: { start: string; end: string };
  baseline_period: { start: string; end: string; note: string };
  total_current: number;
  total_baseline: number;
  total_change: number;
  total_change_pct: number | null;
  segments: DriverSegment[];
};

export type DashboardData = {
  range: { start: string; end: string; days: number; prev_start: string; prev_end: string };
  kpis: {
    current: Kpis;
    previous: Kpis;
    growth_pct: { revenue: number | null; orders: number | null; aov: number | null; customers: number | null };
    on_time_change_pts: number | null;
  };
  trend: TrendPoint[];
  by_category: BreakdownRow[];
  by_state: BreakdownRow[];
  by_hour: BreakdownRow[];
  by_weekday: BreakdownRow[];
  drivers: Drivers;
  rank_category?: Ranking;           // missing until migration 003 is run
  rank_product?: Ranking | null;     // only when the data has product names
};

export type RankRow = BreakdownRow & { prev_revenue: number; change_pct: number | null };
export type Ranking = { dimension: "product" | "category"; items: number; top: RankRow[]; bottom: RankRow[] };

export type DailyReport = {
  date: string;
  weekday: string;
  today: Kpis;
  baseline_7d_avg: { period_start: string; period_end: string; revenue: number; orders: number | null; aov: number | null };
  change_pct: {
    revenue_vs_7d_avg: number | null;
    orders_vs_7d_avg: number | null;
    aov_vs_7d_avg: number | null;
    revenue_vs_prev_day: number | null;
    revenue_vs_same_day_last_week: number | null;
  };
  previous_day: Kpis;
  same_day_last_week: Kpis;
  month_to_date: {
    start: string;
    end: string;
    revenue: number;
    orders: number | null;
    prev_month_same_days_revenue: number;
    change_pct: number | null;
  };
  anomaly: "drop" | "spike" | null;
  top_categories: BreakdownRow[];
  drivers: Drivers;
};

export type Bounds = {
  min_date: string | null;
  max_date: string | null;
  sim_date: string | null;
  currency?: string;          // BRL for Olist, THB for an imported Thai shop
  region_label?: string;      // what "state" means in this data: รัฐของลูกค้า / สาขา / ...
  dataset_name?: string;
  has_products?: boolean;
  has_time?: boolean;
  has_order_ids?: boolean;    // false: orders / AOV cannot be computed (migration 004)
  has_customer_ids?: boolean; // false: unique customers cannot be computed
  has_quantity?: boolean;
};

/** Bounds once we know the database has data */
export type LoadedBounds = Bounds & { min_date: string; max_date: string };

export type Lang = "en" | "th";

export type Insight = {
  headline: string;
  bullets: string[];
  recommendation: string;
  source: "ai" | "template";
  verified: boolean;          // AI text used only placeholders; numbers and directions were filled in by code
  unverified_numbers: string[];
  note?: string;              // why we fell back to the template, if we did
  cached?: boolean;
  model?: string;
};
