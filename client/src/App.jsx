import { useEffect, useState } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { api, getToken, setToken } from "./api.js";
import { checkVersion, onUpdateStatus, reloadNow } from "./autoUpdate.js";
import Login from "./components/Login.jsx";
import Main from "./components/Main.jsx";

const VERSION_CHECK_MS = 60 * 1000;

function UpdateBanner({ status }) {
  if (!status.pending) return null;
  return (
    <div className="update-banner" role="status">
      {status.reloading ? (
        "Updating to the newest version…"
      ) : (
        <>
          A new version is ready. It'll update when you leave the call.
          <button className="btn primary" onClick={reloadNow}>
            Update now
          </button>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [updateStatus, setUpdateStatus] = useState({ pending: false, reloading: false });

  useEffect(() => {
    api("/config")
      .then(setConfig)
      .catch(() => setConfig({ googleClientId: null, devLogin: false, iceServers: [], offline: true }));

    if (!getToken()) return setChecking(false);
    api("/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  // Auto-update: check for a new deploy now, every minute, and whenever the window comes back into focus.
  useEffect(() => {
    const unsubscribe = onUpdateStatus(setUpdateStatus);
    checkVersion();
    const timer = setInterval(checkVersion, VERSION_CHECK_MS);
    window.addEventListener("focus", checkVersion);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("focus", checkVersion);
    };
  }, []);

  if (!config || checking) return <div className="splash">Loading…</div>;

  const onAuth = ({ token, user }) => {
    setToken(token);
    setUser(user);
  };
  const logout = () => {
    setToken(null);
    setUser(null);
  };

  const banner = <UpdateBanner status={updateStatus} />;

  if (user) {
    return (
      <>
        {banner}
        <Main user={user} config={config} onLogout={logout} onUserChange={setUser} />
      </>
    );
  }

  const login = <Login config={config} onAuth={onAuth} />;
  return (
    <>
      {banner}
      {config.googleClientId ? <GoogleOAuthProvider clientId={config.googleClientId}>{login}</GoogleOAuthProvider> : login}
    </>
  );
}
