-- CreateTable
CREATE TABLE "saved_professionals" (
    "customerId" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_professionals_pkey" PRIMARY KEY ("customerId","professionalId")
);

-- CreateIndex
CREATE INDEX "saved_professionals_professionalId_idx" ON "saved_professionals"("professionalId");

-- AddForeignKey
ALTER TABLE "saved_professionals" ADD CONSTRAINT "saved_professionals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_professionals" ADD CONSTRAINT "saved_professionals_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
