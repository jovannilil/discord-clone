# Discord Clone

A starter Discord clone: Google login, servers with invite codes, real-time text channels,
and voice channels with camera + screen sharing.

**Stack:** React (Vite) · Node.js + Express · Socket.IO · SQLite (built into Node 22.13+) · WebRTC

## Features

- **Login**: Sign in with Google (plus a username-only dev login for local testing)
- **Servers**: create a server, share its invite code, join others' servers
- **Text channels**: real-time messages, history with "load older", typing indicators, message grouping
- **Presence**: online/offline member list that updates live
- **Voice channels**: join to talk; turn on your camera or share your screen; mute; see who's in each channel from the sidebar
- Audio keeps playing while you browse other channels or servers, just like Discord

## Live app

- **Website:** https://discord-clone-oxb2.onrender.com (hosted on Render's free plan, database on Neon)
- **Desktop app:** run `npm run desktop:installer`, then share `desktop/dist/Discord-Clone-Setup-1.0.0.exe`.
  The desktop app loads the website, so it always shows the newest version.
- The free server sleeps after 15 minutes without visitors; the first visit after that takes up to a minute.

### Shipping an update

Commit your changes, then run:

```bash
npm run ship
```

This pushes to GitHub and triggers a Render redeploy (via the private deploy hook in `.deploy-hook`,
which is git-ignored). Everyone gets the new version within a few minutes.

### Letting friends log in

While the Google OAuth app is in "Testing" mode, only listed test users can sign in. Add their Gmail
addresses in Google Cloud Console → Google Auth Platform → Audience → Test users (up to 100).

## Quick start

Requires **Node.js 22.13 or newer** (`node -v`).

```bash
npm run setup     # installs root, server and client dependencies
npm run dev       # starts the server (:3001) and the React app (:5173)
```

Open http://localhost:5173.

`server/.env` is where settings live (copy `server/.env.example` if it's missing).

## Setting up Google login

1. Go to https://console.cloud.google.com/ and create a project (or pick one).
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, and save.
   While the app is in "Testing" mode, add your Google account(s) under *Test users*.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: add **both** `http://localhost:5173` and `http://localhost`
     (and later your real domain, e.g. `https://chat.example.com`)
   - No redirect URIs needed.
4. Copy the **Client ID** (looks like `1234-abc.apps.googleusercontent.com`) into `server/.env`:
   ```
   GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
   ```
5. Restart `npm run dev`. The "Continue with Google" button appears on the login page.

How it works: the browser gets a signed ID token from Google, sends it to `POST /api/auth/google`,
the server verifies it with `google-auth-library`, creates/updates the user, and returns its own JWT.
The JWT is used for every API call and the Socket.IO connection.

## Testing calls on one computer

Logins are stored per **tab**, so you can open two tabs and log in as two different users
(use the dev login for the second one, or a second Google account). Create a server in one,
join with the invite code in the other, then both click the **General** voice channel.

Two tabs on the same machine will hear each other, so use headphones or mute one.

## How the pieces fit

```
client/src/
  components/Main.jsx        app shell, socket connection, realtime event handling
  components/ChatView.jsx    messages, composer, typing indicator
  components/VoiceView.jsx   call grid + controls
  voice/useVoice.js          all the WebRTC logic (mesh of peer connections)
server/src/
  index.js                   REST API (auth, servers, channels, message history)
  realtime.js                Socket.IO: messages, typing, presence, voice signaling
  auth.js                    Google token verification, JWT
  db.js                      SQLite schema
```

**Voice/video**: each participant opens a direct WebRTC connection to every other participant
("mesh"). The server only relays the setup messages (`voice:signal`). This works well up to
about 5–6 people. For bigger rooms, switch to an SFU such as [LiveKit](https://livekit.io).

## Going to production

- `npm run build`, then `NODE_ENV=production npm start`. The server serves the built app on one port.
- Set a long random `JWT_SECRET`. Dev login is automatically off in production.
- Serve over **HTTPS**: browsers only allow mic/camera on HTTPS (or localhost).
- Add a **TURN server** (e.g. coturn, or a hosted one like Twilio or Metered) via `TURN_URL`,
  `TURN_USERNAME` and `TURN_CREDENTIAL`. Without one, some users behind strict networks can't connect.
- Add your domain to the Google OAuth client's authorized JavaScript origins.

## Ideas for next steps

- Direct messages + 1-on-1 calls with a ringing screen
- Speaking indicator (green ring) using the Web Audio `AnalyserNode`
- Edit/delete messages, reactions, replies
- File and image uploads (S3 / Cloudflare R2)
- Roles and permissions, kicking/banning
- Unread badges and notifications
- Swap SQLite for PostgreSQL and the mesh for LiveKit when you outgrow them
