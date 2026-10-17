-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "premiumAt" TIMESTAMP(3),
ADD COLUMN     "premiumSource" TEXT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountPesewas" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paystackId" TEXT,
    "channel" TEXT,
    "feePesewas" INTEGER,
    "paidAt" TIMESTAMP(3),
    "problem" TEXT,
    "problemHandledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules Prisma cannot express itself (the app checks these too; the database is the last line of defence).
-- Money is whole pesewas, in Ghana cedis.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_chk" CHECK ("amountPesewas" > 0 AND ("feePesewas" IS NULL OR "feePesewas" >= 0));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_currency_chk" CHECK ("currency" = 'GHS');
-- Premium has a date and a reason together, or neither.
ALTER TABLE "User" ADD CONSTRAINT "User_premium_chk" CHECK (("premiumAt" IS NULL) = ("premiumSource" IS NULL) AND ("premiumSource" IS NULL OR "premiumSource" IN ('PAYMENT', 'ADMIN')));
