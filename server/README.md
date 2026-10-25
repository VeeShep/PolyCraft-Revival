# PolyCraft room service

This small Node service lets Beta 8 players join by **room name and password**, without copying WebRTC invitations/replies. It exchanges connection information; it does not simulate an island, relay gameplay or store saves. No service is automatically deployed by the game.

## Local development

Use Node.js 22.18+ within the 22.x line, or Node.js 24.11+, from the repository root:

```sh
npm ci
npm run start:rooms
```

Expected output:

```text
PolyCraft room service listening on 127.0.0.1:37842
```

Check the backend without opening a game:

```sh
curl http://127.0.0.1:37842/health
```

Expected response: `PolyCraft room service ready`.

For a local two-window test, configure both games with `ws://127.0.0.1:37842/signaling`. Loopback plaintext is allowed only for development. Do not run graphical tests until the user resumes them; use visible, labelled disposable islands and `POLYCRAFT_TEST_DATA` when doing so.

## Internet hosting

Use a server you control with a supported Node.js version above, a domain pointing to that server, and an HTTPS/WebSocket reverse proxy. The Node process deliberately listens only on `127.0.0.1`; keep port 37842 private. Players connect through a publicly trusted TLS certificate on port 443. Remote `ws://`, URL passwords and query-string credentials are rejected by the app.

From a checked-out copy of this repository, production dependencies and the server can be started with:

```sh
npm ci --omit=dev
POLYCRAFT_TRUST_PROXY=1 npm run start:rooms
```

`POLYCRAFT_TRUST_PROXY=1` enables client-IP rate accounting from `X-Forwarded-For` **only when the proxy connects from loopback**. Use a local reverse proxy that overwrites that header with the real client address. Leave this option off for direct local development. `PORT` can change the private listening port; update the proxy to match.

For example, with [Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy), replace the sample domain in `server/Caddyfile.example` with your own domain and use it in your Caddy configuration. DNS must point to the host and ports 80/443 must reach Caddy for normal automatic public certificate issuance. Caddy handles WebSocket upgrades. Run the Node process under your existing service manager with automatic restart; run it as an unprivileged user. Caddy and the Node process need to remain running.

Players then configure the same address once:

```text
wss://rooms.your-domain.example/signaling
```

The game remembers only that server URL. Room names/passwords and TURN credentials are not written to island saves or local settings. The service logs its startup address only; avoid adding proxy logging that captures WebSocket bodies, passwords, SDP, candidates or tokens. No provider API key is required for this version because automatic TURN credential issuance is not yet implemented.

## Player flow

1. Both players use matching Beta 8 builds and a Beta 8 room service (signaling protocol 2; Beta 6/7 services are incompatible) and enter disposable islands through **Play**.
2. Open **Multiplayer** and enter the same room-server address.
3. The host chooses a room name such as `poopedpants123`, enters a password such as `giggle shits`, then clicks **Host room** and accepts the development warning.
4. The guest enters that room name/password and a guest name, clicks **Join room**, then accepts the warning. Room names are case-insensitive; passwords preserve spaces and capitals exactly.
5. The host selects the incoming request, chooses **Create a new guest hero** or an existing saved guest hero, and clicks **Approve guest**. Only the host assigns island heroes. Reconnecting players should be assigned the same saved hero. Up to three guests may join.
6. Offers, replies and ICE candidates exchange automatically. Return to the game once connected. The host can use **Decline / disconnect guest**. **End / leave session** restores solo play; the host saves before ending.

A room name is 3–48 letters/numbers/dashes/underscores and must be unused while its host is connected. Passwords require 8–128 characters. The example password is illustrative, not a built-in password.

Room mode defaults to `stun:stun.l.google.com:19302`. Override it under **Internet connection settings → STUN URLs**. No default TURN server or shared public TURN credentials are embedded. Room hosting prepares the native TCP/TLS listener and tries a known or STUN-discovered address first, then opt-in UPnP, direct STUN/ICE and finally configured TURN. TURN URLs and credentials are absent from the direct WebRTC attempt. Either endpoint may supply TURN settings; credentials are never forwarded to other players through signaling. The host checks each connection before assigning its selected saved hero. Failed probes close before fallback; after route commitment, failure ends that join rather than attaching a second hero. Temporary provider credential issuance remains unimplemented. Manual invitation mode still supports blank ICE settings for service-free LAN use.

## Limits, lifecycle and remaining acceptance

- Rooms and salted scrypt password verifiers exist in memory only. Hosts are authorized by their creating WebSocket connection; knowing a room name/password does not grant host control or select a saved hero.
- Default limits: 200 rooms, 1,000 connected signaling sockets, three guests/pending joins per room, 12-hour room lifetime, eight concurrent password derivations, 192 KiB message cap, 512 KiB outgoing-buffer cap, 40 messages/second per socket and 256 combined trickled candidates per route attempt (128 per peer). Legacy manual signaling retains its 128-candidate socket cap. Per-IP request accounting allows 30 upgrade/authentication operations per minute; a normal connection consumes an upgrade and an authentication operation. Bursts may need retrying.
- Failed authentication, incompatible versions, malformed/oversized/unauthorized signaling and rate-limit violations close the offending socket. A socket cannot forward gameplay snapshots or commands; its message types are limited to bounded route offers/answers/candidates, readiness/selection/cancellation controls and host rejection. Each route has a fresh identifier and increasing stage; stale controls are ignored. Only the host can select a route, and no new route can replace a committed one in this release.
- Pings run every 30 seconds. Closed hosts remove their rooms. Server restart, expiry or signaling loss makes new joins unavailable; established TCP/TLS or WebRTC game links continue without signaling. Recreate the room/session to accept new guests after recovery. Manual invitations remain available independently.
- The service sees connection metadata and handles the password transiently during authentication. It keeps a salted verifier, not plaintext password storage. WSS protects the client-to-service connection; this is not end-to-end-encrypted signaling against the service operator. Trust your room-service operator.
- Current evidence is local non-GUI transport/controller tests. Public TLS deployment, physical two/four-player joining, actual browser/Electron ICE behavior, native-platform gameplay, load/cost measurements and physical forwarding/UPnP/TURN fallback acceptance remain open. Initial route budgets are provisional: forwarded TCP 3 s, UPnP mapping 3 s plus connection 3 s, STUN-direct 6 s, TURN 10 s and admission 8 s, with an overall 30 s deadline after approval. Failures can end earlier; tuning against real networks remains required. Native host preparation may first spend up to 3 s discovering its public IP. No bandwidth or memory-capacity guarantee is made from these configured limits.

STUN can discover a public IP to try with a **separately configured external TCP port**; a successful STUN reply does not prove a forward is reachable. STUN's mapped UDP port is not the native TCP listener's port. Beta 7 adds a manual native address-discovery button using the chosen UDP STUN server (Google by default), with a three-second deadline and no TCP-port changes. Beta 8 uses this discovery automatically when the room host address is blank, keeps manual address overrides, and attempts TCP using the separately selected port. UPnP is disabled by default and requires the host checkbox; an existing port mapping is left alone. Router operations have a bounded wait, but the underlying mapper cannot abort HTTP: late results are cleaned up when they finish, and crash recovery relies on the finite 20-minute lease. No real router has been tested.
