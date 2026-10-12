// In development the login is kept per tab (sessionStorage), so two tabs can be two different users
// for testing chat and calls. In production it's remembered (localStorage), so you stay logged in.
const TOKEN_KEY = "token";
const store = import.meta.env.DEV ? sessionStorage : localStorage;

export const getToken = () => store.getItem(TOKEN_KEY);

export const setToken = (token) => (token ? store.setItem(TOKEN_KEY, token) : store.removeItem(TOKEN_KEY));

export async function api(path, { method = "GET", body } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Uploads one file to a channel; resolves to { id, filename, mime, size, url }. Send its id with the message. */
export async function uploadFile(channelId, file) {
  const token = getToken();
  const res = await fetch(`/api/channels/${channelId}/attachments`, {
    method: "POST",
    headers: {
      // Always octet-stream so the server's JSON parser leaves the file alone; the real type goes in X-File-Type.
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name || "file"),
      "X-File-Type": file.type || "application/octet-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 413 ? "That file is too big (10 MB max)" : data.error || res.statusText);
  return data;
}
