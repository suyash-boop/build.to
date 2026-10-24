-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('BROWSER', 'DEVICE');

-- CreateEnum
CREATE TYPE "DeviceAuthStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CONSUMED');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "kind" "SessionKind" NOT NULL DEFAULT 'BROWSER';

-- CreateTable
CREATE TABLE "DeviceAuthorization" (
    "id" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "status" "DeviceAuthStatus" NOT NULL DEFAULT 'PENDING',
    "userId" UUID,
    "ip" TEXT,
    "intervalSec" INTEGER NOT NULL DEFAULT 5,
    "lastPolledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthorization_userCode_key" ON "DeviceAuthorization"("userCode");

-- CreateIndex
CREATE INDEX "DeviceAuthorization_expiresAt_idx" ON "DeviceAuthorization"("expiresAt");

-- AddForeignKey
ALTER TABLE "DeviceAuthorization" ADD CONSTRAINT "DeviceAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
