'use strict';
(function (root) {
  class PlaytestSession {
    constructor(runtime = root, changed = () => {}) { this.runtime = runtime; this.changed = changed; this.message = 'Not connected.'; this.offers = new Map(); }
    notify(message) { this.message = message; this.changed(); }
    async connect(role, options, invitation, accepted) {
      if (!accepted) return false;
      const r = this.runtime, controls = r.polycraft.controls;
      if (!['host', 'guest'].includes(role) || this.world || controls.onlineWorld || controls.guestWorld || !controls.ready()) throw new Error('Enter a test island with Play and end any current session first.');
      if (controls.manager().getActiveGameState().name !== 'GamestatePlaying') throw new Error('Return to the island with Play before connecting.');
      const iceServers = r.PolycraftMultiplayer.validateIceServers(options.iceServers);
      if (role === 'host') {
        const Transport = options.autoNative ? r.PolycraftAutoTransport.AutoHostSession : options.direct ? r.PolycraftDirect.DirectHostSession : r.PolycraftMultiplayer.HostSession;
        const transport = new Transport({ pvp: options.pvp, iceServers, desktop: r.desktop, trickle: options.trickle, onCandidate: options.onCandidate,
          onState: (peer, state, details) => {
            if (state === 'closed') for (const [id, offer] of this.offers) if (offer.peer === peer) { this.offers.delete(id); if (this.outgoing === offer.invitation) this.outgoing = ''; }
            this.notify('Guest connection: ' + state + (details.path ? ' · ' + details.path : '') + (details.reason ? ' · ' + details.reason : ''));
          },
          onError: (_peer, error) => this.notify(error.message) });
        let world;
        try {
          if (options.direct || options.autoNative) await transport.listen(options.direct || options.autoNative);
          world = await r.PolycraftOnlineWorld.startHostingWorld(controls, transport);
          await world.enablePlayers(r.polycraft.bridge);
          this.transport = transport; this.world = world; this.role = role;
          this.notify('Hosting this test island. Add or select a guest hero, then create an invitation. PvP ' + (transport.pvp ? 'on.' : 'off.') + (transport.endpoint ? ' Direct TCP ' + transport.endpoint.port + '. ' + (transport.endpoint.mapped ? 'UPnP mapping created. ' : '') + transport.endpoint.warning : ''));
        } catch (error) { if (world) await world.close(); else transport.close(); await transport.stopped; throw error; }
      } else {
        let joined;
        try {
          await r.desktop.onlineMode(true);
          const Peer = invitation.trim().startsWith('polycraft-direct1.') ? r.PolycraftDirect.DirectPeer : r.PolycraftMultiplayer.PeerLink;
          joined = await Peer.join(invitation.trim(), { iceServers, desktop: r.desktop, trickle: options.trickle, onCandidate: options.onCandidate,
            onError: error => this.notify(error.message),
            onState: (state, details) => {
              this.notify('Host connection: ' + state + (details.path ? ' · ' + details.path : '') + (details.reason ? ' · ' + details.reason : ''));
              if (state === 'closed' && this.role === 'guest' && !this.stopping) this.end().then(() => this.notify('Host connection ended' + (details.reason ? ': ' + details.reason : '.'))).catch(error => this.notify(error.message));
            } });
          this.world = new r.PolycraftGuestWorld.GuestWorld(controls, joined.connection);
          this.connection = joined.connection; this.outgoing = joined.reply; this.role = role;
          joined.connection.activate?.();
          this.notify((joined.reply ? 'Send this reply to the host. Keep this game open while the host accepts it.' : 'Direct connection established. No reply is needed; return to game.') + ' PvP ' + (joined.connection.pvp ? 'on.' : 'off.'));
        } catch (error) { joined?.connection.close(); await r.desktop.onlineMode(false); throw error; }
      }
      return true;
    }
    async attachGuest(connection) {
      const r = this.runtime, controls = r.polycraft.controls;
      if (this.world || controls.onlineWorld || controls.guestWorld || !controls.ready() || connection.closed || connection.state !== 'connected' || connection.role !== 'guest') throw new Error('This checked guest connection cannot enter the island.');
      await r.desktop.onlineMode(true);
      const earlier = connection.onState;
      connection.onState = (state, details) => {
        earlier?.(state, details);
        this.notify('Host connection: ' + state + (details.reason ? ' · ' + details.reason : ''));
        if (state === 'closed' && this.role === 'guest' && !this.stopping) this.end().catch(error => this.notify(error.message));
      };
      try {
        this.world = new r.PolycraftGuestWorld.GuestWorld(controls, connection);
        this.connection = connection; this.role = 'guest'; this.outgoing = ''; connection.probing = false;
      } catch (error) { connection.onState = earlier; await r.desktop.onlineMode(false); throw error; }
    }
    addGuest(name) {
      if (this.role !== 'host') throw new Error('Start hosting first.');
      const record = this.world.players.registry.addPlayer(name);
      this.changed(); return record.id;
    }
    async invite(id) {
      if (this.role !== 'host') throw new Error('Start hosting first.');
      const offer = await this.world.createPlayerInvitation(id); this.offers.set(id, offer); this.outgoing = offer.invitation;
      this.notify(this.transport.kind === 'direct' ? 'Send this private invitation to its guest. They connect automatically; no reply is needed.' : 'Send this invitation to its guest. Paste their reply below when it arrives.');
    }
    selectGuest(id) { this.outgoing = this.offers.get(id)?.invitation || ''; this.changed(); }
    async accept(reply) {
      if (this.role !== 'host') throw new Error('Start hosting first.');
      await this.transport.acceptReply(reply); this.notify('Guest reply accepted. Waiting for the world connection.');
    }
    cancel(id) {
      if (this.role !== 'host') throw new Error('Start hosting first.');
      this.world.guestSlots.get(id)?.connection?.close('The host cancelled this connection.');
      this.offers.delete(id); this.outgoing = ''; this.notify('Selected connection cancelled. The saved guest hero is retained.');
    }
    async end() {
      if (this.stopping) return;
      if (!this.world) { this.room?.close(); this.room = null; this.changed(); return; }
      this.stopping = true;
      try {
        if (this.role === 'host') { await this.world.close(); await this.transport.stopped; }
        else { this.world.close(); await this.runtime.desktop.onlineMode(false); }
        this.room?.close(); this.room = null;
        this.world = this.connection = this.transport = this.role = null; this.outgoing = ''; this.offers.clear();
        this.notify('Session ended. Returned to the solo island.');
      } finally { this.stopping = false; }
    }
    peers() {
      if (this.role === 'guest') return [{ name: 'Host', link: this.connection }];
      if (this.role !== 'host') return [];
      return [...this.transport.peers.values()].map(link => {
        const id = this.world.peerPlayers.get(link.peer)?.id;
        return { name: id ? this.world.players.registry.player(id).name : 'Guest', link };
      });
    }
  }
  function iceSettings(stun, turn, username, credential, validate) {
    const urls = value => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const servers = [];
    if (urls(stun).length) {
      if (urls(stun).some(url => !/^stuns?:/.test(url))) throw new Error('STUN URLs must start with stun: or stuns:.');
      servers.push({ urls: urls(stun) });
    }
    if (urls(turn).length) {
      if (urls(turn).some(url => !/^turns?:/.test(url))) throw new Error('TURN URLs must start with turn: or turns:.');
      servers.push({ urls: urls(turn), username, credential });
    }
    return validate(servers);
  }
  function mount() {
    const $ = id => root.document.getElementById(id), dialog = $('multiplayer-dialog');
    let busy = false, returnPause = false, polling = false;
    const session = new PlaytestSession(root, render);
    function render() {
      $('multiplayer-status').textContent = session.message;
      for (const button of dialog.querySelectorAll('button')) button.disabled = busy;
      $('connection-settings').disabled = busy || !!session.world || !!session.room;
      $('host-connections').hidden = session.role !== 'host'; $('host-connections').disabled = busy;
      $('end-session').disabled = busy || !(session.world || session.room);
      $('connection-outgoing').value = session.outgoing || '';
      $('copy-connection').disabled = busy || !session.outgoing;
      $('reply-controls').hidden = session.transport?.kind === 'direct' || !!session.room;
      $('room-requests').hidden = session.room?.role !== 'host';
      $('manual-invite-tools').hidden = !!session.room;
      const selectedRequest = $('room-request').value;
      $('room-request').replaceChildren(...[...(session.room?.requests.values() || [])].map(entry => {
        const option = root.document.createElement('option'); option.value = entry.id; option.textContent = entry.name + (entry.peer ? ' · approved' : ' · waiting'); return option;
      }));
      if ([...$('room-request').options].some(option => option.value === selectedRequest)) $('room-request').value = selectedRequest;
      const request = session.room?.requests.get($('room-request').value);
      $('approve-room-guest').disabled = busy || !request || !!request.peer || !!request.approving || !session.room?.connected;
      $('reject-room-guest').disabled = busy || !$('room-request').value || !(session.room?.connected || session.room?.requests.get($('room-request').value)?.peer);
      if (session.role === 'host') {
        const selected = $('guest-hero').value;
        $('guest-hero').replaceChildren(...session.world.players.registry.data.players.filter(player => player.id !== session.world.players.registry.data.host).map(player => {
          const option = root.document.createElement('option'); option.value = player.id; option.textContent = player.name; return option;
        }));
        if ([...$('guest-hero').options].some(option => option.value === selected)) $('guest-hero').value = selected;
        $('create-invitation').disabled = busy || !$('guest-hero').value;
        $('add-guest').disabled = busy || session.world.players.registry.data.players.length >= 4;
        const selectedHero = $('room-hero').value, fresh = root.document.createElement('option'); fresh.value = ''; fresh.textContent = 'Create a new guest hero';
        $('room-hero').replaceChildren(fresh, ...session.world.players.registry.data.players.filter(player => player.id !== session.world.players.registry.data.host).map(player => {
          const option = root.document.createElement('option'); option.value = player.id; option.textContent = player.name; return option;
        }));
        if ([...$('room-hero').options].some(option => option.value === selectedHero)) $('room-hero').value = selectedHero;
      }
      if (root.polycraft) {
        if (dialog.open && !root.polycraft.controls.paused) root.polycraft.controls.pause(true);
        $('cheats').hidden = session.role === 'guest' || !root.polycraft.bridge.state.cheats.enabled;
        $('slots').disabled = !!(session.world || session.room); $('save-now').disabled = session.role === 'guest';
      }
    }
    async function run(callback) {
      if (busy || !root.polycraft) return;
      busy = true; render();
      try { await root.polycraft.runAction(async () => { try { await callback(); } catch (error) { session.notify(error.message); } }); }
      catch (error) { session.notify(error.message); }
      finally { busy = false; render(); }
    }
    function disclaimer() {
      const warning = $('multiplayer-warning'); warning.returnValue = ''; warning.showModal();
      return new Promise(resolve => warning.addEventListener('close', () => resolve(warning.returnValue === 'continue'), { once: true }));
    }
    async function connect(role) {
      if (!await disclaimer()) return;
      const direct = role === 'host' ? $('connection-method').value === 'direct' : $('join-invitation').value.trim().startsWith('polycraft-direct1.');
      const options = { pvp: $('session-pvp').checked, iceServers: direct ? [] : iceSettings($('stun-urls').value, $('turn-urls').value, $('turn-user').value, $('turn-password').value, root.PolycraftMultiplayer.validateIceServers),
        ...(direct ? { direct: { address: $('direct-address').value.trim(), port: Number($('direct-port').value), upnp: $('direct-upnp').checked } } : {}) };
      await session.connect(role, options, $('join-invitation').value, true);
      if (session.role === 'guest') session.world.original.paused = returnPause;
      $('join-invitation').value = ''; $('turn-user').value = ''; $('turn-password').value = '';
    }
    async function connectRoom(role) {
      if (session.world || session.room) throw new Error('End the current session before opening another room.');
      if (!root.polycraft.controls.ready() || root.polycraft.controls.manager().getActiveGameState().name !== 'GamestatePlaying') throw new Error('Enter a test island with Play before using rooms.');
      if (!await disclaimer()) return;
      const settings = { url: root.PolycraftRoomProtocol.serverUrl($('room-server').value), room: root.PolycraftRoomProtocol.roomName($('room-name').value), password: root.PolycraftRoomProtocol.password($('room-password').value), name: $('room-guest-name').value.trim() || 'Player' };
      const iceServers = iceSettings($('stun-urls').value, $('turn-urls').value, $('turn-user').value, $('turn-password').value, root.PolycraftMultiplayer.validateIceServers);
      if (!iceServers.some(server => server.urls.some(url => /^stuns?:/.test(url)))) iceServers.unshift({ urls: ['stun:stun.l.google.com:19302'] });
      const room = session.room = new root.PolycraftAutoRooms.AutoRoomSession(session);
      room.options = { iceServers };
      room.onJoined = () => { session.world.original.paused = returnPause; };
      try {
        if (role === 'host') await session.connect('host', { pvp: $('session-pvp').checked, iceServers, autoNative: { address: $('direct-address').value.trim(), port: Number($('direct-port').value), upnp: $('direct-upnp').checked, stun: $('stun-urls').value.split(/\r?\n/).map(value => value.trim()).find(value => /^stun:/.test(value)) }, trickle: true, onCandidate: (value, link) => room.candidate(value, link) }, '', true);
        await room.open(role, settings);
        try { root.localStorage.setItem('polycraft-room-server', settings.url); } catch { /* Server address is a convenience, never store passwords. */ }
      } catch (error) { await session.end(); throw error; }
      finally { $('room-password').value = ''; $('turn-user').value = ''; $('turn-password').value = ''; }
    }
    try { $('room-server').value = root.localStorage.getItem('polycraft-room-server') || ''; } catch { /* Restricted storage still permits manual server entry. */ }
    $('multiplayer').addEventListener('click', () => run(() => {
      if (!root.polycraft || dialog.open || root.document.querySelector('dialog[open]')) return;
      returnPause = root.polycraft.controls.paused; root.polycraft.controls.pause(true); render(); dialog.showModal();
    }));
    $('host-island').addEventListener('click', () => run(() => connect('host')));
    $('connection-method').addEventListener('change', render);
    $('detect-direct-address').addEventListener('click', () => run(async () => {
      const server = $('stun-urls').value.split(/\r?\n/).map(value => value.trim()).find(value => /^stun:/.test(value));
      if ($('stun-urls').value.trim() && !server) throw new Error('Native IP discovery needs a UDP stun: server. Enter one below or supply the public IPv4 manually.');
      const result = await root.desktop.direct('discover', server ? { server } : {});
      $('direct-address').value = result.address;
      session.notify('Detected IP ' + result.address + '. TCP port is unchanged; verify your forwarding/firewall before inviting guests.');
    }));
    $('join-island').addEventListener('click', () => run(() => connect('guest')));
    $('host-room').addEventListener('click', () => run(() => connectRoom('host')));
    $('join-room').addEventListener('click', () => run(() => connectRoom('guest')));
    $('approve-room-guest').addEventListener('click', () => run(() => session.room.approve($('room-request').value, $('room-hero').value)));
    $('reject-room-guest').addEventListener('click', () => run(() => session.room.reject($('room-request').value)));
    $('add-guest').addEventListener('click', () => run(() => { $('guest-hero').value = session.addGuest($('guest-name').value); session.selectGuest($('guest-hero').value); $('guest-name').value = ''; }));
    $('guest-hero').addEventListener('change', () => session.selectGuest($('guest-hero').value));
    $('create-invitation').addEventListener('click', () => run(() => session.invite($('guest-hero').value)));
    $('cancel-invitation').addEventListener('click', () => run(() => session.cancel($('guest-hero').value)));
    $('accept-reply').addEventListener('click', () => run(async () => { await session.accept($('guest-reply').value); $('guest-reply').value = ''; }));
    $('copy-connection').addEventListener('click', () => run(async () => {
      try { await root.navigator.clipboard.writeText(session.outgoing); }
      catch { $('connection-outgoing').focus(); $('connection-outgoing').select(); session.notify('Select and copy the invitation / reply text manually.'); }
    }));
    $('end-session').addEventListener('click', () => run(async () => {
      await session.end(); $('connection-outgoing').value = ''; $('guest-reply').value = ''; $('turn-user').value = ''; $('turn-password').value = '';
    }));
    $('close-multiplayer').addEventListener('click', () => run(() => dialog.close()));
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) run(() => dialog.close()); });
    dialog.addEventListener('close', () => { root.polycraft.controls.pause(returnPause); $('turbulenz_game_engine_canvas').focus(); });
    root.setInterval(async () => {
      if (!dialog.open || polling) return;
      polling = true;
      try {
        const lines = await Promise.all(session.peers().map(async ({ name, link }) => {
          const info = await link.diagnostics();
          return name + ': ' + link.state + ' · ' + info.path + ' · RTT ' + (info.rttMs === null ? 'unavailable' : info.rttMs + ' ms') + ' · queued ' + info.bufferedBytes + ' bytes';
        }));
        $('connection-summary').textContent = lines.join('\n') || 'No peer connections.';
      } catch { $('connection-summary').textContent = 'Connection statistics unavailable.'; }
      finally { polling = false; }
    }, 2000);
  }
  if (typeof module !== 'undefined') module.exports = { PlaytestSession, iceSettings };
  else { root.PolycraftSessionPanel = { PlaytestSession, iceSettings }; mount(); }
})(globalThis);
