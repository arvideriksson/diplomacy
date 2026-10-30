// @ts-nocheck
const assert = Object.assign((condition, message = "Invalid sandbox payload") => {
  if (!condition) throw new Error(message);
}, { equal: (a, b) => {
  if (a !== b) throw new Error("Invalid sandbox payload");
} });
import { moveTargets, supportAux, supportTargets, convoyAux, convoyTargets, convoyReach } from "../orders/options";
import { buildSituation, retreatTargets } from "../orders/adjustments";
import { adjudicate, initialBoard } from "../adjudicator";
import { maps } from "../maps";
import { choice } from "./bits";
const nations = ["england", "france", "italy", "germany", "austria", "turkey", "russia"];
const coasts = [void 0, "nc", "sc", "ec"];
const options = { convoy: true, build: true, truncated: true };
const phases = ["movement", "retreat", "build"];
function crc32(bytes) {
  let c = 4294967295;
  for (const byte of bytes) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 3988292384 : 0);
  }
  return (c ^ 4294967295) >>> 0;
}
class Bits {
  data = [];
  pos = 0;
  constructor(data) {
    if (data) for (const b of data) for (let i = 7; i >= 0; i--) this.data.push(b >>> i & 1);
  }
  put(n, w) {
    assert(Number.isInteger(n) && n >= 0 && n < 2 ** w, `bad fixed ${n}/${w}`);
    for (let i = w - 1; i >= 0; i--) this.data.push(Math.floor(n / 2 ** i) % 2);
  }
  get(w) {
    assert(this.pos + w <= this.data.length, "truncated");
    let n = 0;
    while (w--) n = n * 2 + this.data[this.pos++];
    return n;
  }
  u(n) {
    if (n !== void 0) {
      const s = (n + 1).toString(2);
      this.put(0, s.length - 1);
      this.put(n + 1, s.length);
    } else {
      let z = 0;
      while (this.get(1) === 0) {
        assert(++z < 30);
      }
      const value = 2 ** z + this.get(z) - 1;
      assert(value <= 65535);
      return value;
    }
  }
  str(s) {
    if (s !== void 0) {
      const bytes = new TextEncoder().encode(s);
      this.u(bytes.length);
      for (const b of bytes) this.put(b, 8);
    } else {
      return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(Array.from({ length: this.u() }, () => this.get(8))));
    }
  }
  bytes() {
    const b = new Uint8Array(Math.ceil(this.data.length / 8));
    this.data.forEach((x, i) => b[i >> 3] |= x << 7 - i % 8);
    return b;
  }
}
const bounded = (value, max) => {
  assert(Number.isInteger(value) && value >= 0 && value <= max);
  return value;
};
const sorted = (x) => [...x].sort((a, b) => a.territory < b.territory ? -1 : a.territory > b.territory ? 1 : 0);
const stable = (x) => Array.isArray(x) ? x.map(stable) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).filter((k) => x[k] !== void 0).sort().map((k) => [k, stable(x[k])])) : x;
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
class Format {
  map;
  ps;
  sc;
  pw;
  sw;
  opening;
  constructor(map) {
    this.map = map;
    this.ps = Object.keys(map.territories).sort();
    this.sc = this.ps.filter((p) => map.territories[p].supplyCenter);
    this.pw = Math.ceil(Math.log2(this.ps.length));
    this.sw = Math.ceil(Math.log2(this.sc.length));
    this.opening = initialBoard(map);
  }
  p(b, p) {
    if (p !== void 0) {
      b.put(this.ps.indexOf(p), this.pw);
    } else {
      const v = this.ps[b.get(this.pw)];
      assert(v);
      return v;
    }
  }
  opt(b, p, read = false) {
    if (read) return b.get(1) ? this.p(b) : void 0;
    b.put(p ? 1 : 0, 1);
    if (p) this.p(b, p);
  }
  country(b, n) {
    if (n !== void 0) b.put(n === "neutral" ? 7 : nations.indexOf(n === "britain" ? "england" : n), 3);
    else {
      const n2 = nations[b.get(3)] ?? "neutral";
      return this.map.id === "1900" && n2 === "england" ? "britain" : n2;
    }
  }
  coast(b, c, read = false) {
    const choices = this.map.id === "1900" ? [...coasts, "wc"] : coasts, w = Math.ceil(Math.log2(choices.length));
    if (read) {
      const i = b.get(w);
      assert(i < choices.length);
      return choices[i];
    }
    b.put(choices.indexOf(c), w);
  }
  unit(b, u) {
    if (u) {
      this.country(b, u.nation);
      b.put(u.type === "fleet" ? 1 : 0, 1);
      this.p(b, u.territory);
      if (u.type === "fleet") this.coast(b, u.coast);
    } else {
      const nation = this.country(b), type = b.get(1) ? "fleet" : "army", territory = this.p(b), coast = type === "fleet" ? this.coast(b, void 0, true) : void 0;
      return { nation, type, territory, ...coast ? { coast } : {} };
    }
  }
  unitList(b, units, force = false) {
    if (units) {
      units = sorted(units);
      const full = new Bits();
      full.put(0, 1);
      full.u(units.length);
      units.forEach((u) => this.unit(full, u));
      const delta = new Bits();
      delta.put(1, 1);
      const removed = this.opening.units.map((u, i) => units.some((v) => equal(u, v)) ? -1 : i).filter((i) => i >= 0), added = units.filter((u) => !this.opening.units.some((v) => equal(u, v)));
      delta.u(removed.length);
      removed.forEach((i) => delta.put(i, Math.ceil(Math.log2(this.opening.units.length))));
      delta.u(added.length);
      added.forEach((u) => this.unit(delta, u));
      b.data.push(...(!force && delta.data.length < full.data.length ? delta : full).data);
    } else if (b.get(1)) {
      const removed = Array.from({ length: bounded(b.u(), 256) }, () => b.get(Math.ceil(Math.log2(this.opening.units.length))));
      return sorted([...this.opening.units.filter((_, i) => !removed.includes(i)), ...Array.from({ length: bounded(b.u(), 256) }, () => this.unit(b))]);
    } else {
      return Array.from({ length: bounded(b.u(), 256) }, () => this.unit(b));
    }
  }
  owners(b, owners, force = false) {
    if (owners) {
      const full = new Bits();
      full.put(2, 2);
      this.sc.forEach((p) => this.country(full, owners[p] ?? "neutral"));
      const delta = new Bits(), changes = this.sc.filter((p) => owners[p] !== this.opening.supplyCenters[p]);
      delta.put(changes.length ? 1 : 0, 2);
      if (changes.length) {
        delta.u(changes.length);
        changes.forEach((p) => {
          delta.put(this.sc.indexOf(p), this.sw);
          this.country(delta, owners[p] ?? "neutral");
        });
      }
      b.data.push(...(!force && delta.data.length < full.data.length ? delta : full).data);
    } else {
      const mode = b.get(2);
      assert(mode !== 3);
      const out = mode === 2 ? {} : { ...this.opening.supplyCenters };
      if (mode === 2) this.sc.forEach((p) => {
        const n = this.country(b);
        if (n !== "neutral") out[p] = n;
      });
      if (mode === 1) for (let i = b.u(); i > 0; i--) {
        const p = this.sc[b.get(this.sw)], n = this.country(b);
        assert(p);
        if (n === "neutral") delete out[p];
        else out[p] = n;
      }
      return out;
    }
  }
  board(b, board, force = false) {
    if (board) {
      const opening = !force && equal(board, this.opening);
      b.put(opening ? 1 : 0, 1);
      if (opening) return;
      b.u(board.year);
      b.put(board.season === "Fall" ? 1 : 0, 1);
      b.put(phases.indexOf(board.phase), 2);
      this.unitList(b, board.units, force);
      this.owners(b, board.supplyCenters, force);
      b.u(board.dislodged.length);
      board.dislodged.forEach((d) => {
        this.unit(b, d.unit);
        this.opt(b, d.attackedFrom);
      });
      b.u(board.contested.length);
      [...board.contested].sort().forEach((p) => this.p(b, p));
    } else {
      if (b.get(1)) return structuredClone(this.opening);
      const year = b.u(), season = b.get(1) ? "Fall" : "Spring", phase = phases[b.get(2)];
      assert(phase);
      const units = this.unitList(b), supplyCenters = this.owners(b), dislodged = Array.from({ length: bounded(b.u(), 256) }, () => ({ unit: this.unit(b), attackedFrom: this.opt(b, void 0, true) ?? "" })), contested = Array.from({ length: bounded(b.u(), 256) }, () => this.p(b));
      return { mapId: this.map.id, year, season, phase, units, supplyCenters, dislodged, contested };
    }
  }
  boardCRC(board) {
    const b = new Bits();
    this.board(b, board, true);
    return crc32(b.bytes());
  }
  roster(board) {
    return sorted(board.phase === "retreat" ? board.dislodged.map((d) => d.unit) : board.units);
  }
  sourceIndex(roster, o) {
    return roster.findIndex((u) => u.nation === o.nation && u.territory === o.source && u.coast === o.sourceCoast);
  }
  source(b, roster, o) {
    const w = Math.ceil(Math.log2(Math.max(1, roster.length)));
    if (o) {
      const i = this.sourceIndex(roster, o);
      b.put(i >= 0 ? 1 : 0, 1);
      if (i >= 0) b.put(i, w);
      else {
        this.country(b, o.nation);
        this.p(b, o.source);
        this.coast(b, o.sourceCoast);
      }
    } else {
      if (b.get(1)) {
        const u = roster[b.get(w)];
        assert(u);
        return { nation: u.nation, source: u.territory, ...u.coast ? { sourceCoast: u.coast } : {} };
      }
      const nation = this.country(b), source = this.p(b), sourceCoast = this.coast(b, void 0, true);
      return { nation, source, ...sourceCoast ? { sourceCoast } : {} };
    }
  }
  action(b, phase, o) {
    const types = phase === "movement" ? ["Hold", "Support", "Move", "Convoy"] : phase === "retreat" ? ["Disband", "Retreat"] : ["Remove", "Build"];
    if (o) {
      b.put(types.indexOf(o.type), phase === "movement" ? 2 : 1);
      if (["Support", "Convoy"].includes(o.type)) this.opt(b, o.aux);
      if (["Support", "Convoy", "Move", "Retreat"].includes(o.type)) this.opt(b, o.target);
      if (["Move", "Retreat"].includes(o.type)) this.coast(b, o.targetCoast);
      if (o.type === "Move") b.put(o.viaConvoy ? 1 : 0, 1);
      if (o.type === "Build") b.put([void 0, "army", "fleet"].indexOf(o.unitType), 2);
    } else {
      const type = types[b.get(phase === "movement" ? 2 : 1)], out = { type };
      assert(type);
      if (["Support", "Convoy"].includes(type)) {
        const v = this.opt(b, void 0, true);
        if (v) out.aux = v;
      }
      if (["Support", "Convoy", "Move", "Retreat"].includes(type)) {
        const v = this.opt(b, void 0, true);
        if (v) out.target = v;
      }
      if (["Move", "Retreat"].includes(type)) {
        const v = this.coast(b, void 0, true);
        if (v) out.targetCoast = v;
      }
      if (type === "Move" && b.get(1)) out.viaConvoy = true;
      if (type === "Build") {
        const v = [void 0, "army", "fleet"][b.get(2)];
        if (v) out.unitType = v;
      }
      return out;
    }
  }
  genericOrders(b, board, orders) {
    const roster = this.roster(board);
    if (orders) {
      const sparse = new Bits();
      sparse.put(0, 1);
      sparse.u(orders.length);
      for (const o of orders) {
        this.source(sparse, roster, o);
        this.action(sparse, board.phase, o);
      }
      const indexes = orders.map((o) => this.sourceIndex(roster, o)), eligible = indexes.every((v, i) => v >= 0 && (i === 0 || v > indexes[i - 1]));
      let dense;
      if (eligible) {
        dense = new Bits();
        dense.put(1, 1);
        for (let i = 0; i < roster.length; i++) {
          const j = indexes.indexOf(i);
          dense.put(j >= 0 ? 1 : 0, 1);
          if (j >= 0) this.action(dense, board.phase, orders[j]);
        }
      }
      const chosen = dense && dense.data.length < sparse.data.length ? dense : sparse;
      b.data.push(...chosen.data);
      return chosen === dense ? "dense" : "sparse";
    } else {
      if (b.get(1)) {
        const out = [];
        for (const u of roster) if (b.get(1)) out.push({ nation: u.nation, source: u.territory, ...u.coast ? { sourceCoast: u.coast } : {}, ...this.action(b, board.phase) });
        return out;
      }
      return Array.from({ length: bounded(b.u(), 256) }, () => ({ ...this.source(b, roster), ...this.action(b, board.phase) }));
    }
  }
  choice(b, values, value) {
    const schema = choice([...new Set(values)].sort());
    if (value !== void 0) {
      schema.write({ uint: (number, width) => b.put(number, width) }, value, void 0);
    } else {
      return schema.read({ uint: (width) => b.get(width) }, void 0);
    }
  }

