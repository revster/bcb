-- CreateTable
CREATE TABLE "NominationPeriod" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "openToAll" BOOLEAN NOT NULL,
    "nominatorId" TEXT,
    "nominatorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "NominationPeriod_month_year_key" ON "NominationPeriod"("month", "year");
