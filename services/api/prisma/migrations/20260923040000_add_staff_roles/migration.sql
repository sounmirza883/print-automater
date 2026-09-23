-- 16.1/§46: expand UserRole additively. Postgres requires each new enum
-- value in its own ALTER TYPE statement; existing rows and every
-- persisted CUSTOMER/SHOP_OWNER/SHOP_MANAGER/SHOP_COUNTER/ADMIN string
-- are untouched.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OPERATOR';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PRINTER_MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPPLIER';
