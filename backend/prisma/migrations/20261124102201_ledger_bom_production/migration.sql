-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING', 'PURCHASE', 'PRODUCTION_ISSUE', 'PRODUCTION_OUTPUT', 'PRODUCTION_SCRAP', 'DISPATCH', 'SALES_RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('OPENING', 'PURCHASE', 'PRODUCTION_RUN', 'INVOICE', 'DISPATCH', 'CREDIT_NOTE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('ISSUED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OverheadKind" AS ENUM ('LABOUR', 'POWER_GAS', 'OTHER');

-- CreateTable
CREATE TABLE "Bom" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "finishedItemId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "batchYieldQty" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomLine" (
    "id" SERIAL NOT NULL,
    "bomId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "qtyPerBatch" INTEGER NOT NULL,

    CONSTRAINT "BomLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "supplierInvoiceNo" TEXT,
    "totalPaise" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" SERIAL NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "ratePaisePerBase" DECIMAL(18,6) NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "batchNo" TEXT,
    "expiryDate" TIMESTAMP(3),

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRun" (
    "id" SERIAL NOT NULL,
    "runNo" TEXT NOT NULL,
    "bomId" INTEGER NOT NULL,
    "finishedItemId" INTEGER NOT NULL,
    "status" "RunStatus" NOT NULL,
    "batchCount" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "plannedOutputQty" INTEGER NOT NULL,
    "actualGoodQty" INTEGER,
    "rejectedFinishedQty" INTEGER NOT NULL DEFAULT 0,
    "yieldVarianceBp" INTEGER,
    "yieldFlagged" BOOLEAN NOT NULL DEFAULT false,
    "toleranceBpUsed" INTEGER NOT NULL,
    "materialCostPaise" INTEGER,
    "overheadCostPaise" INTEGER,
    "costPerPacketPaise" DECIMAL(14,4),
    "batchNo" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "startedById" INTEGER NOT NULL,
    "completedById" INTEGER,
    "notes" TEXT,

    CONSTRAINT "ProductionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRunLine" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "plannedQty" INTEGER NOT NULL,
    "issuedQty" INTEGER NOT NULL,
    "scrapQty" INTEGER NOT NULL DEFAULT 0,
    "varianceBp" INTEGER,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "ratePaisePerBase" DECIMAL(18,6) NOT NULL,
    "costPaise" INTEGER NOT NULL,

    CONSTRAINT "ProductionRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOverhead" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "kind" "OverheadKind" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "ProductionOverhead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "qtyChange" INTEGER NOT NULL,
    "ratePaisePerBase" DECIMAL(18,6),
    "valuePaise" INTEGER,
    "sourceType" "SourceType" NOT NULL,
    "sourceId" INTEGER,
    "sourceRef" TEXT,
    "batchNo" TEXT,
    "expiryDate" TIMESTAMP(3),
    "movementDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" INTEGER,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bom_finishedItemId_version_key" ON "Bom"("finishedItemId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BomLine_bomId_itemId_key" ON "BomLine"("bomId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_number_key" ON "Purchase"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRun_runNo_key" ON "ProductionRun"("runNo");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRunLine_runId_itemId_key" ON "ProductionRunLine"("runId", "itemId");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_movementDate_idx" ON "StockMovement"("itemId", "movementDate");

-- CreateIndex
CREATE INDEX "StockMovement_sourceType_sourceId_idx" ON "StockMovement"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_finishedItemId_fkey" FOREIGN KEY ("finishedItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_finishedItemId_fkey" FOREIGN KEY ("finishedItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRunLine" ADD CONSTRAINT "ProductionRunLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRunLine" ADD CONSTRAINT "ProductionRunLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOverhead" ADD CONSTRAINT "ProductionOverhead_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
