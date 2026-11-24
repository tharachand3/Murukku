-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "qtyChange" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_number_key" ON "StockAdjustment"("number");

-- CreateIndex
CREATE INDEX "StockAdjustment_itemId_createdAt_idx" ON "StockAdjustment"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
