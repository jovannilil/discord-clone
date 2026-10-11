import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { api } from "../api.js";
import { DESKTOP_DOWNLOAD_URL, showDesktopDownload } from "../desktop.js";
import { DownloadIcon } from "./icons.jsx";

export default function Login({ config, onAuth }) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(request) {
    setBusy(true);
    setError(null);
    try {
      onAuth(await request());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Welcome back!</h1>
        <p className="muted">Sign in to start chatting.</p>

        {config.offline && <div className="notice">Can't reach the server. Is it running?</div>}

        {config.googleClientId ? (
          <div className="google-btn">
            <GoogleLogin
              theme="filled_black"
              shape="pill"
              text="continue_with"
              onSuccess={({ credential }) =>
                run(() => api("/auth/google", { method: "POST", body: { credential } }))
              }
              onError={() => setError("Google sign-in failed")}
            />
          </div>
        ) : (
          !config.offline && (
            <div className="notice">
              Google login isn't set up yet. Put your <code>GOOGLE_CLIENT_ID</code> in{" "}
              <code>server/.env</code> and restart (see README).
            </div>
          )
        )}

        {config.devLogin && (
          <>
            <div className="divider">
              <span>or, for local testing</span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (username.trim()) run(() => api("/auth/dev", { method: "POST", body: { username } }));
              }}
            >
              <label htmlFor="dev-username">Dev login (no password, turn off in production)</label>
              <input
                id="dev-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Pick a username"
                maxLength={32}
                autoComplete="off"
              />
              <button className="btn primary full" disabled={busy || !username.trim()}>
                Continue
              </button>
            </form>
          </>
        )}

        {error && <p className="error">{error}</p>}

        {showDesktopDownload && (
          <a className="btn download-app full" href={DESKTOP_DOWNLOAD_URL}>
            <DownloadIcon size={18} /> Download the desktop app for Windows
          </a>
        )}

        <p className="legal-links muted small">
          <a href="/privacy.html">Privacy Policy</a> · <a href="/terms.html">Terms of Service</a>
        </p>
      </div>
    </div>
  );
}
