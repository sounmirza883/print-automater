-- AlterTable
ALTER TABLE "printers" ADD COLUMN     "agent_id" TEXT;

-- CreateIndex
CREATE INDEX "printers_agent_id_idx" ON "printers"("agent_id");

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "printer_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
