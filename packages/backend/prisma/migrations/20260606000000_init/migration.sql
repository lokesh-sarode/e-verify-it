CREATE TYPE "VerificationCategory" AS ENUM ('valid', 'invalid', 'risky', 'unknown');
CREATE TYPE "ResultSource" AS ENUM ('single', 'bulk');
CREATE TYPE "BulkJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE "BulkJobMode" AS ENUM ('reacher_bulk', 'local_worker');
CREATE TYPE "BulkEmailStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'skipped');
CREATE TYPE "UploadRejectedReason" AS ENUM ('empty', 'duplicate', 'invalid_syntax');
CREATE TYPE "AuditAction" AS ENUM ('login', 'upload', 'download', 'single_verification');

CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationResult" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "category" "VerificationCategory" NOT NULL,
  "isReachable" BOOLEAN,
  "syntaxStatus" TEXT,
  "mxStatus" TEXT,
  "smtpStatus" TEXT,
  "smtpResult" TEXT,
  "catchAll" BOOLEAN,
  "disposable" BOOLEAN,
  "roleAccount" BOOLEAN,
  "freeProvider" BOOLEAN,
  "reason" TEXT,
  "rawJson" JSONB NOT NULL,
  "source" "ResultSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkJob" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "status" "BulkJobStatus" NOT NULL DEFAULT 'pending',
  "mode" "BulkJobMode",
  "reacherJobId" TEXT,
  "originalRows" INTEGER NOT NULL DEFAULT 0,
  "emptyRows" INTEGER NOT NULL DEFAULT 0,
  "duplicateRows" INTEGER NOT NULL DEFAULT 0,
  "syntaxInvalidRows" INTEGER NOT NULL DEFAULT 0,
  "uniqueEmails" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "validCount" INTEGER NOT NULL DEFAULT 0,
  "invalidCount" INTEGER NOT NULL DEFAULT 0,
  "riskyCount" INTEGER NOT NULL DEFAULT 0,
  "unknownCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "BulkJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkJobEmail" (
  "id" TEXT NOT NULL,
  "bulkJobId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "status" "BulkEmailStatus" NOT NULL DEFAULT 'pending',
  "category" "VerificationCategory",
  "isReachable" BOOLEAN,
  "syntaxStatus" TEXT,
  "mxStatus" TEXT,
  "smtpStatus" TEXT,
  "smtpResult" TEXT,
  "reason" TEXT,
  "rawJson" JSONB,
  "errorMessage" TEXT,
  "checkedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BulkJobEmail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UploadRejectedRow" (
  "id" TEXT NOT NULL,
  "bulkJobId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "emailRaw" TEXT,
  "reason" "UploadRejectedReason" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadRejectedRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "adminId" TEXT,
  "action" "AuditAction" NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
CREATE INDEX "VerificationResult_normalizedEmail_idx" ON "VerificationResult"("normalizedEmail");
CREATE INDEX "VerificationResult_category_idx" ON "VerificationResult"("category");
CREATE INDEX "VerificationResult_createdAt_idx" ON "VerificationResult"("createdAt");
CREATE INDEX "BulkJob_status_idx" ON "BulkJob"("status");
CREATE INDEX "BulkJob_createdAt_idx" ON "BulkJob"("createdAt");
CREATE UNIQUE INDEX "BulkJobEmail_bulkJobId_normalizedEmail_key" ON "BulkJobEmail"("bulkJobId", "normalizedEmail");
CREATE INDEX "BulkJobEmail_bulkJobId_idx" ON "BulkJobEmail"("bulkJobId");
CREATE INDEX "BulkJobEmail_normalizedEmail_idx" ON "BulkJobEmail"("normalizedEmail");
CREATE INDEX "BulkJobEmail_status_idx" ON "BulkJobEmail"("status");
CREATE INDEX "BulkJobEmail_category_idx" ON "BulkJobEmail"("category");
CREATE INDEX "BulkJobEmail_createdAt_idx" ON "BulkJobEmail"("createdAt");
CREATE INDEX "UploadRejectedRow_bulkJobId_idx" ON "UploadRejectedRow"("bulkJobId");
CREATE INDEX "UploadRejectedRow_reason_idx" ON "UploadRejectedRow"("reason");
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

ALTER TABLE "BulkJobEmail" ADD CONSTRAINT "BulkJobEmail_bulkJobId_fkey" FOREIGN KEY ("bulkJobId") REFERENCES "BulkJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UploadRejectedRow" ADD CONSTRAINT "UploadRejectedRow_bulkJobId_fkey" FOREIGN KEY ("bulkJobId") REFERENCES "BulkJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

