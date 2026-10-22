'use strict';
(function (root) {
  class LocalBridge {
    constructor(state, metadata, report) {
      this.state = state;
      this.metadata = metadata;
      this.report = report;
      this.listeners = {};
      this.basket = {};
      this.pending = 0;
      this.gameBridge = {
        setListener: (event, callback) => { (this.listeners[event] ||= []).push(callback); },
        emit: (event, ...args) => this.receive(event, ...args)
      };
    }
    send(event, ...args) { for (const callback of this.listeners[event] || []) callback(...args); }
    defer(callback) {
      this.pending++;
      setTimeout(() => { try { callback(); } finally { this.pending--; } }, 0);
    }
    receive(event, value) {
      if (event === 'config.request') {
        this.send('config.set', JSON.stringify({ mode: 'canvas', bridgeServices: true, offline: true, syncing: false, servicesDomain: 'polycraft://game' }));
      } else if (event.startsWith('bridgeservices.')) {
        const request = JSON.parse(value);
        let response;
        try { response = this.service(event.slice(15), request.data); }
        catch (error) { this.report(error); response = { status: 400, msg: error.message }; }
        if (request.key) this.defer(() => this.send('bridgeservices.response', JSON.stringify({ key: request.key, data: response })));
        return JSON.stringify({ fullyProcessed: true });
      } else if (event === 'fetch.store.meta') {
        this.defer(() => this.send('store.meta.v2', JSON.stringify({ currency: this.currency(), offerings: this.metadata.store.items, resources: this.metadata.store.resources })));
      } else if (event === 'basket.game.update.v2') {
        const params = value ? JSON.parse(value) : {};
        this.basket = {};
        for (const [key, item] of Object.entries(params.basketItems || {})) {
          const offering = this.metadata.store.items[key];
          if (offering?.available && Number.isSafeInteger(item.amount) && item.amount > 0 && item.amount <= 999) {
            this.basket[key] = { amount: item.amount, price: 0, lineTotal: 0, output: offering.output };
          }
        }
        this.defer(() => this.send('basket.site.update', JSON.stringify({ currency: this.currency(), items: this.basket, total: 0, token: params.token })));
      } else if (event === 'purchase.show.confirm') {
        this.defer(() => {
          try {
            this.claim();
            this.send('purchase.confirmed');
            this.onPurchase?.();
          } catch (error) { this.report(error); this.send('purchase.rejected'); }
        });
      }
      return '';
    }
    currency() { return { currencyName: 'Free', alphabeticCode: 'USD', numericCode: 840, minorUnitPrecision: 2, htmlCode: '' }; }
    inventory() { return this.coopEconomy || this.state; }
    claim() {
      if (!this.state.cheats.enabled) throw new Error('Enable cheats to claim premium items.');
      const items = Object.entries(this.basket);
      if (!items.length) throw new Error('Choose an item to claim.');
      const next = JSON.parse(JSON.stringify(this.inventory().userItems));
      for (const [key, item] of items) {
        const offering = this.metadata.store.items[key];
        if (!offering?.available || !Number.isSafeInteger(item.amount) || item.amount < 1 || item.amount > 999) throw new Error('Invalid shop item.');
        for (const [resource, amount] of Object.entries(offering.output)) {
          const own = this.metadata.store.resources[resource].type === 'own';
          const total = own ? 1 : (next[resource]?.amount || 0) + amount * item.amount;
          if (!Number.isSafeInteger(total) || total > 2147483647) throw new Error('Too many items.');
          next[resource] = { amount: total };
        }
      }
      this.inventory().userItems = next;
      this.basket = {};
    }
    service(name, request = {}) {
      const key = (request.url || '').split('/').filter(Boolean).pop();
      const data = request.data || {};
      const state = this.state;
      const ok = result => ({ status: 200, ok: true, ...result });
      switch (name) {
        case 'gamesession.create': return ok({ gameSessionId: '000000000000000000000000', mappingTable: { mappingTablePrefix: '/staticmax/', mappingTableURL: '/mapping_table.json', assetPrefix: '/missing/' } });
        case 'gamesession.destroy': return ok({});
        case 'profile.user': return ok({ data: { username: 'local-player', displayname: 'Offline Player', guest: false, anonymous: false, language: 'en', country: 'US' } });
        case 'userdata.getkeys': return ok({ keys: Object.keys(state.userData) });
        case 'userdata.exists': return ok({ exists: Object.hasOwn(state.userData, key) });
        case 'userdata.get': return Object.hasOwn(state.userData, key) ? ok({ value: state.userData[key] }) : { status: 404 };
        case 'userdata.set':
          if (!/^[\w-]{1,100}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || typeof data.value !== 'string') throw new Error('Invalid save key or value.');
          state.userData[key] = data.value;
          return ok({});
        case 'userdata.remove': delete state.userData[key]; return ok({});
        case 'userdata.removeall': state.userData = {}; return ok({});
        case 'store.useritems': return ok({ data: { userItems: this.inventory().userItems } });
        case 'store.useritems-consume': {
          const item = this.inventory().userItems[data.key];
          if (!item || this.metadata.store.resources[data.key]?.type !== 'consume' || !Number.isSafeInteger(data.consume) || data.consume <= 0 || data.consume > item.amount) throw new Error('Invalid inventory consumption.');
          item.amount -= data.consume;
          return ok({ data: { userItems: this.inventory().userItems, consumed: data.consume } });
        }
        case 'badge.meta': return ok({ data: this.metadata.badges });
        case 'badge.read': return ok({ data: Object.entries(state.badges).map(([key, current]) => {
          const total = this.metadata.badges.find(b => b.key === key)?.total ?? null;
          return { key, badge_key: key, current, total, achieved: current >= (total ?? 1) };
        }) });
        case 'badge.add': {
          const badge = this.metadata.badges.find(b => b.key === data.badge_key);
          if (!badge) throw new Error('Unknown badge.');
          const current = data.current || badge.total || 1;
          state.badges[badge.key] = current;
          return ok({ data: { key: badge.key, badge_key: badge.key, current, total: badge.total || 1, achieved: current >= (badge.total || 1) } });
        }
        case 'leaderboard.meta': return ok({ data: this.metadata.leaderboards });
        case 'leaderboard.set': return ok({ data: { bestScore: data.score, lastScore: data.score, newBest: false } });
        case 'leaderboard.read': return ok({ data: { ranking: [], top: true, bottom: true, player: null } });
        case 'leaderboard.aggregates': return ok({ data: {} });
        case 'leaderboard.removeall': return ok({});
        case 'notifications.keys': return ok({ data: this.metadata.notifications });
        case 'notifications.usersettings': return ok({ data: { site_setting: 0, email_setting: 0, game_followed: 0 } });
        case 'custommetrics.addevent':
        case 'custommetrics.addeventbatch': return ok({});
        default: this.report(new Error('Unsupported local service: ' + name)); return { status: 404, msg: 'Service unavailable offline' };
      }
    }
  }
  if (typeof module !== 'undefined') module.exports = { LocalBridge };
  else root.LocalBridge = LocalBridge;
})(globalThis);
