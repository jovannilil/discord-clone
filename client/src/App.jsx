import { useEffect, useState } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { api, getToken, setToken } from "./api.js";
import Login from "./components/Login.jsx";
import Main from "./components/Main.jsx";

export default function App() {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

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

  if (!config || checking) return <div className="splash">Loading…</div>;

  const onAuth = ({ token, user }) => {
    setToken(token);
    setUser(user);
  };
  const logout = () => {
    setToken(null);
    setUser(null);
  };

  if (user) return <Main user={user} config={config} onLogout={logout} />;

  const login = <Login config={config} onAuth={onAuth} />;
  return config.googleClientId ? (
    <GoogleOAuthProvider clientId={config.googleClientId}>{login}</GoogleOAuthProvider>
  ) : (
    login
  );
}
