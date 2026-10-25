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
        const transport = new r.PolycraftMultiplayer.HostSession({ pvp: options.pvp, iceServers,
          onState: (peer, state, details) => {
            if (state === 'closed') for (const [id, offer] of this.offers) if (offer.peer === peer) { this.offers.delete(id); if (this.outgoing === offer.invitation) this.outgoing = ''; }
            this.notify('Guest connection: ' + state + (details.path ? ' · ' + details.path : '') + (details.reason ? ' · ' + details.reason : ''));
          },
          onError: (_peer, error) => this.notify(error.message) });
        let world;
        try {
          world = await r.PolycraftOnlineWorld.startHostingWorld(controls, transport);
          await world.enablePlayers(r.polycraft.bridge);
          this.transport = transport; this.world = world; this.role = role;
          this.notify('Hosting this test island. Add or select a guest hero, then create an invitation. PvP ' + (transport.pvp ? 'on.' : 'off.'));
        } catch (error) { if (world) await world.close(); else transport.close(); throw error; }
      } else {
        let joined;
        try {
          await r.desktop.onlineMode(true);
          joined = await r.PolycraftMultiplayer.PeerLink.join(invitation, { iceServers,
            onError: error => this.notify(error.message),
            onState: (state, details) => {
              this.notify('Host connection: ' + state + (details.path ? ' · ' + details.path : '') + (details.reason ? ' · ' + details.reason : ''));
              if (state === 'closed' && this.role === 'guest' && !this.stopping) this.end().then(() => this.notify('Host connection ended' + (details.reason ? ': ' + details.reason : '.'))).catch(error => this.notify(error.message));
            } });
          this.world = new r.PolycraftGuestWorld.GuestWorld(controls, joined.connection);
          this.connection = joined.connection; this.outgoing = joined.reply; this.role = role;
          this.notify('Send this reply to the host. Keep this game open while the host accepts it. PvP ' + (joined.connection.pvp ? 'on.' : 'off.'));
        } catch (error) { joined?.connection.close(); await r.desktop.onlineMode(false); throw error; }
      }
      return true;
    }
    addGuest(name) {
      if (this.role !== 'host') throw new Error('Start hosting first.');
      const record = this.world.players.registry.addPlayer(name);
      this.changed(); return record.id;
    }
    async invite(id) {
      if (this.role !== 'host') throw new Error('Start hosting first.');
      const offer = await this.world.createPlayerInvitation(id); this.offers.set(id, offer); this.outgoing = offer.invitation;
      this.notify('Send this invitation to its guest. Paste their reply below when it arrives.');
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
      if (!this.world || this.stopping) return;
      this.stopping = true;
      try {
        if (this.role === 'host') await this.world.close();
        else { this.world.close(); await this.runtime.desktop.onlineMode(false); }
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
      $('connection-settings').disabled = busy || !!session.world;
      $('host-connections').hidden = session.role !== 'host'; $('host-connections').disabled = busy;
      $('end-session').disabled = busy || !session.world;
      $('connection-outgoing').value = session.outgoing || '';
      $('copy-connection').disabled = busy || !session.outgoing;
      if (session.role === 'host') {
        const selected = $('guest-hero').value;
        $('guest-hero').replaceChildren(...session.world.players.registry.data.players.filter(player => player.id !== session.world.players.registry.data.host).map(player => {
          const option = root.document.createElement('option'); option.value = player.id; option.textContent = player.name; return option;
        }));
        if ([...$('guest-hero').options].some(option => option.value === selected)) $('guest-hero').value = selected;
        $('create-invitation').disabled = busy || !$('guest-hero').value;
        $('add-guest').disabled = busy || session.world.players.registry.data.players.length >= 4;
      }
      if (root.polycraft) {
        if (dialog.open && !root.polycraft.controls.paused) root.polycraft.controls.pause(true);
        $('cheats').hidden = session.role === 'guest' || !root.polycraft.bridge.state.cheats.enabled;
        $('slots').disabled = !!session.world; $('save-now').disabled = session.role === 'guest';
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
      const options = { pvp: $('session-pvp').checked, iceServers: iceSettings($('stun-urls').value, $('turn-urls').value, $('turn-user').value, $('turn-password').value, root.PolycraftMultiplayer.validateIceServers) };
      await session.connect(role, options, $('join-invitation').value, true);
      if (session.role === 'guest') session.world.original.paused = returnPause;
      $('join-invitation').value = ''; $('turn-user').value = ''; $('turn-password').value = '';
    }
    $('multiplayer').addEventListener('click', () => run(() => {
      if (!root.polycraft || dialog.open || root.document.querySelector('dialog[open]')) return;
      returnPause = root.polycraft.controls.paused; root.polycraft.controls.pause(true); render(); dialog.showModal();
    }));
    $('host-island').addEventListener('click', () => run(() => connect('host')));
    $('join-island').addEventListener('click', () => run(() => connect('guest')));
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
