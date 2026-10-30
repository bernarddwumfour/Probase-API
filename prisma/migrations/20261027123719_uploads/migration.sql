-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('avatar', 'portfolio', 'verification');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'consumed');

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "UploadPurpose" NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uploads_key_key" ON "uploads"("key");

-- CreateIndex
CREATE INDEX "uploads_userId_status_idx" ON "uploads"("userId", "status");

-- CreateIndex
CREATE INDEX "uploads_status_expiresAt_idx" ON "uploads"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
