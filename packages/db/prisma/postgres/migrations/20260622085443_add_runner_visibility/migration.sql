-- AlterTable
ALTER TABLE "RunnerProfile" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'personal';

-- CreateTable
CREATE TABLE "RunnerProjectVisibility" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunnerProjectVisibility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunnerProjectVisibility_projectId_idx" ON "RunnerProjectVisibility"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "RunnerProjectVisibility_runnerId_projectId_key" ON "RunnerProjectVisibility"("runnerId", "projectId");

-- AddForeignKey
ALTER TABLE "RunnerProjectVisibility" ADD CONSTRAINT "RunnerProjectVisibility_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "RunnerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunnerProjectVisibility" ADD CONSTRAINT "RunnerProjectVisibility_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
