-- AlterTable
ALTER TABLE "WorkItemComment" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "WorkItemComment_workItemId_idx" ON "WorkItemComment"("workItemId");

-- CreateIndex
CREATE INDEX "WorkItemComment_authorId_idx" ON "WorkItemComment"("authorId");

-- AddForeignKey
ALTER TABLE "WorkItemComment" ADD CONSTRAINT "WorkItemComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
