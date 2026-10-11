import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { cellKind, groupFeatures, type PublicFeature, type PublicPlan } from "@/lib/plans";

function Cell({ value }: { value: string | undefined }) {
  const cell = cellKind(value);
  if (cell.kind === "yes") {
    return (
      <>
        <Check aria-hidden="true" className="mx-auto size-5 text-emerald-600" />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (cell.kind === "no") {
    return (
      <>
        <Minus aria-hidden="true" className="mx-auto size-5 text-ink-400" />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="font-medium text-ink-900">{cell.text}</span>;
}

/** The Compare plans table: one column per live plan, one row per feature the admin
 * defined, grouped by section. Rendered from `GET /v1/plans`, never hard-coded. */
export function CompareTable({
  plans,
  features,
}: {
  plans: PublicPlan[];
  features: PublicFeature[];
}) {
  return (
    <>
      <h3 className="mt-16 text-center text-xl font-semibold text-ink-900">Compare plans</h3>
      <div className="relative mt-6 overflow-x-auto rounded-2xl border border-ink-100">
        <table className="w-full min-w-160 border-collapse text-left text-sm">
          <caption className="sr-only">
            Comparison of {plans.map((p) => p.name).join(", ")} plans
          </caption>
          <thead>
            <tr className="bg-ink-50">
              <th scope="col" className="px-5 py-4 font-semibold text-ink-900">
                Feature
              </th>
              {plans.map((p) => (
                <th
                  key={p.name}
                  scope="col"
                  className={cn(
                    "px-5 py-4 text-center font-semibold text-ink-900",
                    p.highlighted && "bg-brand-50 text-brand-800",
                  )}
                >
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          {groupFeatures(features).map((group) => (
            <tbody key={group.section} className="border-t border-ink-100">
              <tr>
                <th
                  scope="colgroup"
                  colSpan={plans.length + 1}
                  className="bg-white px-5 pt-5 pb-2 font-mono text-xs tracking-wide text-ink-600 uppercase"
                >
                  {group.section}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.label} className="border-t border-ink-100 hover:bg-ink-50/60">
                  <th scope="row" className="px-5 py-3.5 font-normal text-ink-700">
                    {row.label}
                  </th>
                  {plans.map((p) => (
                    <td
                      key={p.name}
                      className={cn("px-5 py-3.5 text-center", p.highlighted && "bg-brand-50/50")}
                    >
                      <Cell value={row.values[p.name]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}
