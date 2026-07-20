-- AlterTable
ALTER TABLE "user" ADD COLUMN     "availableFor" TEXT,
ADD COLUMN     "currentlyHackingOn" TEXT,
ADD COLUMN     "currentlyLearning" TEXT,
ADD COLUMN     "displayEmailOnProfile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "facebookUsername" TEXT,
ADD COLUMN     "instagramUsername" TEXT,
ADD COLUMN     "mastodonUsername" TEXT,
ADD COLUMN     "profileBgImage" TEXT,
ADD COLUMN     "pronouns" TEXT,
ADD COLUMN     "twitchUsername" TEXT,
ADD COLUMN     "youtubeUrl" TEXT;
