CREATE TYPE "AiProviderMode" AS ENUM ('gateway', 'direct');

ALTER TABLE "appSetting"
ADD COLUMN "aiProviderMode" "AiProviderMode" NOT NULL DEFAULT 'gateway',
ADD COLUMN "directModelId" TEXT,
ADD COLUMN "directModelContextWindow" INTEGER,
ADD COLUMN "openaiApiKeyEncrypted" TEXT,
ADD COLUMN "anthropicApiKeyEncrypted" TEXT;
