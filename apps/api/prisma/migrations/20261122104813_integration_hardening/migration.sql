-- AlterTable
ALTER TABLE "InboxMessage" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "responseBody" JSONB,
ADD COLUMN     "responseStatus" INTEGER;

-- CreateTable
CREATE TABLE "BatchRecall" (
    "id" TEXT NOT NULL,
    "hptCode" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "recallClass" TEXT,
    "sourceRef" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "BatchRecall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "hptCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "quantity" DECIMAL(65,30),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BatchRecall_hptCode_batchNumber_key" ON "BatchRecall"("hptCode", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockAlert_storeId_hptCode_key" ON "StockAlert"("storeId", "hptCode");
