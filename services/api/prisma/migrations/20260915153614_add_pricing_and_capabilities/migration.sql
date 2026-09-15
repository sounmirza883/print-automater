-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "capabilities" JSONB;

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "price_per_page_minor" INTEGER NOT NULL,
    "color_surcharge_per_page_minor" INTEGER NOT NULL,
    "other_charges" JSONB NOT NULL,
    "minimum_charge_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rules_shop_id_version_key" ON "pricing_rules"("shop_id", "version");

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
