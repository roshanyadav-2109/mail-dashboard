import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";
import {
  FreeTierClient,
  GetAccountPlanStateCommand,
} from "@aws-sdk/client-freetier";
import { GetAccountCommand, SESv2Client } from "@aws-sdk/client-sesv2";

import { db } from "@/lib/db";

// Free Tier and Cost Explorer are global APIs served from us-east-1 (read-only calls; nothing is created there).
const freetier = new FreeTierClient({ region: "us-east-1" });
const costs = new CostExplorerClient({ region: "us-east-1" });
const ses = new SESv2Client({ region: process.env.AWS_REGION });

// Cost Explorer charges $0.01 per request, so its numbers are cached (AWS itself only refreshes them a few times a day).
const COST_CACHE_KEY = "aws_cost_cache";
const COST_TTL_MS = 6 * 3_600_000;

type Part<T> = { ok: true; data: T } | { ok: false; error: string };

export type AwsAccount = {
  plan: Part<{
    type: string;
    status: string;
    credits: number | null;
    unit: string;
    expires: string | null;
  }>;
  quota: Part<{
    max24h: number;
    sent24h: number;
    perSecond: number;
    production: boolean;
    enforcement: string;
  }>;
  cost: Part<{
    monthToDate: number;
    unit: string;
    services: { name: string; amount: number }[];
    asOf: string;
  }>;
};

const why = (e: unknown) => {
  const name = (e as { name?: string })?.name ?? "";
  return name === "AccessDeniedException" || name === "AccessDenied"
    ? "no permission"
    : "unavailable";
};

async function plan(): Promise<AwsAccount["plan"]> {
  try {
    const r = await freetier.send(new GetAccountPlanStateCommand({}));
    return {
      ok: true,
      data: {
        type: r.accountPlanType ?? "UNKNOWN",
        status: r.accountPlanStatus ?? "UNKNOWN",
        credits: r.accountPlanRemainingCredits?.amount ?? null,
        unit: r.accountPlanRemainingCredits?.unit ?? "USD",
        expires: r.accountPlanExpirationDate?.toISOString() ?? null,
      },
    };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

async function quota(): Promise<AwsAccount["quota"]> {
  try {
    const r = await ses.send(new GetAccountCommand({}));
    return {
      ok: true,
      data: {
        max24h: r.SendQuota?.Max24HourSend ?? 0,
        sent24h: r.SendQuota?.SentLast24Hours ?? 0,
        perSecond: r.SendQuota?.MaxSendRate ?? 0,
        production: !!r.ProductionAccessEnabled,
        enforcement: r.EnforcementStatus ?? "UNKNOWN",
      },
    };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

async function cost(): Promise<AwsAccount["cost"]> {
  const sb = db();
  const { data: cached } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", COST_CACHE_KEY)
    .maybeSingle();
  const hit = cached?.value as
    { at: number; data: AwsAccount["cost"] } | undefined;
  // A failure (e.g. permission not granted yet) is retried after 10 minutes rather than 6 hours.
  if (hit && Date.now() - hit.at < (hit.data.ok ? COST_TTL_MS : 10 * 60_000))
    return hit.data;

  let out: AwsAccount["cost"];
  try {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    // End is exclusive; on the 1st of the month use tomorrow so the range is never empty.
    const end = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
    const r = await costs.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: start, End: end },
        Granularity: "MONTHLY",
        Metrics: ["UnblendedCost"],
        // Usage before credits: on credits the net bill is always $0, which says nothing about what is being used.
        Filter: {
          Not: {
            Dimensions: { Key: "RECORD_TYPE", Values: ["Credit", "Refund"] },
          },
        },
        GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
      }),
    );
    const groups = r.ResultsByTime?.[0]?.Groups ?? [];
    const services = groups
      .map((g) => ({
        name: g.Keys?.[0] ?? "",
        amount: Number(g.Metrics?.UnblendedCost?.Amount ?? 0),
      }))
      .filter((s) => Math.abs(s.amount) >= 0.005)
      .sort((a, b) => b.amount - a.amount);
    out = {
      ok: true,
      data: {
        monthToDate: services.reduce((t, s) => t + s.amount, 0),
        unit: groups[0]?.Metrics?.UnblendedCost?.Unit ?? "USD",
        services: services.slice(0, 6),
        asOf: now.toISOString(),
      },
    };
  } catch (e) {
    out = { ok: false, error: why(e) };
  }
  await sb
    .from("app_settings")
    .upsert(
      {
        key: COST_CACHE_KEY,
        value: { at: Date.now(), data: out },
        updated_by: "system",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  return out;
}

/** Credits, SES sending quota and this month's spend. Each part fails on its own (e.g. a missing IAM permission). */
export async function awsAccount(): Promise<AwsAccount> {
  const [p, q, c] = await Promise.all([plan(), quota(), cost()]);
  return { plan: p, quota: q, cost: c };
}
