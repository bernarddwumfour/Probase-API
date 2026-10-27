/*
  Warnings:

  - Added the required column `businessName` to the `professional_profiles` table without a default value. This is not possible if the table is not empty.
  - Added the required column `latitude` to the `professional_profiles` table without a default value. This is not possible if the table is not empty.
  - Added the required column `longitude` to the `professional_profiles` table without a default value. This is not possible if the table is not empty.
  - Added the required column `professionId` to the `professional_profiles` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('unverified', 'pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RateUnit" AS ENUM ('hour', 'job', 'day');

-- AlterTable
ALTER TABLE "professional_profiles" ADD COLUMN     "address" TEXT,
ADD COLUMN     "businessName" TEXT NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "longitude" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "operationalRadiusKm" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "professionId" UUID NOT NULL,
ADD COLUMN     "ratingAverage" DECIMAL(3,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'unverified';

-- CreateTable
CREATE TABLE "professions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "iconUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "professions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_preferred_professions" (
    "customerId" UUID NOT NULL,
    "professionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_preferred_professions_pkey" PRIMARY KEY ("customerId","professionId")
);

-- CreateTable
CREATE TABLE "saved_locations" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "searchRadiusKm" INTEGER NOT NULL DEFAULT 2,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_days" (
    "id" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "isOpen" BOOLEAN NOT NULL,
    "opensAt" TEXT,
    "closesAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "working_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rate" DECIMAL(10,2) NOT NULL,
    "rateUnit" "RateUnit" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "professions_name_key" ON "professions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "professions_slug_key" ON "professions"("slug");

-- CreateIndex
CREATE INDEX "saved_locations_customerId_idx" ON "saved_locations"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "working_days_professionalId_dayOfWeek_key" ON "working_days"("professionalId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "services_professionalId_idx" ON "services"("professionalId");

-- CreateIndex
CREATE INDEX "professional_profiles_professionId_idx" ON "professional_profiles"("professionId");

-- AddForeignKey
ALTER TABLE "customer_preferred_professions" ADD CONSTRAINT "customer_preferred_professions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_preferred_professions" ADD CONSTRAINT "customer_preferred_professions_professionId_fkey" FOREIGN KEY ("professionId") REFERENCES "professions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_locations" ADD CONSTRAINT "saved_locations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_professionId_fkey" FOREIGN KEY ("professionId") REFERENCES "professions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_days" ADD CONSTRAINT "working_days_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one default location per customer
CREATE UNIQUE INDEX "saved_locations_one_default_per_customer"
  ON "saved_locations" ("customerId") WHERE "isDefault";

-- Data sanity backstops
ALTER TABLE "working_days"
  ADD CONSTRAINT "working_days_dayOfWeek_range" CHECK ("dayOfWeek" BETWEEN 0 AND 6);
ALTER TABLE "services"
  ADD CONSTRAINT "services_rate_nonnegative" CHECK ("rate" >= 0);