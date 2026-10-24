import { userOctokit, type Octokit } from "@bldt/github";
import { GitHub } from "arctic";
import type { Deps } from "../context.ts";
import { AppError } from "./errors.ts";

const githubReauth = () =>
  new AppError(401, "github_reauth", "Your GitHub connection expired. Sign in with GitHub again to continue.");

/** Octokit acting as the user, refreshing the user-to-server token when it is near expiry. */
export async function octokitForUser(deps: Deps, userId: string): Promise<Octokit> {
  const account = await deps.db.githubAccount.findUnique({ where: { userId } });
  if (!account) throw githubReauth();

  const expiresSoon = account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiresSoon) return userOctokit(deps.encrypter.decrypt(account.accessToken));
  if (!account.refreshToken) throw githubReauth();

  const client = new GitHub(deps.env.GITHUB_APP_CLIENT_ID, deps.env.GITHUB_APP_CLIENT_SECRET, null);
  try {
    const tokens = await client.refreshAccessToken(deps.encrypter.decrypt(account.refreshToken));
    const accessToken = tokens.accessToken();
    let tokenExpiresAt: Date | null = null;
    try {
      tokenExpiresAt = tokens.accessTokenExpiresAt();
    } catch {
      tokenExpiresAt = null;
    }
    await deps.db.githubAccount.update({
      where: { userId },
      data: {
        accessToken: deps.encrypter.encrypt(accessToken),
        // GitHub rotates refresh tokens; the old one is now invalid.
        refreshToken: tokens.hasRefreshToken() ? deps.encrypter.encrypt(tokens.refreshToken()) : null,
        tokenExpiresAt,
      },
    });
    return userOctokit(accessToken);
  } catch {
    throw githubReauth();
  }
}
