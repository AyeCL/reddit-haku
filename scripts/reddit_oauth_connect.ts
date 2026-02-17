import { createServer } from "http";
import { randomBytes } from "crypto";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { encryptString } from "../src/security/crypto";

config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function exchangeCodeForRefreshToken(code: string): Promise<{ refreshToken: string; accessToken: string }> {
  const clientId = required("REDDIT_CLIENT_ID");
  const clientSecret = required("REDDIT_CLIENT_SECRET");
  const redirectUri = required("REDDIT_OAUTH_REDIRECT_URI");

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": process.env.REDDIT_USER_AGENT ?? "haku-oauth-script"
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth token exchange failed: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
  };

  if (!payload.refresh_token || !payload.access_token) {
    throw new Error("OAuth response missing refresh_token or access_token");
  }

  return {
    refreshToken: payload.refresh_token,
    accessToken: payload.access_token
  };
}

async function maybePersistToken(refreshToken: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.REDDIT_TOKEN_ENCRYPTION_KEY;
  const username = process.env.REDDIT_ACCOUNT_USERNAME;

  if (!databaseUrl || !encryptionKey || !username) {
    console.log(
      "\nSkipping DB token persistence (set DATABASE_URL + REDDIT_TOKEN_ENCRYPTION_KEY + REDDIT_ACCOUNT_USERNAME to enable)."
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    const encrypted = encryptString(refreshToken, encryptionKey);
    await prisma.redditAuthCredential.upsert({
      where: { redditUsername: username },
      update: {
        refreshTokenEnc: encrypted,
        scope: "identity read submit",
        isActive: true
      },
      create: {
        redditUsername: username,
        refreshTokenEnc: encrypted,
        scope: "identity read submit",
        isActive: true
      }
    });

    console.log(`Stored encrypted refresh token in DB for reddit user: ${username}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const clientId = required("REDDIT_CLIENT_ID");
  const redirectUri = required("REDDIT_OAUTH_REDIRECT_URI");
  const scopes = "identity read submit";
  const state = randomBytes(16).toString("hex");

  const authUrl = new URL("https://www.reddit.com/api/v1/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("duration", "permanent");
  authUrl.searchParams.set("scope", scopes);

  const callback = new URL(redirectUri);
  const port = Number(callback.port || "8787");
  const host = callback.hostname;

  console.log("Open this URL in your browser and approve access:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting for callback...");

  const server = createServer((req, res) => {
    const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const code = reqUrl.searchParams.get("code");
    const incomingState = reqUrl.searchParams.get("state");
    const error = reqUrl.searchParams.get("error");

    if (error) {
      res.statusCode = 400;
      res.end(`OAuth error: ${error}`);
      throw new Error(`OAuth callback error: ${error}`);
    }

    if (incomingState !== state) {
      res.statusCode = 400;
      res.end("State mismatch");
      throw new Error("OAuth state mismatch");
    }

    if (!code) {
      res.statusCode = 400;
      res.end("Missing code");
      throw new Error("OAuth code missing");
    }

    void exchangeCodeForRefreshToken(code)
      .then(async ({ refreshToken }) => {
        res.statusCode = 200;
        res.end("OAuth success. Return to terminal.");

        console.log("\nSet this in your .env if you are using env-token mode:");
        console.log(`REDDIT_REFRESH_TOKEN=${refreshToken}`);

        await maybePersistToken(refreshToken);
      })
      .catch((exchangeError) => {
        res.statusCode = 500;
        res.end("Token exchange failed. Check terminal logs.");
        console.error(exchangeError);
      })
      .finally(() => {
        server.close();
      });
  });

  server.listen(port, host, () => {
    console.log(`OAuth callback server listening on http://${host}:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
