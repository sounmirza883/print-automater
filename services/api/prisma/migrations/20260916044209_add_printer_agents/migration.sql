-- CreateEnum
CREATE TYPE "PrinterAgentStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "printer_agents" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "status" "PrinterAgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "printer_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_pairing_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "printer_agents_device_id_key" ON "printer_agents"("device_id");

-- CreateIndex
CREATE INDEX "printer_agents_shop_id_idx" ON "printer_agents"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_pairing_codes_code_hash_key" ON "agent_pairing_codes"("code_hash");

-- CreateIndex
CREATE INDEX "agent_pairing_codes_shop_id_idx" ON "agent_pairing_codes"("shop_id");

-- AddForeignKey
ALTER TABLE "printer_agents" ADD CONSTRAINT "printer_agents_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_pairing_codes" ADD CONSTRAINT "agent_pairing_codes_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_pairing_codes" ADD CONSTRAINT "agent_pairing_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
