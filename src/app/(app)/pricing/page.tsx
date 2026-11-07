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
import { PriceCheck } from "./price-check";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage(props: PageProps<"/pricing">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Pricing searchParams={props.searchParams} />
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

async function Pricing({ searchParams }: { searchParams: PageProps<"/pricing">["searchParams"] }) {
  const { branch, role } = await getAppContext();
  const supabase = await createClient();

  const [{ data: stations }, { data: plans }, { data: packages }] = await Promise.all([
    supabase.from("stations").select("type, tier").eq("branch_id", branch.id),
    supabase.from("rate_plans").select("*, rate_rules(*)").eq("branch_id", branch.id).order("created_at"),
    supabase.from("packages").select("*").eq("branch_id", branch.id).order("minutes"),
  ]);

  const editable = isOwner(role);
  const types = STATION_TYPES.filter((t) => (stations ?? []).some((s) => s.type === t));
  const sp = await searchParams;
  const active = types.find((t) => t === sp.type) ?? types[0];

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
          {/* One tab per station type; types with no active rate are flagged. */}
          <nav aria-label="Station type" className="flex flex-wrap gap-1.5">
            {types.map((t) => {
              const priced = (plans ?? []).some((p) => p.station_type === t && p.is_active);
              const on = t === active;
              return (
                <Link
                  key={t}
                  href={`/pricing?type=${t}`}
                  aria-current={on ? "page" : undefined}
                  className={
                    on
                      ? "inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-fg"
                      : priced
                        ? "inline-flex h-9 items-center gap-2 rounded-full border border-line bg-panel px-4 text-[13px] font-medium text-muted hover:border-line-strong hover:text-fg"
                        : "inline-flex h-9 items-center gap-2 rounded-full border border-ending/40 bg-ending/8 px-4 text-[13px] font-medium text-ending"
                  }
                >
                  {!priced && <span className="size-1.5 rounded-full bg-ending" aria-hidden />}
                  {STATION_TYPE_LABEL[t]}
                  {!priced && <span className="text-xs">· no price</span>}
                </Link>
              );
            })}
          </nav>

          {types.filter((t) => t === active).map((type) => {
            const tiers = [...new Set((stations ?? []).filter((s) => s.type === type).map((s) => s.tier))];
            const typePlans = (plans ?? []).filter((p) => p.station_type === type);
            const typePackages = (packages ?? []).filter((p) => p.station_type === type);
            const checkPlan = typePlans.find((p) => p.is_active && p.tier === null) ?? typePlans.find((p) => p.is_active);

            return (
              <div key={type} className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Panel
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
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="num text-lg font-semibold">{formatINR(plan.per_hour)}</span>
                          <span className="text-sm text-muted">/ hour</span>
                          <Badge>{plan.tier ?? "All tiers"}</Badge>
                          {!plan.is_active && <Badge tone="danger">Inactive</Badge>}
                          <span className="text-[13px] text-muted">
                            {plan.rounding_minutes === 1 ? "Exact minutes" : `Rounded up to ${plan.rounding_minutes} min`}
                            {plan.min_minutes > 0 && ` · min ${formatMinutes(plan.min_minutes)}`}
                            {Number(plan.extra_player_per_hour) > 0 &&
                              ` · +${formatINR(plan.extra_player_per_hour)}/hr per ${type === "ps5" || type === "xbox" ? "controller" : "player"} over ${plan.included_players}`}
                            {plan.gst_rate_override != null && ` · GST ${plan.gst_rate_override}%`}
                          </span>
                          {editable && (
                            <span className="ml-auto flex items-center gap-1">
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
                          <ul className="mt-2.5 flex flex-col gap-1 border-l-2 border-accent/30 pl-3">
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
                    <table className="w-full text-sm">
                      <tbody>
                        {typePackages.map((pkg) => (
                          <tr key={pkg.id} className={pkg.is_active ? "" : "text-faint"}>
                            <td className="py-1.5 pr-3 font-medium">
                              {pkg.name}
                              {checkPlan && Math.round((Number(checkPlan.per_hour) * pkg.minutes) / 60) - Number(pkg.price) > 0 && (
                                <span className="num ml-2 rounded-md bg-free/10 px-1.5 py-px text-[11px] font-semibold text-free">
                                  save {formatINR(Math.round((Number(checkPlan.per_hour) * pkg.minutes) / 60) - Number(pkg.price))}
                                </span>
                              )}
                              {!pkg.is_active && (
                                <span className="ml-2 rounded-md bg-subtle px-1.5 py-px text-[11px] font-medium text-muted">Hidden</span>
                              )}
                            </td>
                            <td className="num py-1.5 pr-3 text-muted">{formatMinutes(pkg.minutes)}</td>
                            <td className="num py-1.5 pr-3">{formatINR(pkg.price)}</td>
                            <td className="py-1.5 pr-3 text-muted">{pkg.tier ?? "All tiers"}</td>
                            <td className="py-1.5 text-right">
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
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </Panel>

              {/* Price check for this type's main rate */}
              {checkPlan && (
                <Panel title="Price check" description="What a session would cost with these rates">
                  <PriceCheck
                    plan={checkPlan}
                    rules={checkPlan.rate_rules}
                    timeZone={branch.timezone}
                    canHaveExtraPlayers={Number(checkPlan.extra_player_per_hour) > 0}
                  />
                </Panel>
              )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
