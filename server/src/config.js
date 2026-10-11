import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";

const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
if (process.env.TURN_URL) {
  iceServers.push({
    urls: process.env.TURN_URL,
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL,
  });
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  isProd,
  jwtSecret: process.env.JWT_SECRET || (isProd ? null : "dev-only-secret-change-me"),
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  devLogin: process.env.DEV_LOGIN ? process.env.DEV_LOGIN === "true" : !isProd,
  iceServers,
};

if (!config.jwtSecret) throw new Error("JWT_SECRET must be set in production");
