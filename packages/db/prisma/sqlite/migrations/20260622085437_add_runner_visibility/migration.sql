-- CreateTable
CREATE TABLE "RunnerProjectVisibility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runnerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunnerProjectVisibility_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "RunnerProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RunnerProjectVisibility_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RunnerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'personal',
    "adapter" TEXT,
    "version" TEXT,
    "capabilities" JSONB,
    "lastHeartbeatAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunnerProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RunnerProfile" ("adapter", "capabilities", "createdAt", "id", "lastHeartbeatAt", "name", "ownerId", "projectId", "status", "updatedAt", "version") SELECT "adapter", "capabilities", "createdAt", "id", "lastHeartbeatAt", "name", "ownerId", "projectId", "status", "updatedAt", "version" FROM "RunnerProfile";
DROP TABLE "RunnerProfile";
ALTER TABLE "new_RunnerProfile" RENAME TO "RunnerProfile";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RunnerProjectVisibility_projectId_idx" ON "RunnerProjectVisibility"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "RunnerProjectVisibility_runnerId_projectId_key" ON "RunnerProjectVisibility"("runnerId", "projectId");