  compactAction(b, board, u, o, viaSet) {
    const read = !o;
    let type = o?.type;
    const out = { nation: u.nation, source: u.territory, ...u.coast ? { sourceCoast: u.coast } : {} };
    if (board.phase === "movement") {
      if (read) {
        type = b.get(1) ? b.get(1) ? b.get(1) ? "Convoy" : "Hold" : "Support" : "Move";
      } else {
        const codes = { Move: [0, 1], Support: [2, 2], Hold: [6, 3], Convoy: [7, 3] };
        assert(codes[type]);
        b.put(codes[type][0], codes[type][1]);
      }
      if (type === "Move") {
        const eligible = u.type === "army" && convoyReach(this.map, u.territory, board.units).length > 0;
        const via = viaSet ? viaSet.has(u.territory) : read ? options.convoy && !eligible ? false : Boolean(b.get(1)) : Boolean(o.viaConvoy);
        if (!read && !viaSet && (!options.convoy || eligible)) b.put(via ? 1 : 0, 1);
        if (via) out.viaConvoy = true;
        const candidates = via ? convoyReach(this.map, u.territory, board.units) : moveTargets(this.map, u).map((t) => t.province);
        if (read) out.target = this.choice(b, candidates);
        else {
          assert(o.target);
          this.choice(b, candidates, o.target);
        }
      } else if (type === "Support" || type === "Convoy") {
        const auxs = type === "Support" ? supportAux(this.map, u, board.units) : convoyAux(this.map, u, board.units);
        let aux;
        if (read) {
          out.aux = this.choice(b, auxs);
          aux = out.aux;
        } else {
          assert(o.aux);
          this.choice(b, auxs, o.aux);
          aux = o.aux;
        }
        const targetUnit = board.units.find((v) => v.territory === aux);
        assert(targetUnit);
        const targets = type === "Support" ? supportTargets(this.map, u, targetUnit, board.units) : convoyTargets(this.map, u, targetUnit, board.units);
        if (read) out.target = this.choice(b, targets);
        else {
          assert(o.target);
          this.choice(b, targets, o.target);
        }
      }
    } else {
      assert(board.phase === "retreat");
      if (read) type = b.get(1) ? "Retreat" : "Disband";
      else {
        assert(type === "Retreat" || type === "Disband");
        b.put(type === "Retreat" ? 1 : 0, 1);
      }
      if (type === "Retreat") {
        const d = board.dislodged.find((d2) => d2.unit.territory === u.territory);
        assert(d);
        const targets = retreatTargets(this.map, u, d.attackedFrom, board.units, board.contested).map((t) => t.province);
        if (read) out.target = this.choice(b, targets);
        else {
          assert(o.target);
          this.choice(b, targets, o.target);
        }
      }
    }
    if (type === "Move" || type === "Retreat") {
      const target = read ? out.target : o.target;
      if (u.type === "fleet" && this.map.territories[target].coasts) {
        if (read) {
          const c = this.coast(b, void 0, true);
          if (c) out.targetCoast = c;
        } else this.coast(b, o.targetCoast);
      }
    }
    if (read) {
      out.type = type;
      return out;
    }
  }
  convoyList(b, board, orders) {
    const roster = this.roster(board), eligible = roster.filter((u) => u.type === "army" && convoyReach(this.map, u.territory, board.units).length > 0);
    if (orders) {
      const via = orders.filter((o) => o.type === "Move" && o.viaConvoy).map((o) => eligible.findIndex((u) => u.territory === o.source)).sort((a, b2) => a - b2);
      assert(via.every((i) => i >= 0));
      const sparse = new Bits();
      sparse.u(via.length);
      let prev = -1;
      for (const i of via) {
        sparse.u(i - prev - 1);
        prev = i;
      }
      const inline = new Bits();
      for (let i = 0; i < eligible.length; i++) inline.put(via.includes(i) ? 1 : 0, 1);
      const short = sparse.data.length < inline.data.length;
      b.put(short ? 1 : 0, 1);
      b.data.push(...(short ? sparse : inline).data);
      return new Set(via.map((i) => eligible[i].territory));
    }
    const indexes = [];
    if (b.get(1)) {
      const n = b.u();
      assert(n <= eligible.length);
      let prev = -1;
      for (let i = 0; i < n; i++) {
        prev += 1 + b.u();
        assert(prev < eligible.length);
        indexes.push(prev);
      }
    } else for (let i = 0; i < eligible.length; i++) if (b.get(1)) indexes.push(i);
    return new Set(indexes.map((i) => eligible[i].territory));
  }
  buildChoices(board) {
    const opts = [];
    for (const nation of this.map.powers.map((p) => p.id)) {
      const situation = buildSituation(this.map, nation, board.supplyCenters, board.units);
      if (situation.delta > 0) for (const spot of situation.spots) for (const unitType of spot.types) {
        const coasts2 = unitType === "fleet" && spot.coasts?.length ? [void 0, ...spot.coasts] : [void 0];
        for (const sourceCoast of coasts2) opts.push({ type: "Build", nation, source: spot.province, unitType, ...sourceCoast ? { sourceCoast } : {} });
      }
      else if (situation.delta < 0) for (const u of situation.removable) {
        for (const sourceCoast of u.coast ? [void 0, u.coast] : [void 0]) opts.push({ type: "Remove", nation, source: u.territory, ...sourceCoast ? { sourceCoast } : {} });
      }
    }
    return opts.map((o) => JSON.stringify(stable(o))).sort();
  }
  compactOrders(b, board, orders) {
    if (board.phase === "build") {
      assert(options.build);
      const values = this.buildChoices(board);
      if (orders) {
        b.u(orders.length);
        for (const o of orders) this.choice(b, values, JSON.stringify(stable(o)));
      } else return Array.from({ length: bounded(b.u(), 256) }, () => JSON.parse(this.choice(b, values)));
      return;
    }
    const roster = this.roster(board);
    if (orders) {
      const indexes = orders.map((o) => this.sourceIndex(roster, o));
      assert(indexes.every((v, i) => v >= 0 && (i === 0 || v > indexes[i - 1])));
      const viaSet = options.convoy && board.phase === "movement" ? this.convoyList(b, board, orders) : void 0;
      const all = orders.length === roster.length;
      b.put(all ? 1 : 0, 1);
      for (let i = 0; i < roster.length; i++) {
        const j = indexes.indexOf(i);
        if (!all) b.put(j >= 0 ? 1 : 0, 1);
        if (j >= 0) this.compactAction(b, board, roster[i], orders[j], viaSet);
      }
    } else {
      const viaSet = options.convoy && board.phase === "movement" ? this.convoyList(b, board) : void 0;
      const all = b.get(1), out = [];
      for (const u of roster) if (all || b.get(1)) out.push(this.compactAction(b, board, u, void 0, viaSet));
      return out;
    }
  }
  orders(b, board, orders) {
    if (!orders) return b.get(1) ? this.compactOrders(b, board) : this.genericOrders(b, board);
    const generic = new Bits();
    generic.put(0, 1);
    this.genericOrders(generic, board, orders);
    let compact;
    try {
      compact = new Bits();
      compact.put(1, 1);
      this.compactOrders(compact, board, orders);
      const r = new Bits(compact.bytes());
      assert.equal(r.get(1), 1);
      assert(equal(this.compactOrders(r, board), orders));
    } catch {
      compact = void 0;
    }
    const chosen = compact && compact.data.length < generic.data.length ? compact : generic;
    b.data.push(...chosen.data);
    return chosen === compact ? "compact" : "generic";
  }
}
const fingerprint = 177982007;
function encodeSandbox(s) {
  assert(s.frames.length > 0 && s.frames.length <= 1024 && s.cursor >= 0 && s.cursor < s.frames.length);
  assert(s.mapId === "classical" || s.mapId === "1900");
  const f = new Format(maps[s.mapId]), b = new Bits();
  b.put(s.mapId === "1900" ? 1 : 0, 1);
  b.put(fingerprint, 32);
  b.str(s.name);
  b.u(s.frames.length);
  b.u(s.cursor);
  f.board(b, s.frames[0].board);
  for (let i = 0; i < s.frames.length; i++) {
    const frame = s.frames[i];
    assert(frame.orders.length <= 256);
    f.orders(b, frame.board, frame.orders);
    b.put(frame.results ? 1 : 0, 1);
    if (i < s.frames.length - 1) {
      const result = adjudicate(f.map, frame.board, frame.orders);
      const checkpoint = !equal(result.newBoardState, s.frames[i + 1].board);
      b.put(checkpoint ? 1 : 0, 1);
      if (checkpoint) f.board(b, s.frames[i + 1].board);
    }
  }
  b.put(f.boardCRC(s.frames.at(-1).board), 32);
  const raw = b.bytes();
  if (raw.length > 32768) throw new Error("Sandbox payload is too large");
  const envelope = new Uint8Array(raw.length + 5);
  envelope[0] = 16;
  envelope.set(raw, 1);
  new DataView(envelope.buffer).setUint32(envelope.length - 4, crc32(raw));
  return btoa(Array.from(envelope, (x) => String.fromCharCode(x)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeSandbox(payload) {
  assert(typeof payload === "string" && payload.length <= 44e3 && /^[A-Za-z0-9_-]+$/.test(payload));
  const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  const envelope = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  assert(envelope.length >= 6 && envelope.length <= 32773 && envelope[0] === 16);
  const raw = envelope.subarray(1, -4);
  assert.equal(crc32(raw), new DataView(envelope.buffer).getUint32(envelope.length - 4));
  const b = new Bits(raw), mapId = b.get(1) ? "1900" : "classical";
  assert.equal(b.get(32), fingerprint);
  const name = b.str(), count = b.u(), cursor = b.u();
  assert(count > 0 && count <= 1024 && cursor < count && name.length <= 1024);
  const f = new Format(maps[mapId]), frames = [];
  let board = f.board(b);
  for (let i = 0; i < count; i++) {
    const orders = f.orders(b, board);
    assert(orders.length <= 256);
    const show = b.get(1), res = show || i < count - 1 ? adjudicate(f.map, board, orders) : void 0;
    frames.push({ board, orders, ...show ? { results: res.results } : {} });
    if (i < count - 1) board = b.get(1) ? f.board(b) : res.newBoardState;
  }
  assert.equal(f.boardCRC(board), b.get(32));
  assert(b.data.length - b.pos < 8);
  while (b.pos < b.data.length) assert.equal(b.get(1), 0);
  return { name, mapId, frames, cursor };
}
export {
  Bits,
  crc32,
  decodeSandbox,
  encodeSandbox,
  equal,
  nations
};
