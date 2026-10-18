import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { cellKind, groupFeatures, type PublicFeature, type PublicPlan } from "@/lib/plans";

function Cell({ value }: { value: string | undefined }) {
  const cell = cellKind(value);
  if (cell.kind === "yes") {
    return (
      <>
        <Check aria-hidden="true" className="mx-auto size-5 text-ink-950" />
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
  return <span className="font-medium text-ink-950">{cell.text}</span>;
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
      <h3 className="mt-20 text-2xl font-bold text-ink-950">Compare plans</h3>
      <div className="relative mt-6 overflow-x-auto border border-ink-400">
        <table className="w-full min-w-160 border-collapse text-left text-sm">
          <caption className="sr-only">
            Comparison of {plans.map((p) => p.name).join(", ")} plans
          </caption>
          <thead>
            <tr className="bg-ink-100">
              <th scope="col" className="px-5 py-4 font-bold text-ink-950">
                Feature
              </th>
              {plans.map((p) => (
                <th
                  key={p.name}
                  scope="col"
                  className={cn(
                    "px-5 py-4 text-center font-bold text-ink-950",
                    p.highlighted && "bg-ink-200",
                  )}
                >
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          {groupFeatures(features).map((group) => (
            <tbody key={group.section} className="border-t border-ink-400">
              <tr>
                <th
                  scope="colgroup"
                  colSpan={plans.length + 1}
                  className="bg-ink-50 px-5 pt-5 pb-2 font-mono text-xs tracking-wider text-ink-600 uppercase"
                >
                  {group.section}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.label} className="border-t border-ink-400 hover:bg-white">
                  <th scope="row" className="px-5 py-3.5 font-normal text-ink-700">
                    {row.label}
                  </th>
                  {plans.map((p) => (
                    <td
                      key={p.name}
                      className={cn("px-5 py-3.5 text-center", p.highlighted && "bg-ink-100")}
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
