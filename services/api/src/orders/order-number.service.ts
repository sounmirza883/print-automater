import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";

/** §21: `PA-YYYYMMDD-NNNNNN`. The date is always UTC -- there is no
 * single "shop's local time" for a platform spanning many shops, and
 * every other timestamp in this schema (createdAt et al.) is already
 * UTC, so this stays consistent with that rather than introducing a
 * second, timezone-dependent convention. */
@Injectable()
export class OrderNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /** `INSERT ... ON CONFLICT (date_key) DO UPDATE ... RETURNING` is one
   * atomic statement -- concurrent callers on the same date serialize
   * on Postgres' own row lock rather than racing a read-then-write in
   * application code, which is what makes "500 concurrent creations
   * produce 500 unique, gapless numbers" (5.2's own Done-when) true
   * without any additional locking here. `now` is a parameter, not
   * always literally "today", so tests can exercise this against an
   * isolated, collision-free date key instead of real production
   * counter state. */
  async generate(now: Date = new Date()): Promise<string> {
    const dateKey = formatDateKey(now);
    const rows = await this.prisma.$queryRaw<Array<{ counter: number }>>`
      INSERT INTO order_number_counters (date_key, counter)
      VALUES (${dateKey}, 1)
      ON CONFLICT (date_key) DO UPDATE SET counter = order_number_counters.counter + 1
      RETURNING counter
    `;
    const counter = rows[0]?.counter;
    if (counter === undefined) {
      throw new Error("Order number counter upsert returned no row.");
    }
    return `PA-${dateKey}-${String(counter).padStart(6, "0")}`;
  }
}

function formatDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
