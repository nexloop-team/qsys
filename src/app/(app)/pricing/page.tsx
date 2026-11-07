import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Tags } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { DAY_LABELS, STATION_TYPE_LABEL, STATION_TYPES } from "@/lib/constants";
import { formatINR, formatMinutes, toTimeInput } from "@/lib/format";
import { buttonClass } from "@/components/styles";
import { Badge, Empty, PageHeader, PageSkeleton, Panel, SectionLabel } from "@/components/card";
import { PlanDialogButton } from "./rate-plan-form";
import { RuleDialogButton } from "./rule-form";
import { PackageDialogButton } from "./package-form";
import { DeleteButton, PackageActiveToggle } from "./row-actions";
import { deletePackage, deleteRatePlan, deleteRateRule } from "./actions";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Pricing />
    </Suspense>
  );
}

function describeDays(days: number[]) {
  const key = [...days].sort().join();
  if (days.length === 7) return "Every day";
  if (key === "1,2,3,4,5") return "Mon–Fri";
  if (key === "0,6") return "Sat–Sun";
  return [...days].sort().map((d) => DAY_LABELS[d]).join(" ");
}

async function Pricing() {
  const { branch, role } = await getAppContext();
  const supabase = await createClient();

  const [{ data: stations }, { data: plans }, { data: packages }] = await Promise.all([
    supabase.from("stations").select("type, tier").eq("branch_id", branch.id),
    supabase.from("rate_plans").select("*, rate_rules(*)").eq("branch_id", branch.id).order("created_at"),
    supabase.from("packages").select("*").eq("branch_id", branch.id).order("minutes"),
  ]);

  const editable = isOwner(role);
  const types = STATION_TYPES.filter((t) => (stations ?? []).some((s) => s.type === t));

  return (
    <>
      <PageHeader title="Pricing" description="Hourly rates, time-based rates and fixed-time packages per station type." />

      {types.length === 0 ? (
        <Panel>
          <Empty icon={<Tags />} title="Add stations first">
            Prices are set per station type.
            <div className="mt-4 flex justify-center">
              <Link href="/stations" className={buttonClass("primary")}>
                Go to Stations
              </Link>
            </div>
          </Empty>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {types.map((type) => {
            const tiers = [...new Set((stations ?? []).filter((s) => s.type === type).map((s) => s.tier))];
            const typePlans = (plans ?? []).filter((p) => p.station_type === type);
            const typePackages = (packages ?? []).filter((p) => p.station_type === type);

            return (
              <Panel
                key={type}
                title={STATION_TYPE_LABEL[type]}
                description={tiers.length > 1 ? `Tiers: ${tiers.join(", ")}` : undefined}
                action={editable && <PlanDialogButton stationType={type} tiers={tiers} />}
                flush
              >
                {/* Rates */}
                {typePlans.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-ending">
                    No rate yet. {STATION_TYPE_LABEL[type]} sessions can&apos;t start until you add one.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {typePlans.map((plan) => (
                      <li key={plan.id} className="px-4 py-3">
                        {/* Price and its actions on one line; the rules that shape the bill below. */}
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="num text-lg font-semibold">{formatINR(plan.per_hour)}</span>
                              <span className="text-sm text-muted">/ hour</span>
                              {(plan.tier || tiers.length > 1) && <Badge>{plan.tier ?? "All tiers"}</Badge>}
                              {!plan.is_active && <Badge tone="danger">Inactive</Badge>}
                            </p>
                            <p className="mt-0.5 text-[13px] text-muted">
                              {plan.rounding_minutes === 1 ? "Exact minutes" : `Rounded up to ${plan.rounding_minutes} min`}
                              {plan.min_minutes > 0 && ` · min ${formatMinutes(plan.min_minutes)}`}
                              {Number(plan.extra_player_per_hour) > 0 &&
                                ` · +${formatINR(plan.extra_player_per_hour)}/hr per ${type === "ps5" || type === "xbox" ? "controller" : "player"} over ${plan.included_players}`}
                              {plan.gst_rate_override != null && ` · GST ${plan.gst_rate_override}%`}
                            </p>
                          </div>
                          {editable && (
                            <span className="flex shrink-0 items-center gap-1">
                              <RuleDialogButton ratePlanId={plan.id} />
                              <PlanDialogButton stationType={type} tiers={tiers} plan={plan} />
                              <DeleteButton
                                confirmText={`Delete this ${STATION_TYPE_LABEL[type]} rate?`}
                                onDelete={deleteRatePlan.bind(null, plan.id)}
                              />
                            </span>
                          )}
                        </div>
                        {plan.rate_rules.length > 0 && (
                          <ul className="mt-2.5 flex flex-col gap-1 border-l border-line pl-3">
                            {plan.rate_rules.map((rule) => (
                              <li key={rule.id} className="flex flex-wrap items-center gap-x-2 text-[13px]">
                                <span className="font-medium">{rule.name}</span>
                                <span className="text-muted">
                                  {describeDays(rule.days_of_week)} · {toTimeInput(rule.start_time)}–{toTimeInput(rule.end_time)}
                                </span>
                                <span className="num">{formatINR(rule.per_hour)}/hr</span>
                                {editable && (
                                  <span className="inline-flex items-center">
                                    <RuleDialogButton ratePlanId={plan.id} rule={rule} />
                                    <DeleteButton
                                      confirmText={`Delete "${rule.name}"?`}
                                      onDelete={deleteRateRule.bind(null, rule.id)}
                                    />
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Packages */}
                <div className="border-t border-line px-4 py-3">
                  <div className="flex items-center justify-between">
                    <SectionLabel>Time packages</SectionLabel>
                    {editable && <PackageDialogButton stationType={type} tiers={tiers} />}
                  </div>
                  {typePackages.length === 0 ? (
                    <p className="text-[13px] text-muted">None. Staff can still book custom minutes at the hourly rate.</p>
                  ) : (
                    // A wrapping list, not a table: fits a phone without sideways scrolling.
                    <ul className="divide-y divide-line text-sm">
                      {typePackages.map((pkg) => (
                        <li
                          key={pkg.id}
                          className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${pkg.is_active ? "" : "text-faint"}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{pkg.name}</span>
                            <span className="num block text-xs text-muted">
                              {formatMinutes(pkg.minutes)} · {pkg.tier ?? "All tiers"}
                            </span>
                          </span>
                          <span className="num font-medium">{formatINR(pkg.price)}</span>
                          {editable && (
                            <span className="inline-flex items-center gap-1">
                              <PackageDialogButton stationType={type} tiers={tiers} pkg={pkg} />
                              <PackageActiveToggle id={pkg.id} isActive={pkg.is_active} />
                              <DeleteButton
                                confirmText={`Delete "${pkg.name}"?`}
                                onDelete={deletePackage.bind(null, pkg.id)}
                              />
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
