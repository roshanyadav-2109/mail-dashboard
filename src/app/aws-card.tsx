import { awsAccount } from "@/lib/aws-account";

const money = (n: number, unit = "USD") =>
  n > 0 && n < 0.01
    ? "< $0.01"
    : `${unit === "USD" ? "$" : `${unit} `}${n.toFixed(2)}`;
const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const ENFORCEMENT: Record<string, { label: string; tone: string }> = {
  HEALTHY: { label: "Healthy", tone: "good" },
  PROBATION: { label: "Under review", tone: "warn" },
  SHUTDOWN: { label: "Sending paused", tone: "bad" },
};

function Missing({ error }: { error: string }) {
  return (
    <div className="sub">
      {error === "no permission"
        ? "Needs an IAM permission"
        : "Not available right now"}
    </div>
  );
}

/** Home → AWS account: credits left, this month's spend, SES quota and account standing. Admins only. */
export default async function AwsCard() {
  const { plan, quota, cost } = await awsAccount();
  const used =
    quota.ok && quota.data.max24h > 0
      ? quota.data.sent24h / quota.data.max24h
      : 0;
  const standing = quota.ok
    ? (ENFORCEMENT[quota.data.enforcement] ?? {
        label: quota.data.enforcement,
        tone: "",
      })
    : null;

  return (
    <>
      <div className="home-col-head" style={{ marginTop: 36 }}>
        <span>AWS account</span>
      </div>
      <div className="kpis">
        <div className="card kpi">
          <div className="label">Credits remaining</div>
          {plan.ok ? (
            <>
              <div className="value">
                {plan.data.credits === null
                  ? "—"
                  : money(plan.data.credits, plan.data.unit)}
              </div>
              <div className="sub">
                {plan.data.type === "FREE"
                  ? "Free plan"
                  : plan.data.type === "PAID"
                    ? "Paid plan"
                    : plan.data.type}
                {plan.data.expires ? ` · until ${date(plan.data.expires)}` : ""}
              </div>
            </>
          ) : (
            <>
              <div className="value">—</div>
              <Missing error={plan.error} />
            </>
          )}
        </div>
        <div className="card kpi">
          <div className="label">Usage this month</div>
          {cost.ok ? (
            <>
              <div className="value">
                {money(cost.data.monthToDate, cost.data.unit)}
              </div>
              {plan.ok &&
                plan.data.credits !== null &&
                plan.data.credits > 0 && (
                  <div className="sub">
                    Paid from credits; AWS updates this about once a day
                  </div>
                )}
              <div
                className="sub"
                title={cost.data.services
                  .map((s) => `${s.name}: ${money(s.amount)}`)
                  .join("\n")}
              >
                {cost.data.services.length
                  ? cost.data.services
                      .slice(0, 2)
                      .map(
                        (s) =>
                          `${s.name.replace(/^Amazon |^AWS /, "")} ${money(s.amount)}`,
                      )
                      .join(" · ")
                  : "No charges yet"}
              </div>
            </>
          ) : (
            <>
              <div className="value">—</div>
              <Missing error={cost.error} />
            </>
          )}
        </div>
        <div className="card kpi">
          <div className="label">SES quota (24h)</div>
          {quota.ok ? (
            <>
              <div className="value">
                {quota.data.sent24h.toLocaleString("en-IN")}
                <span
                  className="muted"
                  style={{ fontSize: "0.55em", fontWeight: 500 }}
                >
                  {" "}
                  / {quota.data.max24h.toLocaleString("en-IN")}
                </span>
              </div>
              <div
                className="meter"
                aria-label={`${Math.round(used * 100)}% of today's quota used`}
              >
                <span
                  style={{ width: `${Math.min(100, used * 100)}%` }}
                  className={used > 0.9 ? "bad" : used > 0.7 ? "warn" : ""}
                />
              </div>
              <div className="sub">
                {quota.data.perSecond} emails/second max
              </div>
            </>
          ) : (
            <>
              <div className="value">—</div>
              <Missing error={quota.error} />
            </>
          )}
        </div>
        <div className="card kpi">
          <div className="label">SES account</div>
          {quota.ok && standing ? (
            <>
              <div className={`value ${standing.tone}`}>{standing.label}</div>
              <div className="sub">
                {quota.data.production
                  ? "Production access"
                  : "Sandbox: verified addresses only"}
              </div>
            </>
          ) : (
            <>
              <div className="value">—</div>
              <Missing error={quota.ok ? "unavailable" : quota.error} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
