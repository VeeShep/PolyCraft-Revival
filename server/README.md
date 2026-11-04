# PolyCraft room service

This small Node service lets Beta 37 players join by **room name and password**, without copying WebRTC invitations/replies. It exchanges connection information; it does not simulate an island, relay gameplay or store saves. No service is automatically deployed by the game.

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

The game remembers only that server URL. Room names/passwords and TURN credentials are not written to island saves or local settings. The service logs its startup address only; avoid adding proxy logging that captures WebSocket bodies, passwords, SDP, candidates or tokens. Optional coturn credential issuance uses a private shared secret in the server environment; it is never sent to players or included in app packages.

## Player flow

1. Both players use Beta 37 builds and an updated room service (signaling protocol 3; earlier services are incompatible) and enter disposable islands through **Play**.
2. Open **Multiplayer** and enter the same room-server address.
3. The host chooses a room name such as `poopedpants123`, enters a password such as `giggle shits`, then clicks **Host room** and accepts the development warning.
4. The guest enters that room name/password and a guest name, clicks **Join room**, then accepts the warning. Room names are case-insensitive; passwords preserve spaces and capitals exactly.
5. The host selects the incoming request, chooses **Create a new guest hero** or an existing saved guest hero, and clicks **Approve guest**. Only the host assigns island heroes. Reconnecting players should be assigned the same saved hero. Up to three guests may join.
6. Offers, replies and ICE candidates exchange automatically. Return to the game once connected. The host can use **Decline / disconnect guest**. **End / leave session** restores solo play; the host saves before ending.

A room name is 3–48 letters/numbers/dashes/underscores and must be unused while its host is connected. Passwords require 8–128 characters. The example password is illustrative, not a built-in password.

Room mode defaults to `stun:stun.l.google.com:19302`. Override it under **Internet connection settings → STUN URLs**. No default TURN server or shared public TURN credentials are embedded. Room hosting prepares the native TCP/TLS listener and tries a known or STUN-discovered address first, then opt-in UPnP, direct STUN/ICE and finally configured TURN. TURN URLs and credentials are absent from the direct WebRTC attempt. Either endpoint may supply TURN settings; player-entered credentials are never forwarded to other players through signaling. Optional service credentials are issued separately to each participant through its authenticated room socket. The host checks each connection before assigning its selected saved hero. Failed probes close before fallback; after route commitment, failure ends that join rather than attaching a second hero. Beta 37 room protocol 3 optionally requests temporary coturn credentials at the TURN fallback stage. A service without this configuration still supports player-configured TURN. Manual invitation mode still supports blank ICE settings for service-free LAN use.

## Optional temporary TURN credentials (Beta 37, room protocol 3)

