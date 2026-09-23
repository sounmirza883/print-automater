-- 17.5/§4.2/§11: distinguishes a self-service (customer-web) order
-- from one a shop's own counter staff placed on a customer's behalf.
-- Defaults every existing row (and every future self-service order)
-- to CUSTOMER_WEB, unaffected.

-- CreateEnum
CREATE TYPE "OrderCreationSource" AS ENUM ('CUSTOMER_WEB', 'COUNTER');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "creation_source" "OrderCreationSource" NOT NULL DEFAULT 'CUSTOMER_WEB';
