import { Suspense } from "react";
import type { Metadata } from "next";
import { Monitor } from "lucide-react";
import { getAppContext, isOwner } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { STATION_TYPE_LABEL, STATION_TYPE_PREFIX, STATION_TYPES, type StationType } from "@/lib/constants";
import { Empty, PageHeader, PageSkeleton, Panel } from "@/components/card";
import { AddStationsButton } from "./bulk-add-form";
import { StationRow } from "./station-row";

export const metadata: Metadata = { title: "Stations" };

export default function StationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Stations />
    </Suspense>
  );
}

async function Stations() {
  const { branch, role } = await getAppContext();
  const supabase = await createClient();
  const [{ data: stations }, { data: settings }] = await Promise.all([
    supabase.from("stations").select("id, name, type, tier, zone, status").eq("branch_id", branch.id).order("sort_order"),
    supabase.from("branch_settings").select("station_types").eq("branch_id", branch.id).single(),
  ]);

  const list = stations ?? [];
  const editable = isOwner(role);
  // Kinds the venue offers (chosen at onboarding / Settings), in display order.
  const types = STATION_TYPES.filter((t) => (settings?.station_types ?? STATION_TYPES).includes(t));

  // Next number per type, so a second batch continues after the highest existing number
  // (not the count: after deleting PC-03 of PC-01…PC-10 the next one is PC-11, not a duplicate PC-10).
  const nextNumber = Object.fromEntries(
    STATION_TYPES.map((t) => {
      const highest = list
        .filter((s) => s.type === t)
        .reduce((max, s) => Math.max(max, Number(/(\d+)\s*$/.exec(s.name)?.[1] ?? 0)), 0);
      return [t, highest + 1];
    }),
  ) as Record<StationType, number>;

  return (
    <>
      <PageHeader
        title="Stations"
        description={`${list.length} at ${branch.name}`}
        actions={editable && <AddStationsButton nextNumber={nextNumber} branchName={branch.name} types={types} />}
      />

      {list.length === 0 ? (
        <Panel>
          <Empty icon={<Monitor />} title="No stations yet">
            Add your {types.map((t) => STATION_TYPE_LABEL[t]).join(", ")} stations. You can add many at once, e.g.{" "}
            {STATION_TYPE_PREFIX[types[0] ?? "pc"]}01 to {STATION_TYPE_PREFIX[types[0] ?? "pc"]}10.
            {editable && (
              <div className="mt-4 flex justify-center">
                <AddStationsButton nextNumber={nextNumber} branchName={branch.name} types={types} />
              </div>
            )}
          </Empty>
        </Panel>
      ) : (
        <Panel flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Tier</th>
                  <th className="px-4 py-2.5 font-medium">Zone</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              {STATION_TYPES.filter((t) => list.some((s) => s.type === t)).map((type) => {
                const group = list.filter((s) => s.type === type);
                return (
                  <tbody key={type} className="border-b border-line last:border-b-0">
                    <tr>
                      <th colSpan={5} className="bg-subtle px-4 py-1.5 text-left text-xs font-medium text-muted">
                        {STATION_TYPE_LABEL[type]} · {group.length}
                      </th>
                    </tr>
                    {group.map((s) => (
                      <StationRow key={s.id} station={s} editable={editable} />
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