This works with a coturn service you operate, using its documented [TURN REST authentication](https://github.com/coturn/coturn/blob/master/README.turnserver). The room service issues timestamped HMAC-SHA1 credentials; the permanent shared secret stays in the server environment and coturn configuration. No hosted relay, account or public endpoint is supplied.

1. Install coturn on your chosen host and use [turnserver.conf.example](turnserver.conf.example) as a **bounded test template**. Set your realm/domain, public/listening addresses and the same private secret in `static-auth-secret` and the room service environment. Generate a random secret with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'`. Keep the configured files outside Git with restricted permissions. The template leaves its secret unset; it cannot provide authenticated relay access until configured.
2. Configure a publicly trusted certificate/key for `turns:`. TURN listeners connect directly to coturn; the HTTP/WebSocket reverse proxy handles the room service only. Permit the chosen TURN UDP/TCP listener ports (example 3478), TLS/TCP port (example 5349), and UDP relay range (example 49160–49259) through the host firewall/NAT. Configure coturn `external-ip` if required by your network. The template disables TCP peer allocations (TURN client connections over TCP/TLS still work) and denies private/local peer networks using coturn's [peer access rules](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf). Keep those restrictions unless a reviewed network design requires an exception. Use coturn's allocation and bandwidth controls and restrict the service to intended testers; the sample allocation limits are not a 100-group capacity claim.
3. Set these environment variables for the existing room-service process (the application does not automatically load an `.env` file):

   ```text
   POLYCRAFT_TURN_URLS=turn:turn.example.net:3478?transport=udp,turns:turn.example.net:5349?transport=tcp
   POLYCRAFT_TURN_SECRET=<the same private generated secret>
   POLYCRAFT_TURN_TTL=21600
   ```

   URLs are comma-separated TURN URLs only. Both URLs and secret are required; invalid configuration stops startup. Lifetime is 60–21600 seconds, default six hours, additionally capped by room expiry. Credentials are not issued when less than 30 seconds remain. They can remain usable until expiry after a room closes; they are not an instantaneous revocation system. Long-session credential renewal/provider-specific APIs are not implemented.
4. Restart the room service through your existing service manager. Use Beta 37 games and protocol-3 room service together. Leave manual TURN fields blank to use service credentials. Existing manual invitations still work independently; player-entered TURN settings take precedence.

After host approval, forwarding/UPnP/STUN-direct run first. Only a failed, server-visible direct WebRTC attempt permits the host to request one credential pair for that guest. A failed offer preparation ends only that join. Each participant receives a different temporary username/password over WSS. They enter only the TURN connection configuration, never the earlier STUN attempt or another guest's attempt. The credential wait is bounded by two seconds and the overall join deadline; successful direct connections request no credentials or relay allocation. Room/credential request quotas still apply.

Check `/health` as above, then use disposable islands for physical acceptance once graphical tests resume. Verify direct success, forced fallback, reported direct/relayed path, credential expiry and reconnect with your actual coturn configuration. Current tests use real local room sockets and mocked game peers, not a running relay. No deployment, public DNS/certificates, firewall changes, bandwidth capacity or native/physical-network gameplay is verified by these fixtures.

## Limits, lifecycle and remaining acceptance

- Rooms and salted scrypt password verifiers exist in memory only. Hosts are authorized by their creating WebSocket connection; knowing a room name/password does not grant host control or select a saved hero.
- Default limits: 200 rooms, 1,000 connected signaling sockets, three guests/pending joins per room, 12-hour room lifetime, eight concurrent password derivations, 192 KiB message cap, 512 KiB outgoing-buffer cap, 40 messages/second per socket and 256 combined trickled candidates per route attempt (128 per peer). Legacy manual signaling retains its 128-candidate socket cap. Per-IP request accounting allows 30 upgrade/authentication operations per minute; a normal connection consumes an upgrade and an authentication operation. Bursts may need retrying.
- Failed authentication, incompatible versions, malformed/oversized/unauthorized signaling and rate-limit violations close the offending socket. A socket cannot forward gameplay snapshots or commands; its message types are limited to bounded route offers/answers/candidates, readiness/selection/cancellation controls and host rejection. Each route has a fresh identifier and increasing stage; stale controls are ignored. Only the host can select a route, and no new route can replace a committed one in this release.
- Pings run every 30 seconds. Closed hosts remove their rooms. Server restart, expiry or signaling loss makes new joins unavailable; established TCP/TLS or WebRTC game links continue without signaling. Recreate the room/session to accept new guests after recovery. Manual invitations remain available independently.
- The service sees connection metadata and handles the password transiently during authentication. It keeps a salted verifier, not plaintext password storage. WSS protects the client-to-service connection; this is not end-to-end-encrypted signaling against the service operator. Trust your room-service operator.
- Current evidence is local non-GUI transport/controller tests. Public TLS deployment, physical two/four-player joining, actual browser/Electron ICE behavior, native-platform gameplay, load/cost measurements and physical forwarding/UPnP/TURN fallback acceptance remain open. Initial route budgets are provisional: forwarded TCP 3 s, UPnP mapping 3 s plus connection 3 s, STUN-direct 6 s, TURN 10 s and admission 8 s, with an overall 30 s deadline after approval. Failures can end earlier; tuning against real networks remains required. Native host preparation may first spend up to 3 s discovering its public IP. No bandwidth or memory-capacity guarantee is made from these configured limits.

STUN can discover a public IP to try with a **separately configured external TCP port**; a successful STUN reply does not prove a forward is reachable. STUN's mapped UDP port is not the native TCP listener's port. Beta 7 adds a manual native address-discovery button using the chosen UDP STUN server (Google by default), with a three-second deadline and no TCP-port changes. Beta 8 uses this discovery automatically when the room host address is blank, keeps manual address overrides, and attempts TCP using the separately selected port. UPnP is disabled by default and requires the host checkbox; an existing port mapping is left alone. Router operations have a bounded wait, but the underlying mapper cannot abort HTTP: late results are cleaned up when they finish, and crash recovery relies on the finite 20-minute lease. No real router has been tested.

## Playtest diagnostics · Beta 9

Players can copy a local connection report from Multiplayer before leaving. Its roomTraffic totals count signaling JSON separately from game frames. They reveal neither credentials nor message contents, omit transport/retransmission overhead and do not measure total server traffic or provider billing. Reports do not upload automatically; request them alongside observed route/failure details during controlled testing. The signaling protocol remains 2, compatible with Beta 8; the report feature requires the Beta 9 client. Physical load/cost and internet acceptance remain open.
