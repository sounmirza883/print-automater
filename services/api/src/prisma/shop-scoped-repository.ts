interface ShopScopedDelegate<TWhere, TResult> {
  findMany(args: { where: TWhere }): Promise<TResult[]>;
  findFirst(args: { where: TWhere }): Promise<TResult | null>;
}

/** §82: wraps a Prisma delegate for a shop-owned table so `shopId` is a
 * required, separate argument merged into the where-clause -- making it
 * structurally impossible to write a shop-owned query that forgets the
 * tenant boundary. Every future shop-scoped feature module (orders,
 * printers, print_jobs) wraps its own delegate with this instead of
 * calling prisma.<model> directly. */
export class ShopScopedRepository<TWhere extends { shopId?: string }, TResult> {
  constructor(private readonly delegate: ShopScopedDelegate<TWhere, TResult>) {}

  findMany(
    shopId: string,
    where: Omit<TWhere, "shopId"> = {} as Omit<TWhere, "shopId">,
  ): Promise<TResult[]> {
    return this.delegate.findMany({ where: { ...where, shopId } as TWhere });
  }

  findFirst(
    shopId: string,
    where: Omit<TWhere, "shopId"> = {} as Omit<TWhere, "shopId">,
  ): Promise<TResult | null> {
    return this.delegate.findFirst({ where: { ...where, shopId } as TWhere });
  }
}
