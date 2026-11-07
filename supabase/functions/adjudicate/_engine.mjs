// src/lib/adjudicator/state.ts
var sortIds = (ids) => [...ids].sort();
var sortUnits = (units) => [...units].sort((a, b) => a.territory < b.territory ? -1 : a.territory > b.territory ? 1 : 0);
var unitAt = (units, province) => units.find((u) => u.territory === province);
var supplyCenterProvinces = (map) => sortIds(Object.entries(map.territories).filter(([, t]) => t.supplyCenter).map(([id]) => id));
var homeCenters = (map, nation) => sortIds(
  Object.entries(map.territories).filter(([, t]) => t.supplyCenter && t.homePower === nation).map(([id]) => id)
);
var recomputeSupplyCenters = (map, units, prior) => {
  const owners = { ...prior };
  for (const id of supplyCenterProvinces(map)) {
    const u = unitAt(units, id);
    if (u) owners[id] = u.nation;
  }
  return owners;
};
var scCountByNation = (owners) => {
  const counts = {};
  for (const nation of Object.values(owners)) counts[nation] = (counts[nation] ?? 0) + 1;
  return counts;
};
var unitCountByNation = (units) => {
  const counts = {};
  for (const u of units) counts[u.nation] = (counts[u.nation] ?? 0) + 1;
  return counts;
};

// src/lib/mapDefinition.ts
function canArmyEnter(t) {
  return t.type === "land" || t.type === "coast";
}
function canFleetEnter(t) {
  return t.type === "sea" || t.type === "coast";
}

// src/lib/adjudicator/rules.ts
var isLongRoute = (map, a, b) => (map.rules?.longRoutes ?? []).some(([x, y]) => x === a && y === b || x === b && y === a);
var canConvoyFrom = (map, province) => map.territories[province]?.type === "sea" || (map.rules?.convoyCoasts ?? []).includes(province);
var emergencyActive = (map, nation, owners) => {
  const e = map.rules?.emergency;
  if (!e || e.nation !== nation) return false;
  const homes = homeCenters(map, nation);
  const held = homes.filter((h) => owners[h] === nation).length;
  return held >= 1 && held < homes.length;
};
var unitAllowance = (map, nation, owners) => (scCountByNation(owners)[nation] ?? 0) + (emergencyActive(map, nation, owners) ? 1 : 0);
var nationsOf = (owners, units) => sortIds([.../* @__PURE__ */ new Set([...Object.values(owners), ...units.map((u) => u.nation)])]);
var ownedCenters = (map, nation, owners) => supplyCenterProvinces(map).filter((p) => owners[p] === nation);
var buildSites = (map, nation, owners, units) => {
  const occupied = new Set(units.map((u) => u.territory));
  const centers = map.rules?.buildAnyCenter ? ownedCenters(map, nation, owners) : homeCenters(map, nation);
  const sites = centers.filter((h) => owners[h] === nation && !occupied.has(h));
  const e = map.rules?.emergency;
  if (e && emergencyActive(map, nation, owners) && !occupied.has(e.buildSite)) sites.push(e.buildSite);
  return sortIds(sites);
};
var disorderHomes = (map, nation, owners) => map.rules?.buildAnyCenter ? ownedCenters(map, nation, owners) : sortIds([...homeCenters(map, nation), ...map.rules?.disorderHomes?.[nation] ?? []]);
var conversionTarget = (map, unit, owners) => {
  if (!map.rules?.conversion) return null;
  const t = map.territories[unit.territory];
  if (!t?.supplyCenter || owners[unit.territory] !== unit.nation) return null;
  if (unit.type === "fleet") return "army";
  return t.type === "coast" ? "fleet" : null;
};
var convertibleUnits = (map, nation, owners, units) => units.filter((u) => u.nation === nation && conversionTarget(map, u, owners)).sort((a, b) => a.territory < b.territory ? -1 : 1);

// src/lib/adjudicator/convoy.ts
var convoyFleets = (map, units) => new Set(units.filter((u) => u.type === "fleet" && canConvoyFrom(map, u.territory)).map((u) => u.territory));
var convoyChain = (map, from, fleets) => {
  const seen = /* @__PURE__ */ new Set();
  const queue = (map.territories[from]?.adjacent ?? []).filter((p) => fleets.has(p));
  queue.forEach((p) => seen.add(p));
  while (queue.length) {
    const p = queue.shift();
    for (const n of map.territories[p]?.adjacent ?? []) {
      if (fleets.has(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
};

// src/lib/adjudicator/graph.ts
var reachable = (map, unit) => {
  const t = map.territories[unit.territory];
  if (!t) return [];
  if (unit.type === "army") {
    return t.adjacent.filter((id) => {
      const adj = map.territories[id];
      return adj ? canArmyEnter(adj) : false;
    });
  }
  if (unit.coast && t.coasts?.[unit.coast]) {
    return [...t.coasts[unit.coast].fleetAdjacency];
  }
  if (t.fleetAdjacent) return [...t.fleetAdjacent];
  return t.adjacent.filter((id) => {
    const adj = map.territories[id];
    return adj ? canFleetEnter(adj) : false;
  });
};
var reachableCoasts = (map, target, from) => {
  const t = map.territories[target];
  if (!t?.coasts) return [];
  return Object.entries(t.coasts).filter(([, coast]) => coast.fleetAdjacency.includes(from)).map(([id]) => id);
};
var adjacentProvinces = (map, province) => {
  const t = map.territories[province];
  return t ? [...t.adjacent].sort() : [];
};
var directReach = (map, unit) => reachable(map, unit);
var canMoveDirect = (map, unit, dest) => reachable(map, unit).includes(dest);
var landingCoasts = (map, target, from) => reachableCoasts(map, target, from);
var convoyPathExists = (map, from, to, convoyFleets2, lastHopOk = () => true) => {
  if (from === to) return false;
  return [...convoyChain(map, from, convoyFleets2)].some(
    (sea) => adjacentProvinces(map, sea).includes(to) && lastHopOk(sea)
  );
};

// src/lib/adjudicator/movement.ts
function resolveMovement(map, board, orders) {
  const units = board.units;
  const mo = [];
  const byProvince = /* @__PURE__ */ new Map();
  const submitted = /* @__PURE__ */ new Map();
  const ownerOf = new Map(units.map((u) => [u.territory, u.nation]));
  for (const o of orders) {
    const prev = submitted.get(o.source);
    if (prev && prev.nation === ownerOf.get(o.source) && o.nation !== ownerOf.get(o.source)) continue;
    submitted.set(o.source, o);
  }
  const convoyIntents = /* @__PURE__ */ new Set();
  for (const o of orders) {
    if (o.type === "Convoy" && o.aux && o.target) convoyIntents.add(`${o.aux}->${o.target}`);
  }
  for (const unit of sortUnits(units)) {
    const o = submitted.get(unit.territory);
    const entry = normalize(map, unit, o, units, convoyIntents);
    mo.push(entry);
    byProvince.set(unit.territory, entry);
  }
  mo.forEach((m, i) => m.idx = i);
  const N = mo.length;
  const state = new Array(N).fill("unresolved");
  const resolution = new Array(N).fill(false);
  const deps = [];
  const moveOrdersInto = (province) => mo.filter((m) => m.kind === "move" && !m.void && m.dst === province);
  const matchingSupports = (m) => mo.filter(
    (s) => s.kind === "support" && !s.void && s.aux === m.src && s.dst === m.dst
  );
  const matchingConvoys = (m) => mo.filter((c) => c.kind === "convoy" && !c.void && c.aux === m.src && c.dst === m.dst);
  const convoyRouteExists = (m) => {
    const fleets = new Set(matchingConvoys(m).filter((c) => resolve(c.idx)).map((c) => c.src));
    return convoyPathExists(map, m.src, m.dst, fleets);
  };
  const hasPath = (m) => {
    if (m.unit.type === "fleet") return true;
    if (m.viaConvoy) return convoyRouteExists(m);
    if (canMoveDirect(map, m.unit, m.dst)) return true;
    return convoyRouteExists(m);
  };
  const isConvoyedMove = (m) => {
    if (m.unit.type !== "army" || m.void) return false;
    if (m.viaConvoy) return convoyRouteExists(m);
    if (matchingConvoys(m).length === 0) return false;
    return convoyRouteExists(m);
  };
  const baseStrength = (m) => {
    if (isConvoyedMove(m)) {
      const fleets = new Set(matchingConvoys(m).filter((c) => resolve(c.idx)).map((c) => c.src));
      return convoyPathExists(map, m.src, m.dst, fleets, (sea) => !isLongRoute(map, sea, m.dst)) ? 1 : 0.5;
    }
    return isLongRoute(map, m.src, m.dst) ? 0.5 : 1;
  };
  const headToHeadOpponent = (m) => {
    if (m.kind !== "move" || m.void) return void 0;
    const o = byProvince.get(m.dst);
    if (!o || o.kind !== "move" || o.void) return void 0;
    if (o.dst !== m.src) return void 0;
    if (isConvoyedMove(m) || isConvoyedMove(o)) return void 0;
    return o;
  };
  const supportCut = (s) => {
    if (moveOrdersInto(s.src).some((m) => resolve(m.idx))) return true;
    for (const m of moveOrdersInto(s.src)) {
      if (m.src === s.dst) continue;
      if (isLongRoute(map, m.src, s.src)) continue;
      if (m.unit.nation === s.unit.nation) continue;
      if (hasPath(m)) return true;
    }
    return false;
  };
  const supportCount = (m, excludeNation) => matchingSupports(m).filter(
    (s) => !resolveSupportCut(s) && (!excludeNation || s.unit.nation !== excludeNation)
  ).length;
  const resolveSupportCut = (s) => !resolve(s.idx);
  const holdStrength = (province) => {
    const occ = byProvince.get(province);
    if (!occ) return 0;
    if (occ.kind === "move" && !occ.void) return resolve(occ.idx) ? 0 : 1;
    const supports = mo.filter(
      (s) => s.kind === "support" && !s.void && s.aux === province && s.dst === province
    );
    return 1 + supports.filter((s) => !resolveSupportCut(s)).length;
  };
  const attackStrength = (m) => {
    if (!hasPath(m)) return 0;
    const occ = byProvince.get(m.dst);
    let vacated = !occ;
    if (occ && occ.kind === "move" && !occ.void) {
      const h2h = headToHeadOpponent(m);
      if (!(h2h && h2h.idx === occ.idx)) vacated = resolve(occ.idx);
    }
    if (vacated) return baseStrength(m) + supportCount(m);
    if (occ.unit.nation === m.unit.nation) return 0;
    return baseStrength(m) + supportCount(m, occ.unit.nation);
  };
  const defendStrength = (m) => baseStrength(m) + supportCount(m);
  const preventStrength = (m) => {
    if (!hasPath(m)) return 0;
    const h2h = headToHeadOpponent(m);
    if (h2h && resolve(h2h.idx)) return 0;
    return baseStrength(m) + supportCount(m);
  };
  const moveSucceeds = (m) => {
    if (!hasPath(m)) return false;
    const atk = attackStrength(m);
    if (atk <= 0) return false;
    for (const other of moveOrdersInto(m.dst)) {
      if (other.idx === m.idx) continue;
      if (atk <= preventStrength(other)) return false;
    }
    const h2h = headToHeadOpponent(m);
    if (h2h) return atk > defendStrength(h2h);
    return atk > holdStrength(m.dst);
  };
  const convoyDisrupted = (c) => moveOrdersInto(c.src).some((m) => resolve(m.idx));
  const adjudicate2 = (idx) => {
    const o = mo[idx];
    if (o.void) return false;
    switch (o.kind) {
      case "hold":
        return true;
      case "move":
        return moveSucceeds(o);
      case "support":
        return !supportCut(o);
      case "convoy":
        return !convoyDisrupted(o);
    }
  };
  function resolve(idx) {
    if (state[idx] === "resolved") return resolution[idx];
    if (state[idx] === "guessing") {
      if (!deps.includes(idx)) deps.push(idx);
      return resolution[idx];
    }
    const oldDeps = deps.length;
    resolution[idx] = false;
    state[idx] = "guessing";
    const first = adjudicate2(idx);
    if (deps.length === oldDeps) {
      if (state[idx] !== "resolved") {
        resolution[idx] = first;
        state[idx] = "resolved";
      }
      return resolution[idx];
    }
    if (deps[oldDeps] !== idx) {
      if (!deps.includes(idx)) deps.push(idx);
      resolution[idx] = first;
      return first;
    }
    for (let i = oldDeps; i < deps.length; i++) state[deps[i]] = "unresolved";
    resolution[idx] = true;
    state[idx] = "guessing";
    const second = adjudicate2(idx);
    if (first === second) {
      for (let i = oldDeps; i < deps.length; i++) state[deps[i]] = "unresolved";
      deps.length = oldDeps;
      resolution[idx] = first;
      state[idx] = "resolved";
      return first;
    }
    const cycle = deps.slice(oldDeps);
    const pinned = backupRule(cycle);
    for (const i of cycle) if (!pinned.has(i)) state[i] = "unresolved";
    deps.length = oldDeps;
    return resolve(idx);
  }
  function backupRule(cycle) {
    const pinned = /* @__PURE__ */ new Set();
    const pin = (idx, value) => {
      resolution[idx] = value;
      state[idx] = "resolved";
      pinned.add(idx);
    };
    const orders2 = sortIds(cycle.map(String)).map((s) => mo[Number(s)]);
    const convoysInCycle = orders2.filter((o) => o.kind === "convoy");
    if (convoysInCycle.length) {
      for (const c of convoysInCycle) {
        pin(c.idx, false);
        const carried = mo.find(
          (m) => m.kind === "move" && !m.void && m.src === c.aux && m.dst === c.dst
        );
        if (carried) pin(carried.idx, false);
      }
    } else {
      for (const o of orders2) if (o.kind === "move") pin(o.idx, true);
    }
    return pinned;
  }
  for (let i = 0; i < N; i++) resolve(i);
  const results = [];
  const moved = /* @__PURE__ */ new Set();
  const nextUnits = [];
  const dislodged = [];
  for (const m of mo) {
    if (m.kind === "move" && !m.void && resolution[m.idx]) moved.add(m.src);
  }
  for (const m of mo) {
    const occupantStays = !(m.kind === "move" && !m.void && resolution[m.idx]);
    if (!occupantStays) {
      const dest = m.dst;
      const coast = m.unit.type === "fleet" ? m.dstCoast : void 0;
      nextUnits.push({ ...m.unit, territory: dest, coast });
      continue;
    }
    const attackers = moveOrdersInto(m.src).filter((a) => resolution[a.idx]);
    if (attackers.length > 0) {
      const from = isConvoyedMove(attackers[0]) ? "" : attackers[0].src;
      dislodged.push({ unit: { ...m.unit }, attackedFrom: from });
    } else {
      nextUnits.push({ ...m.unit });
    }
  }
  const contested = [];
  const destinations = sortIds([...new Set(mo.filter((m) => m.kind === "move" && !m.void).map((m) => m.dst))]);
  for (const d of destinations) {
    const into = moveOrdersInto(d);
    const anySucceeded = into.some((m) => resolution[m.idx]);
    const occupiedAfter = nextUnits.some((u) => u.territory === d);
    if (!anySucceeded && !occupiedAfter && into.filter((m) => hasPath(m)).length >= 2) {
      contested.push(d);
    }
  }
  for (const m of mo) {
    let code;
    let reason;
    if (m.void) {
      code = "void";
      reason = m.reason;
    } else if (m.kind === "move") {
      if (resolution[m.idx]) {
        code = "succeeds";
        reason = "move succeeds";
      } else {
        code = "fails";
        reason = "move bounced or unsupported";
      }
    } else if (m.kind === "support") {
      code = resolution[m.idx] ? "succeeds" : "fails";
      reason = resolution[m.idx] ? "support given" : "support cut";
    } else if (m.kind === "convoy") {
      code = resolution[m.idx] ? "succeeds" : "fails";
      reason = resolution[m.idx] ? "convoy holds" : "convoying fleet dislodged";
    } else {
      const wasDislodged = dislodged.some((d) => d.unit.territory === m.src);
      code = wasDislodged ? "dislodged" : "succeeds";
      reason = wasDislodged ? "unit dislodged" : "unit holds";
    }
    if (code !== "void" && dislodged.some((d) => d.unit.territory === m.src) && !(m.kind === "move" && resolution[m.idx])) {
      code = "dislodged";
      reason = "unit dislodged";
    }
    results.push({ order: m.order, code, reason });
  }
  return {
    units: sortUnits(nextUnits),
    dislodged: dislodged.sort((a, b) => a.unit.territory < b.unit.territory ? -1 : 1),
    contested: sortIds(contested),
    results: results.sort((a, b) => orderSrc(a) < orderSrc(b) ? -1 : 1)
  };
}
var orderSrc = (r) => r.order.source;
function normalize(map, unit, o, units, convoyIntents) {
  const base = (kind, extra = {}) => ({
    idx: -1,
    kind,
    order: o ?? { type: "Hold", nation: unit.nation, source: unit.territory },
    unit,
    src: unit.territory,
    void: false,
    reason: "",
    ...extra
  });
  if (o && o.nation !== unit.nation) {
    return voidify(base("hold"), "ordering another power's unit");
  }
  if (!o || o.type === "Hold") return base("hold");
  if (o.type === "Move") {
    const m = base("move", { dst: o.target, dstCoast: o.targetCoast, viaConvoy: o.viaConvoy });
    if (!o.target) return voidify(m, "move without destination");
    if (o.sourceCoast && o.sourceCoast !== unit.coast) {
      return voidify(m, "order specifies the wrong source coast");
    }
    if (unit.type === "army") {
      if (o.targetCoast) return voidify(m, "army cannot be ordered to a coast");
      if (canMoveDirect(map, unit, o.target) && !o.viaConvoy) return m;
      if (o.viaConvoy) return m;
      if (convoyIntents.has(`${unit.territory}->${o.target}`) || convoyPathExists(map, unit.territory, o.target, convoyFleets(map, units))) {
        return m;
      }
      return voidify(m, "illegal move (no possible convoy)");
    }
    if (!validMoveLegality(map, unit, o.target, o.targetCoast)) {
      return voidify(m, "illegal move (non-adjacent / coast)");
    }
    return m;
  }
  if (o.type === "Support") {
    const s = base("support", { aux: o.aux, dst: o.target ?? o.aux });
    if (!o.aux) return voidify(s, "support without target");
    if (!canMoveDirect(map, unit, s.dst) && s.dst !== unit.territory) {
      return voidify(s, "support of unreachable province");
    }
    if (isLongRoute(map, unit.territory, s.dst)) {
      return voidify(s, "cannot support along a long route");
    }
    return s;
  }
  if (o.type === "Convoy") {
    const c = base("convoy", { aux: o.aux, dst: o.target });
    if (unit.type !== "fleet" || !canConvoyFrom(map, unit.territory)) {
      return voidify(c, "only a fleet at sea may convoy");
    }
    if (!o.aux || !o.target) return voidify(c, "convoy without army/destination");
    const army = unitAt(units, o.aux);
    if (!army || army.type !== "army") return voidify(c, "convoyed unit is not an army");
    return c;
  }
  return base("hold");
}
function voidify(m, reason) {
  m.void = true;
  m.reason = reason;
  return m;
}
function validMoveLegality(map, unit, dest, destCoast) {
  const destT = map.territories[dest];
  if (!destT) return false;
  if (unit.type === "army") return canMoveDirect(map, unit, dest);
  if (!canMoveDirect(map, unit, dest)) return false;
  if (destT.coasts) {
    const valid = landingCoasts(map, dest, unit.territory);
    if (valid.length === 0) return false;
    if (!destCoast) return false;
    if (!valid.includes(destCoast)) return false;
  }
  return true;
}

// src/lib/adjudicator/retreat.ts
function resolveRetreat(map, board, orders) {
  const results = [];
  const survivors = board.units.map((u) => ({ ...u }));
  const occupied = new Set(survivors.map((u) => u.territory));
  const ownerOf = new Map(board.dislodged.map((d) => [d.unit.territory, d.unit.nation]));
  const byProvince = /* @__PURE__ */ new Map();
  for (const o of orders) if (o.nation === ownerOf.get(o.source)) byProvince.set(o.source, o);
  const dislodgedSet = new Set(board.dislodged.map((d) => d.unit.territory));
  for (const o of orders) {
    if (!dislodgedSet.has(o.source)) {
      results.push({ order: o, code: "void", reason: "no dislodged unit to retreat" });
    } else if (o.nation !== ownerOf.get(o.source)) {
      results.push({ order: o, code: "void", reason: "ordering another power's unit" });
    }
  }
  const intents = [];
  for (const dis of board.dislodged) {
    const o = byProvince.get(dis.unit.territory);
    if (!o || o.type === "Disband" || !o.target) {
      results.push({
        order: o ?? disbandOrder(dis.unit),
        code: "disbanded",
        reason: o ? "disband ordered" : "no retreat ordered"
      });
      continue;
    }
    if (!legalRetreat(map, dis, o.target, o.targetCoast, occupied, board.contested)) {
      results.push({ order: o, code: "disbanded", reason: "illegal retreat target" });
      continue;
    }
    intents.push({ dis, dest: o.target, coast: o.targetCoast, order: o });
  }
  const byDest = /* @__PURE__ */ new Map();
  for (const it of intents) byDest.set(it.dest, [...byDest.get(it.dest) ?? [], it]);
  const longRetreat = (it) => isLongRoute(map, it.dis.unit.territory, it.dest);
  for (const it of intents) {
    const rivals = byDest.get(it.dest) ?? [];
    const ordinary = rivals.filter((r) => !longRetreat(r));
    const wins = rivals.length === 1 || ordinary.length === 1 && ordinary[0] === it;
    if (!wins) {
      results.push({ order: it.order, code: "disbanded", reason: "retreats bounced" });
      continue;
    }
    survivors.push({ ...it.dis.unit, territory: it.dest, coast: it.coast });
    results.push({ order: it.order, code: "succeeds", reason: "retreat succeeds" });
  }
  return { units: sortUnits(survivors), results };
}
var isRetreatBlocked = (dest, attackedFrom, occupied, contested) => occupied.has(dest) || dest === attackedFrom || contested.includes(dest);
function retreatTargets(map, unit, attackedFrom, occupied, contested) {
  const out = [];
  for (const province of directReach(map, unit)) {
    if (isRetreatBlocked(province, attackedFrom, occupied, contested)) continue;
    if (unit.type === "fleet" && map.territories[province]?.coasts) {
      const coasts = landingCoasts(map, province, unit.territory);
      if (coasts.length) out.push({ province, coasts });
    } else out.push({ province, coasts: [] });
  }
  return out;
}
function legalRetreat(map, dis, dest, coast, occupied, contested) {
  const target = retreatTargets(map, dis.unit, dis.attackedFrom, occupied, contested).find((t) => t.province === dest);
  if (!target) return false;
  if (target.coasts.length) {
    if (coast && !target.coasts.includes(coast)) return false;
    if (!coast && target.coasts.length > 1) return false;
  }
  return true;
}
var disbandOrder = (u) => ({
  type: "Disband",
  nation: u.nation,
  source: u.territory
});

// src/lib/adjudicator/build.ts
function resolveBuild(map, board, orders) {
  const owners = board.supplyCenters;
  const unitCount = unitCountByNation(board.units);
  const units = board.units.map((u) => ({ ...u }));
  const results = [];
  const occupied = new Set(units.map((u) => u.territory));
  const nations = nationsOf(owners, board.units);
  const ordersByNation = /* @__PURE__ */ new Map();
  for (const o of orders) {
    const list = ordersByNation.get(o.nation) ?? [];
    list.push(o);
    ordersByNation.set(o.nation, list);
  }
  for (const nation of nations) {
    const delta = unitAllowance(map, nation, owners) - (unitCount[nation] ?? 0);
    const all = ordersByNation.get(nation) ?? [];
    const nationOrders = all.filter((o) => o.type !== "Convert");
    if (delta > 0) {
      const homes = buildSites(map, nation, owners, units);
      let built = 0;
      for (const o of nationOrders) {
        if (o.type !== "Build") {
          results.push({ order: o, code: "void", reason: "not a build phase surplus" });
          continue;
        }
        if (built >= delta) {
          results.push({ order: o, code: "void", reason: "exceeds allowed builds" });
          continue;
        }
        if (!homes.includes(o.source) || occupied.has(o.source)) {
          results.push({ order: o, code: "void", reason: "not a buildable home center" });
          continue;
        }
        const t = map.territories[o.source];
        if (o.unitType === "fleet" && t.type !== "coast") {
          results.push({ order: o, code: "void", reason: "cannot build fleet inland" });
          continue;
        }
        if (o.unitType === "fleet" && t.coasts && !o.sourceCoast) {
          results.push({ order: o, code: "void", reason: "fleet build needs a coast" });
          continue;
        }
        units.push({
          type: o.unitType ?? "army",
          nation,
          territory: o.source,
          coast: o.unitType === "fleet" ? o.sourceCoast : void 0
        });
        occupied.add(o.source);
        built++;
        results.push({ order: o, code: "succeeds", reason: "unit built" });
      }
    } else if (delta < 0) {
      const need = -delta;
      const removed = /* @__PURE__ */ new Set();
      for (const o of nationOrders) {
        if (o.type !== "Remove") {
          results.push({ order: o, code: "void", reason: "removal required, not build" });
          continue;
        }
        if (removed.size >= need) {
          results.push({ order: o, code: "void", reason: "too many removals" });
          continue;
        }
        const idx = units.findIndex((u) => u.nation === nation && u.territory === o.source);
        if (idx < 0) {
          results.push({ order: o, code: "void", reason: "no such unit to remove" });
          continue;
        }
        removed.add(o.source);
        results.push({ order: o, code: "succeeds", reason: "unit removed" });
      }
      if (removed.size < need) {
        const candidates = units.filter((u) => u.nation === nation && !removed.has(u.territory)).sort(civilDisorderOrder(map, nation, owners));
        for (let i = 0; removed.size < need && i < candidates.length; i++) {
          removed.add(candidates[i].territory);
        }
      }
      for (const prov of removed) {
        const idx = units.findIndex((u) => u.territory === prov && u.nation === nation);
        if (idx >= 0) units.splice(idx, 1);
      }
    } else {
      for (const o of nationOrders) {
        results.push({ order: o, code: "void", reason: "no adjustment owed" });
      }
    }
    const converted = /* @__PURE__ */ new Set();
    for (const o of all.filter((x) => x.type === "Convert")) {
      if (!map.rules?.conversion) {
        results.push({ order: o, code: "void", reason: "conversion not allowed on this map" });
        continue;
      }
      const idx = units.findIndex((u) => u.nation === nation && u.territory === o.source);
      const before = board.units.find((u) => u.nation === nation && u.territory === o.source);
      if (idx < 0 || !before) {
        results.push({ order: o, code: "void", reason: before ? "unit removed" : "no such unit to convert" });
        continue;
      }
      if (converted.has(o.source)) {
        results.push({ order: o, code: "void", reason: "unit already converted" });
        continue;
      }
      const target = conversionTarget(map, before, owners);
      if (!target || o.unitType !== target) {
        results.push({ order: o, code: "void", reason: "cannot convert here" });
        continue;
      }
      if (target === "fleet" && map.territories[o.source].coasts && !o.sourceCoast) {
        results.push({ order: o, code: "void", reason: "fleet needs a coast" });
        continue;
      }
      units[idx] = { ...units[idx], type: target, coast: target === "fleet" ? o.sourceCoast : void 0 };
      converted.add(o.source);
      results.push({ order: o, code: "succeeds", reason: "unit converted" });
    }
  }
  return { units: sortUnits(units), results };
}
function civilDisorderOrder(map, nation, owners) {
  const homes = disorderHomes(map, nation, owners);
  const dist = (u) => distanceToNearest(map, u, homes);
  return (a, b) => {
    const da = dist(a);
    const db = dist(b);
    if (da !== db) return db - da;
    if (a.type !== b.type) return a.type === "fleet" ? -1 : 1;
    return a.territory < b.territory ? -1 : 1;
  };
}
function distanceToNearest(map, unit, homes) {
  if (homes.includes(unit.territory)) return 0;
  const visited = /* @__PURE__ */ new Set([unit.territory]);
  let frontier = [unit.territory];
  let d = 0;
  while (frontier.length) {
    d++;
    const next = [];
    for (const p of frontier) {
      for (const n of map.territories[p]?.adjacent ?? []) {
        if (visited.has(n)) continue;
        visited.add(n);
        if (homes.includes(n)) return d;
        next.push(n);
      }
    }
    frontier = next.sort();
    if (d > 100) break;
  }
  return 999;
}

// src/lib/adjudicator/idle.ts
function isIdle(map, board, nation) {
  if (board.phase === "retreat") return !board.dislodged.some((d) => d.unit.nation === nation);
  if (board.phase === "build") {
    const delta = unitAllowance(map, nation, board.supplyCenters) - (unitCountByNation(board.units)[nation] ?? 0);
    if (delta < 0) return false;
    if (convertibleUnits(map, nation, board.supplyCenters, board.units).length) return false;
    return delta === 0 || buildSites(map, nation, board.supplyCenters, board.units).length === 0;
  }
  return !board.units.some((u) => u.nation === nation);
}
function idleNations(map, board) {
  return nationsOf(board.supplyCenters, board.units).filter((n) => isIdle(map, board, n));
}

// src/lib/adjudicator/resolve.ts
function adjudicate(map, board, orders) {
  switch (board.phase) {
    case "movement": {
      const out = resolveMovement(map, board, orders);
      const next = out.dislodged.length > 0 ? {
        phase: "retreat",
        season: board.season,
        year: board.year,
        units: out.units,
        supplyCenters: board.supplyCenters,
        dislodged: out.dislodged,
        contested: out.contested
      } : advanceAfterRetreats(map, board.season, board.year, out.units, board.supplyCenters);
      return finalize(map, { ...board, ...next, mapId: board.mapId }, out.results);
    }
    case "retreat": {
      const out = resolveRetreat(map, board, orders);
      const next = advanceAfterRetreats(map, board.season, board.year, out.units, board.supplyCenters);
      return finalize(map, { ...board, ...next, mapId: board.mapId }, out.results);
    }
    case "build": {
      const out = resolveBuild(map, board, orders);
      const next = {
        mapId: board.mapId,
        phase: "movement",
        season: "Spring",
        year: board.year + 1,
        units: out.units,
        supplyCenters: board.supplyCenters,
        dislodged: [],
        contested: []
      };
      return finalize(map, next, out.results);
    }
  }
}
function advanceAfterRetreats(map, season, year, units, owners) {
  if (season === "Spring") {
    return { phase: "movement", season: "Fall", year, units, supplyCenters: owners, dislodged: [], contested: [] };
  }
  const newOwners = recomputeSupplyCenters(map, units, owners);
  const build = { phase: "build", season: "Fall", year, units, supplyCenters: newOwners, dislodged: [], contested: [] };
  if (nationsOf(newOwners, units).some((n) => !isIdle(map, build, n))) return build;
  return { phase: "movement", season: "Spring", year: year + 1, units, supplyCenters: newOwners, dislodged: [], contested: [] };
}
function finalize(map, next, results) {
  return { newBoardState: next, results, victory: victoryFor(map, next.supplyCenters) };
}
function victoryThreshold(map) {
  return map.victoryCenters ?? Math.floor(supplyCenterProvinces(map).length / 2) + 1;
}
function victoryFor(map, owners) {
  const sc = scCountByNation(owners);
  const threshold = victoryThreshold(map);
  let victory;
  for (const [nation, centers] of Object.entries(sc)) {
    if (centers >= threshold && (!victory || centers > victory.centers)) {
      victory = { nation, centers };
    }
  }
  if (victory && map.rules?.sharedVictory) {
    const lead = victory;
    const tied = Object.entries(sc).filter(([, c]) => c === lead.centers).map(([n]) => n).sort();
    victory = tied.length > 1 ? { nation: tied[0], centers: lead.centers, shared: tied } : { nation: lead.nation, centers: lead.centers };
  }
  if (victory && map.rules?.strictVictory) {
    const lead = victory;
    if (Object.entries(sc).some(([n, c]) => n !== lead.nation && c >= lead.centers)) victory = void 0;
  }
  return victory;
}

// src/lib/phases.ts
var ORDER_PHASES = ["movement", "retreat", "build"];
var isOrderPhase = (p) => ORDER_PHASES.includes(p ?? "");

// src/lib/adjudicator/fold.ts
var SEASON_ORDER = { Spring: 0, Fall: 1 };
var PHASE_ORDER = Object.fromEntries(ORDER_PHASES.map((p, i) => [p, i]));
var roundRank = (r) => r.year * 100 + (SEASON_ORDER[r.season] ?? 0) * 10 + (PHASE_ORDER[r.phase] ?? 0);
function replayLog(map, initial, rows, until) {
  const rounds = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const key = `${r.year}|${r.season}|${r.phase}`;
    const round = rounds.get(key) ?? { year: r.year, season: r.season, phase: r.phase, orders: [] };
    round.orders.push(...(r.orders ?? []).map((o) => ({ ...o, nation: r.nation })));
    rounds.set(key, round);
  }
  const ordered = [...rounds.values()].sort((a, b) => roundRank(a) - roundRank(b));
  const frames = [];
  const pushFrame = (board, orders) => {
    const { newBoardState, results } = adjudicate(map, board, orders);
    frames.push({ board, orders, results });
    return newBoardState;
  };
  let state = initial;
  for (const round of ordered) {
    for (let guard = 0; roundRank(state) < roundRank(round) && guard < 1e3; guard++) {
      state = pushFrame(state, []);
    }
    if (roundRank(state) > roundRank(round)) continue;
    state = pushFrame(state, round.orders);
  }
  for (let guard = 0; until && PHASE_ORDER[until.phase] !== void 0 && roundRank(state) < roundRank(until) && guard < 1e3; guard++) {
    state = pushFrame(state, []);
  }
  frames.push({ board: state, orders: [] });
  return frames;
}

// src/lib/adjudicator/index.ts
function seedOwnership(map, units) {
  const owners = { ...map.initialOwnership };
  for (const [id, t] of Object.entries(map.territories)) {
    if (t.supplyCenter && t.homePower) owners[id] = t.homePower;
  }
  return recomputeSupplyCenters(map, units, owners);
}
function boardFromUnits(map, units, year, season, phase) {
  return {
    mapId: map.id,
    year,
    season,
    phase,
    units: sortUnits(units),
    supplyCenters: seedOwnership(map, units),
    dislodged: [],
    contested: []
  };
}
function startingUnits(map) {
  return map.startingUnits.map((u) => ({
    type: u.type,
    nation: u.power,
    territory: u.territory,
    coast: u.coast
  }));
}
function initialBoard(map) {
  return boardFromUnits(map, startingUnits(map), map.startingYear ?? 1901, "Spring", "movement");
}

// src/lib/maps/classical.ts
var classicalMap = {
  id: "classical",
  name: "Classical",
  description: "Classic Diplomacy \u2014 Europe 1901, 7 great powers, 34 supply centers",
  playerCount: 7,
  startingYear: 1901,
  victoryCenters: 18,
  // a majority of the 34
  powers: [
    // OKLCH-balanced palette (hues preserved). Most powers sit at L=0.66; chroma is pushed
    // per-hue toward each one's gamut so reds/blues/purples stay vivid. Turkey is lifted to
    // L=0.80 so its amber reads as gold, not brown (brown = a dark, low-chroma amber).
    { id: "england", name: "England", color: "#4b85fe" },
    // L.64 C.190 h263 (royal blue)
    { id: "france", name: "France", color: "#00bdd5" },
    // L.73 C.130 h210 (bright cyan — lighter + hue-shifted off England's blue)
    { id: "germany", name: "Germany", color: "#8c929f" },
    // L.66 C.020 (neutral)
    { id: "italy", name: "Italy", color: "#4aa961" },
    // L.66 C.140 h149
    { id: "austria", name: "Austria-Hungary", color: "#f0574e" },
    // L.66 C.190 h27
    { id: "russia", name: "Russia", color: "#9975fa" },
    // L.66 C.190 h293
    { id: "turkey", name: "Turkey", color: "#f5af20" }
    // L.80 C.160 h78
  ],
  territories: {
    // ──────────────────────────── ENGLAND ────────────────────────────
    CLY: {
      name: "Clyde",
      type: "coast",
      supplyCenter: false,
      adjacent: ["EDI", "LVP", "NWG", "NAO"],
      fleetAdjacent: ["EDI", "LVP", "NWG", "NAO"]
    },
    EDI: {
      name: "Edinburgh",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["CLY", "YOR", "LVP", "NTH", "NWG"],
      fleetAdjacent: ["CLY", "YOR", "NTH", "NWG"]
    },
    LVP: {
      name: "Liverpool",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["CLY", "EDI", "YOR", "WAL", "NAO", "IRI"],
      fleetAdjacent: ["CLY", "WAL", "NAO", "IRI"]
    },
    YOR: {
      name: "Yorkshire",
      type: "coast",
      supplyCenter: false,
      adjacent: ["EDI", "LVP", "LON", "WAL", "NTH"],
      fleetAdjacent: ["EDI", "LON", "NTH"]
    },
    WAL: {
      name: "Wales",
      type: "coast",
      supplyCenter: false,
      adjacent: ["LVP", "YOR", "LON", "ENG", "IRI"],
      fleetAdjacent: ["LVP", "LON", "ENG", "IRI"]
    },
    LON: {
      name: "London",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["YOR", "WAL", "NTH", "ENG"],
      fleetAdjacent: ["YOR", "WAL", "NTH", "ENG"]
    },
    // ──────────────────────────── FRANCE ────────────────────────────
    BRE: {
      name: "Brest",
      type: "coast",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["PIC", "PAR", "GAS", "ENG", "MAO"],
      fleetAdjacent: ["PIC", "GAS", "ENG", "MAO"]
    },
    PIC: {
      name: "Picardy",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BRE", "PAR", "BUR", "BEL", "ENG"],
      fleetAdjacent: ["BRE", "BEL", "ENG"]
    },
    PAR: {
      name: "Paris",
      type: "land",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["BRE", "PIC", "BUR", "GAS"]
    },
    BUR: {
      name: "Burgundy",
      type: "land",
      supplyCenter: false,
      adjacent: ["PIC", "PAR", "GAS", "MAR", "BEL", "RUH", "MUN"]
    },
    GAS: {
      name: "Gascony",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BRE", "PAR", "BUR", "MAR", "SPA", "MAO"],
      // Not MAR: Gascony and Marseilles share only a land border, no coastline.
      fleetAdjacent: ["BRE", "SPA", "MAO"]
    },
    MAR: {
      name: "Marseilles",
      type: "coast",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["GAS", "BUR", "PIE", "SPA", "GOL"],
      // Not GAS: land border only.
      fleetAdjacent: ["PIE", "SPA", "GOL"]
    },
    // ──────────────────────────── GERMANY ────────────────────────────
    KIE: {
      name: "Kiel",
      type: "coast",
      supplyCenter: true,
      homePower: "germany",
      // BAL belongs here (Kiel is the canal joining HEL and BAL); it was missing,
      // which broke F Kie–Bal and convoys staged out of Kiel via the Baltic.
      adjacent: ["HOL", "DEN", "BER", "MUN", "RUH", "HEL", "BAL"],
      fleetAdjacent: ["HOL", "DEN", "BER", "HEL", "BAL"]
    },
    BER: {
      name: "Berlin",
      type: "coast",
      supplyCenter: true,
      homePower: "germany",
      adjacent: ["KIE", "MUN", "SIL", "PRU", "BAL"],
      fleetAdjacent: ["KIE", "PRU", "BAL"]
    },
    MUN: {
      name: "Munich",
      type: "land",
      supplyCenter: true,
      homePower: "germany",
      adjacent: ["KIE", "BER", "SIL", "BOH", "TYR", "BUR", "RUH"]
    },
    PRU: {
      name: "Prussia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BER", "SIL", "WAR", "LVN", "BAL"],
      fleetAdjacent: ["BER", "LVN", "BAL"]
    },
    RUH: {
      name: "Ruhr",
      type: "land",
      supplyCenter: false,
      adjacent: ["BEL", "HOL", "KIE", "MUN", "BUR"]
    },
    SIL: {
      name: "Silesia",
      type: "land",
      supplyCenter: false,
      adjacent: ["MUN", "BER", "PRU", "WAR", "GAL", "BOH"]
    },
    // ──────────────────────────── ITALY ────────────────────────────
    PIE: {
      name: "Piedmont",
      type: "coast",
      supplyCenter: false,
      adjacent: ["MAR", "TYR", "VEN", "TUS", "GOL"],
      // Not VEN: Piedmont (Ligurian coast) and Venice (Adriatic) share land only.
      fleetAdjacent: ["MAR", "TUS", "GOL"]
    },
    VEN: {
      name: "Venice",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["PIE", "TYR", "TRI", "TUS", "APU", "ADR", "ROM"],
      // Not PIE/TUS/ROM: those border Venice by land only (Venice is Adriatic-side).
      fleetAdjacent: ["TRI", "APU", "ADR"]
    },
    TUS: {
      name: "Tuscany",
      type: "coast",
      supplyCenter: false,
      adjacent: ["PIE", "VEN", "ROM", "GOL", "TYS"],
      // Not VEN: land border only.
      fleetAdjacent: ["PIE", "ROM", "GOL", "TYS"]
    },
    ROM: {
      name: "Rome",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["TUS", "NAP", "APU", "TYS", "VEN"],
      // Not APU/VEN: both border Rome by land only (DATC 6.A.9 / 6.A.10).
      fleetAdjacent: ["TUS", "NAP", "TYS"]
    },
    NAP: {
      name: "Naples",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["ROM", "APU", "TYS", "ION"],
      fleetAdjacent: ["ROM", "APU", "TYS", "ION"]
    },
    APU: {
      name: "Apulia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["VEN", "ROM", "NAP", "ADR", "ION"],
      // Not ROM: land border only (Apulia is Adriatic/Ionian-side).
      fleetAdjacent: ["VEN", "NAP", "ADR", "ION"]
    },
    // ──────────────────────────── AUSTRIA-HUNGARY ────────────────────────────
    BOH: {
      name: "Bohemia",
      type: "land",
      supplyCenter: false,
      adjacent: ["MUN", "SIL", "GAL", "VIE", "TYR"]
    },
    TYR: {
      name: "Tyrolia",
      type: "land",
      supplyCenter: false,
      adjacent: ["MUN", "BOH", "VIE", "TRI", "VEN", "PIE"]
    },
    VIE: {
      name: "Vienna",
      type: "land",
      supplyCenter: true,
      homePower: "austria",
      adjacent: ["BOH", "GAL", "BUD", "TRI", "TYR"]
    },
    TRI: {
      name: "Trieste",
      type: "coast",
      supplyCenter: true,
      homePower: "austria",
      adjacent: ["TYR", "VIE", "BUD", "SER", "ALB", "ADR", "VEN"],
      fleetAdjacent: ["ALB", "ADR", "VEN"]
    },
    BUD: {
      name: "Budapest",
      type: "land",
      supplyCenter: true,
      homePower: "austria",
      adjacent: ["VIE", "GAL", "RUM", "SER", "TRI"]
    },
    GAL: {
      name: "Galicia",
      type: "land",
      supplyCenter: false,
      adjacent: ["BOH", "SIL", "WAR", "UKR", "RUM", "BUD", "VIE"]
    },
    // ──────────────────────────── RUSSIA ────────────────────────────
    STP: {
      name: "St. Petersburg",
      type: "coast",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["NOR", "FIN", "MOS", "LVN", "BAR", "BOT"],
      coasts: {
        nc: { name: "North Coast", fleetAdjacency: ["BAR", "NOR"] },
        sc: { name: "South Coast", fleetAdjacency: ["BOT", "LVN", "FIN"] }
      }
    },
    MOS: {
      name: "Moscow",
      type: "land",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["STP", "LVN", "WAR", "UKR", "SEV"]
    },
    FIN: {
      name: "Finland",
      type: "coast",
      supplyCenter: false,
      adjacent: ["STP", "NOR", "SWE", "BOT"],
      // Not NOR: Finland and Norway share a land border only.
      fleetAdjacent: ["STP", "SWE", "BOT"]
    },
    LVN: {
      name: "Livonia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["STP", "MOS", "WAR", "PRU", "BAL", "BOT"],
      fleetAdjacent: ["STP", "PRU", "BAL", "BOT"]
    },
    WAR: {
      name: "Warsaw",
      type: "land",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["LVN", "MOS", "UKR", "GAL", "SIL", "PRU"]
    },
    UKR: {
      name: "Ukraine",
      type: "land",
      supplyCenter: false,
      adjacent: ["MOS", "WAR", "GAL", "RUM", "SEV"]
    },
    SEV: {
      name: "Sevastopol",
      type: "coast",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["MOS", "UKR", "RUM", "ARM", "BLA"],
      fleetAdjacent: ["RUM", "ARM", "BLA"]
    },
    // ──────────────────────────── TURKEY ────────────────────────────
    CON: {
      name: "Constantinople",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["BUL", "BLA", "ANK", "SMY", "AEG"],
      // Constantinople is the strait joining the Black Sea (BLA) and the Aegean (AEG).
      fleetAdjacent: ["BUL", "BLA", "ANK", "SMY", "AEG"]
    },
    ANK: {
      name: "Ankara",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["CON", "BLA", "ARM", "SMY"],
      // Not SMY: Ankara (Black Sea side) reaches Smyrna by land only.
      fleetAdjacent: ["CON", "BLA", "ARM"]
    },
    SMY: {
      name: "Smyrna",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["CON", "AEG", "EAS", "SYR", "ARM", "ANK"],
      // Not ARM/ANK: Smyrna (Aegean side) reaches them by land only.
      fleetAdjacent: ["CON", "AEG", "EAS", "SYR"]
    },
    ARM: {
      name: "Armenia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["SEV", "BLA", "ANK", "SMY", "SYR"],
      // Not SMY/SYR: Armenia (Black Sea side) reaches them by land only.
      fleetAdjacent: ["SEV", "BLA", "ANK"]
    },
    SYR: {
      name: "Syria",
      type: "coast",
      supplyCenter: false,
      adjacent: ["SMY", "ARM", "EAS"],
      // Not ARM: land border only.
      fleetAdjacent: ["SMY", "EAS"]
    },
    // ──────────────────────────── NEUTRALS ────────────────────────────
    NOR: {
      name: "Norway",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NWG", "NTH", "SKA", "SWE", "FIN", "STP", "BAR"],
      // Not FIN: Norway and Finland share a land border only.
      fleetAdjacent: ["NWG", "NTH", "SKA", "SWE", "STP", "BAR"]
    },
    SWE: {
      name: "Sweden",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NOR", "FIN", "DEN", "SKA", "BAL", "BOT"],
      fleetAdjacent: ["NOR", "FIN", "DEN", "SKA", "BAL", "BOT"]
    },
    DEN: {
      name: "Denmark",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NTH", "SKA", "SWE", "KIE", "HEL", "BAL"],
      fleetAdjacent: ["NTH", "SKA", "SWE", "KIE", "HEL", "BAL"]
    },
    HOL: {
      name: "Holland",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BEL", "RUH", "KIE", "NTH", "HEL"],
      fleetAdjacent: ["BEL", "KIE", "NTH", "HEL"]
    },
    BEL: {
      name: "Belgium",
      type: "coast",
      supplyCenter: true,
      adjacent: ["HOL", "RUH", "BUR", "PIC", "ENG", "NTH"],
      fleetAdjacent: ["HOL", "PIC", "ENG", "NTH"]
    },
    SPA: {
      name: "Spain",
      type: "coast",
      supplyCenter: true,
      adjacent: ["POR", "GAS", "MAR", "MAO", "GOL", "WES"],
      coasts: {
        nc: { name: "North Coast", fleetAdjacency: ["POR", "GAS", "MAO"] },
        sc: { name: "South Coast", fleetAdjacency: ["POR", "MAR", "GOL", "WES"] }
      }
    },
    POR: {
      name: "Portugal",
      type: "coast",
      supplyCenter: true,
      adjacent: ["SPA", "MAO"],
      fleetAdjacent: ["SPA", "MAO"]
    },
    NAF: {
      name: "North Africa",
      type: "coast",
      supplyCenter: false,
      adjacent: ["MAO", "WES", "TUN"],
      fleetAdjacent: ["MAO", "WES", "TUN"]
    },
    TUN: {
      name: "Tunis",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NAF", "WES", "TYS", "ION"],
      fleetAdjacent: ["NAF", "WES", "TYS", "ION"]
    },
    SER: {
      name: "Serbia",
      type: "land",
      supplyCenter: true,
      adjacent: ["BUD", "TRI", "ALB", "GRE", "BUL", "RUM"]
    },
    ALB: {
      name: "Albania",
      type: "coast",
      supplyCenter: false,
      adjacent: ["TRI", "SER", "GRE", "ADR", "ION"],
      fleetAdjacent: ["TRI", "GRE", "ADR", "ION"]
    },
    GRE: {
      name: "Greece",
      type: "coast",
      supplyCenter: true,
      adjacent: ["SER", "ALB", "BUL", "AEG", "ION"],
      fleetAdjacent: ["ALB", "BUL", "AEG", "ION"]
    },
    BUL: {
      name: "Bulgaria",
      type: "coast",
      supplyCenter: true,
      adjacent: ["SER", "GRE", "CON", "RUM", "BLA", "AEG"],
      coasts: {
        ec: { name: "East Coast", fleetAdjacency: ["BLA", "CON", "RUM"] },
        sc: { name: "South Coast", fleetAdjacency: ["AEG", "GRE", "CON"] }
      }
    },
    RUM: {
      name: "Rumania",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BUD", "GAL", "UKR", "SEV", "BUL", "SER", "BLA"],
      fleetAdjacent: ["SEV", "BUL", "BLA"]
    },
    // ──────────────────────────── SEA ZONES ────────────────────────────
    NAO: {
      name: "North Atlantic Ocean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NWG", "CLY", "LVP", "IRI", "MAO"]
    },
    NWG: {
      name: "Norwegian Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NAO", "CLY", "EDI", "NOR", "BAR", "NTH"]
    },
    BAR: {
      name: "Barents Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NWG", "NOR", "STP"]
    },
    NTH: {
      name: "North Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NWG", "NOR", "DEN", "SKA", "HOL", "BEL", "ENG", "LON", "YOR", "EDI", "HEL"]
    },
    SKA: {
      name: "Skagerrak",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NOR", "SWE", "DEN", "NTH"]
    },
    HEL: {
      name: "Helgoland Bight",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NTH", "HOL", "DEN", "KIE"]
    },
    BAL: {
      name: "Baltic Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["DEN", "SWE", "KIE", "BER", "PRU", "LVN", "BOT"]
    },
    BOT: {
      name: "Gulf of Bothnia",
      type: "sea",
      supplyCenter: false,
      adjacent: ["SWE", "FIN", "STP", "LVN", "BAL"]
    },
    ENG: {
      name: "English Channel",
      type: "sea",
      supplyCenter: false,
      adjacent: ["LON", "WAL", "IRI", "MAO", "BRE", "PIC", "BEL", "NTH"]
    },
    IRI: {
      name: "Irish Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NAO", "LVP", "WAL", "ENG", "MAO"]
    },
    MAO: {
      name: "Mid-Atlantic Ocean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NAO", "IRI", "ENG", "BRE", "GAS", "SPA", "POR", "NAF", "WES"]
    },
    WES: {
      name: "Western Mediterranean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["MAO", "SPA", "GOL", "NAF", "TUN", "TYS"]
    },
    GOL: {
      name: "Gulf of Lyon",
      type: "sea",
      supplyCenter: false,
      adjacent: ["SPA", "MAR", "PIE", "TUS", "WES", "TYS"]
    },
    TYS: {
      name: "Tyrrhenian Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["GOL", "TUS", "ROM", "NAP", "WES", "TUN", "ION"]
    },
    ION: {
      name: "Ionian Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["TUN", "TYS", "NAP", "APU", "ADR", "ALB", "GRE", "AEG", "EAS"]
    },
    ADR: {
      name: "Adriatic Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["VEN", "TRI", "ALB", "APU", "ION"]
    },
    AEG: {
      name: "Aegean Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["GRE", "BUL", "CON", "SMY", "EAS", "ION"]
    },
    EAS: {
      name: "Eastern Mediterranean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["AEG", "SMY", "SYR", "ION"]
    },
    BLA: {
      name: "Black Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["RUM", "SEV", "ARM", "ANK", "CON", "BUL"]
    }
  },
  startingUnits: [
    { type: "fleet", power: "england", territory: "LON" },
    { type: "fleet", power: "england", territory: "EDI" },
    { type: "army", power: "england", territory: "LVP" },
    { type: "army", power: "france", territory: "PAR" },
    { type: "army", power: "france", territory: "MAR" },
    { type: "fleet", power: "france", territory: "BRE" },
    { type: "army", power: "germany", territory: "MUN" },
    { type: "army", power: "germany", territory: "BER" },
    { type: "fleet", power: "germany", territory: "KIE" },
    { type: "army", power: "italy", territory: "ROM" },
    { type: "army", power: "italy", territory: "VEN" },
    { type: "fleet", power: "italy", territory: "NAP" },
    { type: "army", power: "austria", territory: "VIE" },
    { type: "army", power: "austria", territory: "BUD" },
    { type: "fleet", power: "austria", territory: "TRI" },
    { type: "army", power: "russia", territory: "MOS" },
    { type: "army", power: "russia", territory: "WAR" },
    { type: "fleet", power: "russia", territory: "STP", coast: "sc" },
    { type: "fleet", power: "russia", territory: "SEV" },
    { type: "army", power: "turkey", territory: "CON" },
    { type: "army", power: "turkey", territory: "SMY" },
    { type: "fleet", power: "turkey", territory: "ANK" }
  ]
};

// src/lib/maps/1900.ts
var map1900 = {
  "id": "1900",
  "name": "1900",
  "startingYear": 1900,
  "victoryCenters": 18,
  "initialOwnership": {
    "ALG": "france",
    "EGY": "britain"
  },
  "description": "Diplomacy 1900 \u2014 Europe, North Africa and the Near East",
  "playerCount": 7,
  "powers": [
    {
      "id": "britain",
      "name": "Britain",
      "color": "#4b85fe"
    },
    {
      "id": "france",
      "name": "France",
      "color": "#00bdd5"
    },
    {
      "id": "germany",
      "name": "Germany",
      "color": "#8c929f"
    },
    {
      "id": "italy",
      "name": "Italy",
      "color": "#4aa961"
    },
    {
      "id": "austria",
      "name": "Austria-Hungary",
      "color": "#f0574e"
    },
    {
      "id": "russia",
      "name": "Russia",
      "color": "#9975fa"
    },
    {
      "id": "turkey",
      "name": "Turkey",
      "color": "#f5af20"
    }
  ],
  "territories": {
    "ADR": {
      "name": "Adriatic Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "APU",
        "VEN",
        "TRI",
        "BOS",
        "MAC",
        "ION"
      ]
    },
    "AEG": {
      "name": "Aegean Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "GRE",
        "MAC",
        "CON",
        "KON",
        "EAS",
        "ION"
      ]
    },
    "ALG": {
      "name": "Algeria",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "MOR",
        "SOU",
        "TUN",
        "WES",
        "TYS"
      ],
      "fleetAdjacent": [
        "MOR",
        "WES",
        "TYS",
        "TUN"
      ]
    },
    "ALS": {
      "name": "Alsace",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "BUR",
        "BEL",
        "COL",
        "MUN",
        "SWI"
      ]
    },
    "ANK": {
      "name": "Ankara",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "turkey",
      "adjacent": [
        "ARM",
        "CON",
        "KON",
        "BLA"
      ],
      "fleetAdjacent": [
        "BLA",
        "ARM",
        "CON"
      ]
    },
    "APU": {
      "name": "Apulia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "VEN",
        "NAP",
        "ROM",
        "ADR",
        "ION"
      ],
      "fleetAdjacent": [
        "VEN",
        "ADR",
        "ION",
        "NAP"
      ]
    },
    "ARA": {
      "name": "Arabia",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "DAM",
        "PAL",
        "HEJ"
      ]
    },
    "ARM": {
      "name": "Armenia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "DAM",
        "KON",
        "ANK",
        "SEV",
        "BLA"
      ],
      "fleetAdjacent": [
        "ANK",
        "SEV",
        "BLA"
      ]
    },
    "BAL": {
      "name": "Baltic Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "LVO",
        "PRU",
        "BER",
        "KIE",
        "DEN",
        "SWE",
        "GBO"
      ]
    },
    "BAR": {
      "name": "Barents Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "NWG",
        "STP",
        "NOR"
      ]
    },
    "BEL": {
      "name": "Belgium",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "NET",
        "PIC",
        "COL",
        "ALS",
        "BUR",
        "ENG",
        "NTH"
      ],
      "fleetAdjacent": [
        "ENG",
        "NTH",
        "NET",
        "PIC"
      ]
    },
    "BER": {
      "name": "Berlin",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "germany",
      "adjacent": [
        "KIE",
        "PRU",
        "SIL",
        "MUN",
        "BAL"
      ],
      "fleetAdjacent": [
        "KIE",
        "BAL",
        "PRU"
      ]
    },
    "BLA": {
      "name": "Black Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "RUM",
        "SEV",
        "ARM",
        "ANK",
        "CON",
        "BUL"
      ]
    },
    "BOH": {
      "name": "Bohemia",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "MUN",
        "SIL",
        "GAL",
        "BUD",
        "VIE",
        "TYR"
      ]
    },
    "BOS": {
      "name": "Bosnia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "TRI",
        "SER",
        "MAC",
        "ADR"
      ],
      "fleetAdjacent": [
        "MAC",
        "ADR",
        "TRI"
      ]
    },
    "BRE": {
      "name": "Brest",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "france",
      "adjacent": [
        "PIC",
        "GAS",
        "PAR",
        "MAO",
        "ENG"
      ],
      "fleetAdjacent": [
        "MAO",
        "ENG",
        "PIC",
        "GAS"
      ]
    },
    "BUD": {
      "name": "Budapest",
      "type": "land",
      "supplyCenter": true,
      "homePower": "austria",
      "adjacent": [
        "VIE",
        "BOH",
        "GAL",
        "RUM",
        "SER",
        "TRI"
      ]
    },
    "BUL": {
      "name": "Bulgaria",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "CON",
        "MAC",
        "SER",
        "RUM",
        "BLA"
      ],
      "fleetAdjacent": [
        "CON",
        "BLA",
        "RUM"
      ]
    },
    "BUR": {
      "name": "Burgundy",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "MAR",
        "GAS",
        "PAR",
        "PIC",
        "BEL",
        "ALS",
        "SWI"
      ]
    },
    "CLY": {
      "name": "Clyde",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "EDI",
        "LVP",
        "IRE",
        "NAO",
        "NWG"
      ],
      "fleetAdjacent": [
        "EDI",
        "LVP",
        "IRE",
        "NAO",
        "NWG"
      ]
    },
    "COL": {
      "name": "Cologne",
      "type": "land",
      "supplyCenter": true,
      "homePower": "germany",
      "adjacent": [
        "ALS",
        "BEL",
        "NET",
        "KIE",
        "MUN"
      ]
    },
    "CON": {
      "name": "Constantinople",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "turkey",
      "adjacent": [
        "MAC",
        "BUL",
        "ANK",
        "KON",
        "BLA",
        "AEG"
      ],
      "fleetAdjacent": [
        "MAC",
        "BUL",
        "BLA",
        "ANK",
        "KON",
        "AEG"
      ]
    },
    "CYR": {
      "name": "Cyrenaica",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "TRP",
        "EGY",
        "ION",
        "EAS"
      ],
      "fleetAdjacent": [
        "TRP",
        "ION",
        "EAS",
        "EGY"
      ]
    },
    "DAM": {
      "name": "Damascus",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "turkey",
      "adjacent": [
        "KON",
        "ARM",
        "ARA",
        "PAL",
        "EAS"
      ],
      "fleetAdjacent": [
        "PAL",
        "EAS",
        "KON"
      ]
    },
    "DEN": {
      "name": "Denmark",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "SWE",
        "KIE",
        "HEL",
        "NTH",
        "BAL",
        "SKA"
      ],
      "fleetAdjacent": [
        "HEL",
        "NTH",
        "SWE",
        "BAL",
        "KIE",
        "SKA"
      ]
    },
    "EAS": {
      "name": "Eastern Mediterranean",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "AEG",
        "KON",
        "DAM",
        "PAL",
        "EGY",
        "CYR",
        "ION"
      ]
    },
    "EDI": {
      "name": "Edinburgh",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "britain",
      "adjacent": [
        "LVP",
        "YOR",
        "CLY",
        "NTH",
        "NWG"
      ],
      "fleetAdjacent": [
        "NTH",
        "NWG",
        "CLY",
        "YOR"
      ]
    },
    "EGY": {
      "name": "Egypt",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "CYR",
        "PAL",
        "HEJ",
        "EAS",
        "MAO"
      ],
      "fleetAdjacent": [
        "CYR",
        "EAS",
        "PAL",
        "HEJ",
        "MAO"
      ]
    },
    "ENG": {
      "name": "English Channel",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "MAO",
        "IRI",
        "WAL",
        "LON",
        "NTH",
        "BEL",
        "PIC",
        "BRE"
      ]
    },
    "FIN": {
      "name": "Finland",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "SWE",
        "STP",
        "NOR",
        "GBO"
      ],
      "fleetAdjacent": [
        "SWE",
        "STP",
        "GBO"
      ]
    },
    "GAL": {
      "name": "Galicia",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "WAR",
        "UKR",
        "RUM",
        "BUD",
        "BOH",
        "SIL"
      ]
    },
    "GAS": {
      "name": "Gascony",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "PAR",
        "BUR",
        "MAR",
        "SPA",
        "BRE",
        "MAO"
      ],
      "fleetAdjacent": [
        "SPA",
        "MAO",
        "BRE"
      ]
    },
    "GBO": {
      "name": "Gulf of Bothnia",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "SWE",
        "FIN",
        "STP",
        "LVO",
        "BAL"
      ]
    },
    "GIB": {
      "name": "Gibraltar",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "SPA",
        "MOR",
        "WES",
        "MAO"
      ],
      "fleetAdjacent": [
        "SPA",
        "WES",
        "MOR",
        "MAO"
      ]
    },
    "GLY": {
      "name": "Gulf of Lyon",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "SPA",
        "MAR",
        "PIE",
        "ROM",
        "TYS",
        "WES"
      ]
    },
    "GRE": {
      "name": "Greece",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "MAC",
        "AEG",
        "ION"
      ],
      "fleetAdjacent": [
        "MAC",
        "AEG",
        "ION"
      ]
    },
    "HEJ": {
      "name": "Hejaz",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "EGY",
        "PAL",
        "ARA",
        "MAO"
      ],
      "fleetAdjacent": [
        "EGY",
        "MAO"
      ]
    },
    "HEL": {
      "name": "Helgoland Bight",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "NTH",
        "DEN",
        "KIE",
        "NET"
      ]
    },
    "ICE": {
      "name": "Iceland",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ICE",
        "NAO",
        "NWG"
      ],
      "fleetAdjacent": [
        "NAO",
        "NWG"
      ]
    },
    "ION": {
      "name": "Ionian Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "TUN",
        "TYS",
        "NAP",
        "APU",
        "ADR",
        "MAC",
        "GRE",
        "AEG",
        "EAS",
        "CYR",
        "TRP"
      ]
    },
    "IRE": {
      "name": "Ireland",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "CLY",
        "NAO",
        "IRI",
        "MAO"
      ],
      "fleetAdjacent": [
        "NAO",
        "CLY",
        "IRI",
        "MAO"
      ]
    },
    "IRI": {
      "name": "Irish Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "NAO",
        "LVP",
        "WAL",
        "ENG",
        "MAO",
        "IRE"
      ]
    },
    "KIE": {
      "name": "Kiel",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "germany",
      "adjacent": [
        "NET",
        "DEN",
        "BER",
        "MUN",
        "COL",
        "HEL",
        "BAL"
      ],
      "fleetAdjacent": [
        "NET",
        "HEL",
        "DEN",
        "BAL",
        "BER"
      ]
    },
    "KON": {
      "name": "Konya",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "CON",
        "ANK",
        "ARM",
        "DAM",
        "EAS",
        "AEG"
      ],
      "fleetAdjacent": [
        "DAM",
        "EAS",
        "AEG",
        "CON"
      ]
    },
    "LON": {
      "name": "London",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "britain",
      "adjacent": [
        "YOR",
        "WAL",
        "NTH",
        "ENG"
      ],
      "fleetAdjacent": [
        "YOR",
        "NTH",
        "ENG",
        "WAL"
      ]
    },
    "LVO": {
      "name": "Livonia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "PRU",
        "STP",
        "MOS",
        "WAR",
        "BAL",
        "GBO"
      ],
      "fleetAdjacent": [
        "PRU",
        "BAL",
        "GBO",
        "STP"
      ]
    },
    "LVP": {
      "name": "Liverpool",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "britain",
      "adjacent": [
        "WAL",
        "EDI",
        "YOR",
        "CLY",
        "IRI",
        "NAO"
      ],
      "fleetAdjacent": [
        "WAL",
        "IRI",
        "NAO",
        "CLY"
      ]
    },
    "MAC": {
      "name": "Macedonia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "BOS",
        "SER",
        "BUL",
        "CON",
        "GRE",
        "ADR",
        "ION",
        "AEG"
      ],
      "coasts": {
        "ec": {
          "name": "East Coast",
          "fleetAdjacency": [
            "GRE",
            "AEG",
            "CON"
          ]
        },
        "wc": {
          "name": "West Coast",
          "fleetAdjacency": [
            "BOS",
            "ADR",
            "ION",
            "GRE"
          ]
        }
      }
    },
    "MAR": {
      "name": "Marseilles",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "france",
      "adjacent": [
        "SPA",
        "PIE",
        "GAS",
        "BUR",
        "SWI",
        "GLY"
      ],
      "fleetAdjacent": [
        "SPA",
        "GLY",
        "PIE"
      ]
    },
    "MAO": {
      "name": "Mid-Atlantic Ocean",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "NAO",
        "IRE",
        "IRI",
        "ENG",
        "BRE",
        "GAS",
        "SPA",
        "POR",
        "GIB",
        "MOR",
        "EGY",
        "HEJ"
      ]
    },
    "MIL": {
      "name": "Milan",
      "type": "land",
      "supplyCenter": true,
      "homePower": "italy",
      "adjacent": [
        "PIE",
        "SWI",
        "TYR",
        "VEN",
        "ROM"
      ]
    },
    "MOR": {
      "name": "Morocco",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "GIB",
        "ALG",
        "SOU",
        "MAO",
        "WES"
      ],
      "fleetAdjacent": [
        "MAO",
        "GIB",
        "WES",
        "ALG"
      ]
    },
    "MOS": {
      "name": "Moscow",
      "type": "land",
      "supplyCenter": true,
      "homePower": "russia",
      "adjacent": [
        "STP",
        "LVO",
        "WAR",
        "UKR",
        "SEV",
        "SIB"
      ]
    },
    "MUN": {
      "name": "Munich",
      "type": "land",
      "supplyCenter": true,
      "homePower": "germany",
      "adjacent": [
        "ALS",
        "COL",
        "KIE",
        "BER",
        "SIL",
        "BOH",
        "TYR",
        "SWI"
      ]
    },
    "NAP": {
      "name": "Naples",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "italy",
      "adjacent": [
        "ROM",
        "APU",
        "TYS",
        "ION"
      ],
      "fleetAdjacent": [
        "ROM",
        "TYS",
        "ION",
        "APU"
      ]
    },
    "NAO": {
      "name": "North Atlantic Ocean",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "NWG",
        "ICE",
        "CLY",
        "LVP",
        "IRI",
        "IRE",
        "MAO"
      ]
    },
    "NET": {
      "name": "Netherlands",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "BEL",
        "COL",
        "KIE",
        "NTH",
        "HEL"
      ],
      "fleetAdjacent": [
        "BEL",
        "NTH",
        "HEL",
        "KIE"
      ]
    },
    "NTH": {
      "name": "North Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "YOR",
        "EDI",
        "NWG",
        "NOR",
        "SKA",
        "DEN",
        "HEL",
        "NET",
        "BEL",
        "ENG",
        "LON"
      ]
    },
    "NWG": {
      "name": "Norwegian Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "NAO",
        "ICE",
        "BAR",
        "NOR",
        "NTH",
        "CLY",
        "EDI"
      ]
    },
    "NOR": {
      "name": "Norway",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "FIN",
        "STP",
        "SWE",
        "SKA",
        "NTH",
        "NWG",
        "BAR"
      ],
      "fleetAdjacent": [
        "SKA",
        "NTH",
        "NWG",
        "BAR",
        "STP",
        "SWE"
      ]
    },
    "PAL": {
      "name": "Palestine",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "DAM",
        "ARA",
        "HEJ",
        "EGY",
        "EAS"
      ],
      "fleetAdjacent": [
        "EGY",
        "EAS",
        "DAM"
      ]
    },
    "PAR": {
      "name": "Paris",
      "type": "land",
      "supplyCenter": true,
      "homePower": "france",
      "adjacent": [
        "BRE",
        "PIC",
        "BUR",
        "GAS"
      ]
    },
    "PIC": {
      "name": "Picardy",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "BUR",
        "PAR",
        "BRE",
        "BEL",
        "ENG"
      ],
      "fleetAdjacent": [
        "BRE",
        "ENG",
        "BEL"
      ]
    },
    "PIE": {
      "name": "Piedmont",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "MAR",
        "SWI",
        "MIL",
        "ROM",
        "GLY"
      ],
      "fleetAdjacent": [
        "MAR",
        "GLY",
        "ROM"
      ]
    },
    "POR": {
      "name": "Portugal",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "SPA",
        "MAO"
      ],
      "fleetAdjacent": [
        "MAO",
        "SPA"
      ]
    },
    "PRU": {
      "name": "Prussia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "WAR",
        "SIL",
        "BER",
        "LVO",
        "BAL"
      ],
      "fleetAdjacent": [
        "BER",
        "BAL",
        "LVO"
      ]
    },
    "ROM": {
      "name": "Rome",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "italy",
      "adjacent": [
        "PIE",
        "MIL",
        "NAP",
        "VEN",
        "APU",
        "GLY",
        "TYS"
      ],
      "fleetAdjacent": [
        "PIE",
        "GLY",
        "TYS",
        "NAP"
      ]
    },
    "RUM": {
      "name": "Rumania",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "SER",
        "BUD",
        "GAL",
        "UKR",
        "SEV",
        "BUL",
        "BLA"
      ],
      "fleetAdjacent": [
        "SEV",
        "BLA",
        "BUL"
      ]
    },
    "SER": {
      "name": "Serbia",
      "type": "land",
      "supplyCenter": true,
      "adjacent": [
        "BOS",
        "TRI",
        "BUD",
        "RUM",
        "BUL",
        "MAC"
      ]
    },
    "SEV": {
      "name": "Sevastopol",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "russia",
      "adjacent": [
        "UKR",
        "MOS",
        "SIB",
        "RUM",
        "ARM",
        "BLA"
      ],
      "fleetAdjacent": [
        "RUM",
        "BLA",
        "ARM"
      ]
    },
    "SIB": {
      "name": "Siberia",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "SEV",
        "MOS",
        "STP"
      ]
    },
    "SIL": {
      "name": "Silesia",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "MUN",
        "BER",
        "PRU",
        "WAR",
        "GAL",
        "BOH"
      ]
    },
    "SKA": {
      "name": "Skagerrak",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "NTH",
        "NOR",
        "DEN",
        "SWE"
      ]
    },
    "SOU": {
      "name": "Southern Algeria",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "MOR",
        "ALG",
        "TUN",
        "TRP"
      ]
    },
    "SPA": {
      "name": "Spain",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "GAS",
        "MAR",
        "GIB",
        "POR",
        "MAO",
        "WES",
        "GLY"
      ],
      "coasts": {
        "nc": {
          "name": "North Coast",
          "fleetAdjacency": [
            "GAS",
            "MAO",
            "POR"
          ]
        },
        "ec": {
          "name": "East Coast",
          "fleetAdjacency": [
            "GIB",
            "WES",
            "GLY",
            "MAR"
          ]
        },
        "wc": {
          "name": "West Coast",
          "fleetAdjacency": [
            "POR",
            "MAO",
            "GIB"
          ]
        }
      }
    },
    "STP": {
      "name": "St. Petersburg",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "russia",
      "adjacent": [
        "FIN",
        "LVO",
        "NOR",
        "MOS",
        "SIB",
        "BAR",
        "GBO"
      ],
      "coasts": {
        "nc": {
          "name": "North Coast",
          "fleetAdjacency": [
            "BAR",
            "NOR"
          ]
        },
        "sc": {
          "name": "South Coast",
          "fleetAdjacency": [
            "FIN",
            "LVO",
            "GBO"
          ]
        }
      }
    },
    "SWE": {
      "name": "Sweden",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "FIN",
        "DEN",
        "NOR",
        "GBO",
        "BAL",
        "SKA"
      ],
      "fleetAdjacent": [
        "FIN",
        "GBO",
        "BAL",
        "DEN",
        "SKA",
        "NOR"
      ]
    },
    "SWI": {
      "name": "Switzerland",
      "type": "land",
      "supplyCenter": true,
      "adjacent": [
        "BUR",
        "ALS",
        "MUN",
        "TYR",
        "MIL",
        "PIE",
        "MAR"
      ]
    },
    "TRI": {
      "name": "Trieste",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "austria",
      "adjacent": [
        "VEN",
        "TYR",
        "VIE",
        "BUD",
        "SER",
        "BOS",
        "ADR"
      ],
      "fleetAdjacent": [
        "BOS",
        "ADR",
        "VEN"
      ]
    },
    "TRP": {
      "name": "Tripolitania",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "TUN",
        "SOU",
        "CYR",
        "ION"
      ],
      "fleetAdjacent": [
        "TUN",
        "ION",
        "CYR"
      ]
    },
    "TUN": {
      "name": "Tunisia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ALG",
        "SOU",
        "TRP",
        "TYS",
        "ION"
      ],
      "fleetAdjacent": [
        "ALG",
        "TYS",
        "ION",
        "TRP"
      ]
    },
    "TYR": {
      "name": "Tyrolia",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "SWI",
        "MUN",
        "BOH",
        "VIE",
        "TRI",
        "VEN",
        "MIL"
      ]
    },
    "TYS": {
      "name": "Tyrrhenian Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "WES",
        "GLY",
        "ROM",
        "NAP",
        "ION",
        "TUN",
        "ALG"
      ]
    },
    "UKR": {
      "name": "Ukraine",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "RUM",
        "GAL",
        "WAR",
        "MOS",
        "SEV"
      ]
    },
    "VEN": {
      "name": "Venetia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "MIL",
        "TYR",
        "TRI",
        "APU",
        "ROM",
        "ADR"
      ],
      "fleetAdjacent": [
        "APU",
        "ADR",
        "TRI"
      ]
    },
    "VIE": {
      "name": "Vienna",
      "type": "land",
      "supplyCenter": true,
      "homePower": "austria",
      "adjacent": [
        "TYR",
        "BOH",
        "BUD",
        "TRI"
      ]
    },
    "WAL": {
      "name": "Wales",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "LVP",
        "LON",
        "YOR",
        "IRI",
        "ENG"
      ],
      "fleetAdjacent": [
        "LVP",
        "IRI",
        "ENG",
        "LON"
      ]
    },
    "WAR": {
      "name": "Warsaw",
      "type": "land",
      "supplyCenter": true,
      "homePower": "russia",
      "adjacent": [
        "SIL",
        "PRU",
        "LVO",
        "MOS",
        "UKR",
        "GAL"
      ]
    },
    "WES": {
      "name": "Western Mediterranean",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "GIB",
        "SPA",
        "GLY",
        "TYS",
        "ALG",
        "MOR"
      ]
    },
    "YOR": {
      "name": "Yorkshire",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "EDI",
        "LON",
        "LVP",
        "WAL",
        "NTH"
      ],
      "fleetAdjacent": [
        "EDI",
        "NTH",
        "LON"
      ]
    }
  },
  "rules": {
    "longRoutes": [
      [
        "EGY",
        "MAO"
      ],
      [
        "HEJ",
        "MAO"
      ]
    ],
    "convoyCoasts": [
      "GIB"
    ],
    "disorderHomes": {
      "britain": [
        "EGY"
      ],
      "france": [
        "ALG"
      ]
    },
    "emergency": {
      "nation": "russia",
      "buildSite": "SIB"
    },
    "strictVictory": true
  },
  "startingUnits": [
    {
      "type": "army",
      "power": "france",
      "territory": "ALG"
    },
    {
      "type": "fleet",
      "power": "turkey",
      "territory": "ANK"
    },
    {
      "type": "army",
      "power": "germany",
      "territory": "BER"
    },
    {
      "type": "fleet",
      "power": "france",
      "territory": "BRE"
    },
    {
      "type": "army",
      "power": "austria",
      "territory": "BUD"
    },
    {
      "type": "army",
      "power": "germany",
      "territory": "COL"
    },
    {
      "type": "army",
      "power": "turkey",
      "territory": "CON"
    },
    {
      "type": "army",
      "power": "turkey",
      "territory": "DAM"
    },
    {
      "type": "fleet",
      "power": "britain",
      "territory": "EDI"
    },
    {
      "type": "fleet",
      "power": "britain",
      "territory": "EGY"
    },
    {
      "type": "fleet",
      "power": "britain",
      "territory": "GIB"
    },
    {
      "type": "fleet",
      "power": "germany",
      "territory": "KIE"
    },
    {
      "type": "fleet",
      "power": "britain",
      "territory": "LON"
    },
    {
      "type": "army",
      "power": "france",
      "territory": "MAR"
    },
    {
      "type": "army",
      "power": "italy",
      "territory": "MIL"
    },
    {
      "type": "army",
      "power": "russia",
      "territory": "MOS"
    },
    {
      "type": "army",
      "power": "germany",
      "territory": "MUN"
    },
    {
      "type": "fleet",
      "power": "italy",
      "territory": "NAP"
    },
    {
      "type": "army",
      "power": "france",
      "territory": "PAR"
    },
    {
      "type": "army",
      "power": "italy",
      "territory": "ROM"
    },
    {
      "type": "fleet",
      "power": "russia",
      "territory": "SEV"
    },
    {
      "type": "fleet",
      "power": "russia",
      "territory": "STP",
      "coast": "sc"
    },
    {
      "type": "army",
      "power": "austria",
      "territory": "TRI"
    },
    {
      "type": "army",
      "power": "austria",
      "territory": "VIE"
    },
    {
      "type": "army",
      "power": "russia",
      "territory": "WAR"
    }
  ]
};

// src/lib/maps/era.ts
var mapEra = {
  "id": "era",
  "name": "Era of Empire",
  "description": "Diplomacy: Era of Empire \u2014 Asia, 1870",
  "playerCount": 7,
  "startingYear": 1870,
  "victoryCenters": 22,
  "rules": {
    "buildAnyCenter": true,
    "conversion": true,
    "sharedVictory": true
  },
  "powers": [
    {
      "id": "britain",
      "name": "Britain",
      "color": "#4b85fe"
    },
    {
      "id": "china",
      "name": "China",
      "color": "#f5af20"
    },
    {
      "id": "france",
      "name": "France",
      "color": "#00bdd5"
    },
    {
      "id": "japan",
      "name": "Japan",
      "color": "#ffffff"
    },
    {
      "id": "netherlands",
      "name": "Netherlands",
      "color": "#e9802f"
    },
    {
      "id": "russia",
      "name": "Russia",
      "color": "#8c929f",
      "flag": "russia-imperial"
    },
    {
      "id": "turkey",
      "name": "Turkey",
      "color": "#f0574e"
    }
  ],
  "territories": {
    "ABY": {
      "name": "Abyssinia",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "ERI",
        "MAA",
        "MOM",
        "SOM",
        "SUD"
      ]
    },
    "ADE": {
      "name": "Aden",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "britain",
      "adjacent": [
        "ARA",
        "ARS",
        "GOA",
        "MEC",
        "OMA",
        "RS"
      ],
      "fleetAdjacent": [
        "ARS",
        "GOA",
        "MEC",
        "OMA",
        "RS"
      ]
    },
    "AFG": {
      "name": "Afghanistan",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "BOK",
        "KAG",
        "KAM",
        "KAR",
        "PER",
        "PUN",
        "TAS"
      ]
    },
    "AKI": {
      "name": "Akita",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "KYO",
        "OTA",
        "SOJ",
        "SOO",
        "TOK"
      ],
      "fleetAdjacent": [
        "KYO",
        "OTA",
        "SOJ",
        "SOO",
        "TOK"
      ]
    },
    "ANG": {
      "name": "Angora",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "turkey",
      "adjacent": [
        "ARM",
        "BS",
        "CON",
        "MS",
        "SYR"
      ],
      "fleetAdjacent": [
        "ARM",
        "BS",
        "CON",
        "MS",
        "SYR"
      ]
    },
    "ANN": {
      "name": "Annam",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "france",
      "adjacent": [
        "CAM",
        "COC",
        "GOS",
        "SCS",
        "TON"
      ],
      "fleetAdjacent": [
        "COC",
        "GOS",
        "SCS",
        "TON"
      ]
    },
    "ANS": {
      "name": "Andaman Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "BOB",
        "EIO",
        "JS",
        "MAL",
        "RAN",
        "SUM"
      ]
    },
    "ARA": {
      "name": "Arabia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ADE",
        "BAG",
        "MEC",
        "OMA",
        "PG",
        "SYR"
      ],
      "fleetAdjacent": [
        "BAG",
        "OMA",
        "PG"
      ]
    },
    "ARM": {
      "name": "Armenia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ANG",
        "BAG",
        "BAK",
        "BS",
        "SYR",
        "TAB"
      ],
      "fleetAdjacent": [
        "ANG",
        "BAK",
        "BS"
      ]
    },
    "ARS": {
      "name": "Arabian Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ADE",
        "BOM",
        "GOA",
        "KAR",
        "MYS",
        "OMA",
        "PG",
        "RAJ",
        "WIO"
      ]
    },
    "ASM": {
      "name": "Assam",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "BEN",
        "CHU",
        "RAN",
        "SIN",
        "TIB",
        "YUN"
      ]
    },
    "BAG": {
      "name": "Baghdad",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "turkey",
      "adjacent": [
        "ARA",
        "ARM",
        "PG",
        "SHI",
        "SYR",
        "TAB"
      ],
      "fleetAdjacent": [
        "ARA",
        "PG",
        "SHI"
      ]
    },
    "BAK": {
      "name": "Baku",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ARM",
        "BS",
        "MOS",
        "ODE",
        "TAB"
      ],
      "fleetAdjacent": [
        "ARM",
        "BS",
        "ODE"
      ]
    },
    "BAN": {
      "name": "Bangkok",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "CAM",
        "GOS",
        "MAL",
        "MAY",
        "RAN",
        "TON"
      ],
      "fleetAdjacent": [
        "CAM",
        "GOS",
        "MAL"
      ]
    },
    "BEN": {
      "name": "Bengal",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "ASM",
        "BOB",
        "HYD",
        "LUC",
        "NEP",
        "RAN",
        "TIB"
      ],
      "fleetAdjacent": [
        "BOB",
        "HYD",
        "RAN"
      ]
    },
    "BOB": {
      "name": "Bay of Bengal",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ANS",
        "BEN",
        "CEY",
        "EIO",
        "HYD",
        "MAD",
        "RAN",
        "WIO"
      ]
    },
    "BOK": {
      "name": "Bokhara",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "AFG",
        "MOS",
        "ORE",
        "PER",
        "TAS"
      ]
    },
    "BOM": {
      "name": "Bombay",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "britain",
      "adjacent": [
        "ARS",
        "HYD",
        "MYS",
        "NAG",
        "RAJ"
      ],
      "fleetAdjacent": [
        "ARS",
        "MYS",
        "RAJ"
      ]
    },
    "BOR": {
      "name": "Borneo",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "netherlands",
      "adjacent": [
        "CS",
        "JS",
        "SAR"
      ],
      "fleetAdjacent": [
        "CS",
        "JS",
        "SAR"
      ]
    },
    "BS": {
      "name": "Black Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ANG",
        "ARM",
        "BAK",
        "CON",
        "MS",
        "ODE",
        "RUM"
      ]
    },
    "CAM": {
      "name": "Cambodia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ANN",
        "BAN",
        "COC",
        "GOS",
        "TON"
      ],
      "fleetAdjacent": [
        "BAN",
        "COC",
        "GOS"
      ]
    },
    "CAN": {
      "name": "Canton",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "CHU",
        "ECS",
        "HK",
        "SCS",
        "SHA",
        "YUN"
      ],
      "fleetAdjacent": [
        "ECS",
        "HK",
        "SCS",
        "SHA",
        "YUN"
      ]
    },
    "CEB": {
      "name": "Cebu",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "DAV",
        "LPO",
        "MNA",
        "MPO",
        "SCS"
      ],
      "fleetAdjacent": [
        "DAV",
        "LPO",
        "MNA",
        "MPO",
        "SCS"
      ]
    },
    "CEL": {
      "name": "Celebes",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "CS",
        "JS",
        "LPO",
        "TS"
      ],
      "fleetAdjacent": [
        "CS",
        "JS",
        "LPO",
        "TS"
      ]
    },
    "CEY": {
      "name": "Ceylon",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "BOB",
        "EIO",
        "MAD",
        "WIO"
      ],
      "fleetAdjacent": [
        "BOB",
        "EIO",
        "MAD",
        "WIO"
      ]
    },
    "CHU": {
      "name": "Chungking",
      "type": "land",
      "supplyCenter": true,
      "adjacent": [
        "ASM",
        "CAN",
        "LAN",
        "SHA",
        "SIN",
        "YUN"
      ]
    },
    "COC": {
      "name": "Cochin",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "france",
      "adjacent": [
        "ANN",
        "CAM",
        "GOS"
      ],
      "fleetAdjacent": [
        "ANN",
        "CAM",
        "GOS"
      ]
    },
    "CON": {
      "name": "Constantinople",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "turkey",
      "adjacent": [
        "ANG",
        "BS",
        "MS",
        "RUM"
      ],
      "fleetAdjacent": [
        "ANG",
        "BS",
        "MS",
        "RUM"
      ]
    },
    "COR": {
      "name": "Corea",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "PA",
        "SOJ",
        "VLA",
        "YS"
      ],
      "fleetAdjacent": [
        "PA",
        "SOJ",
        "VLA",
        "YS"
      ]
    },
    "CS": {
      "name": "Celebes Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "BOR",
        "CEL",
        "DAV",
        "JS",
        "LPO",
        "SAR",
        "SCS"
      ]
    },
    "DAV": {
      "name": "Davao",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "CEB",
        "CS",
        "LPO",
        "SCS"
      ],
      "fleetAdjacent": [
        "CEB",
        "CS",
        "LPO",
        "SCS"
      ]
    },
    "DEL": {
      "name": "Delhi",
      "type": "land",
      "supplyCenter": true,
      "homePower": "britain",
      "adjacent": [
        "LUC",
        "NAG",
        "NEP",
        "PUN",
        "RAJ"
      ]
    },
    "ECS": {
      "name": "East China Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "CAN",
        "FOR",
        "HK",
        "MNA",
        "MPO",
        "SCS",
        "SHA",
        "YS"
      ]
    },
    "EGY": {
      "name": "Egypt",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "MEC",
        "MS",
        "RS",
        "SUD",
        "SYR"
      ],
      "fleetAdjacent": [
        "MEC",
        "MS",
        "RS",
        "SUD",
        "SYR"
      ]
    },
    "EIO": {
      "name": "East Indian Ocean",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ANS",
        "BOB",
        "CEY",
        "SIO",
        "SUM",
        "WIO"
      ]
    },
    "ERI": {
      "name": "Eritrea",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ABY",
        "GOA",
        "RS",
        "SOM",
        "SUD"
      ],
      "fleetAdjacent": [
        "GOA",
        "RS",
        "SOM",
        "SUD"
      ]
    },
    "FOR": {
      "name": "Formosa",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "ECS",
        "MPO",
        "UPO",
        "YS"
      ],
      "fleetAdjacent": [
        "ECS",
        "MPO",
        "UPO",
        "YS"
      ]
    },
    "GOA": {
      "name": "Gulf of Aden",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ADE",
        "ARS",
        "ERI",
        "MOM",
        "RS",
        "SIO",
        "SOM",
        "WIO"
      ]
    },
    "GOS": {
      "name": "Gulf of Siam",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ANN",
        "BAN",
        "CAM",
        "COC",
        "JS",
        "MAL",
        "SAR",
        "SCS",
        "SIG"
      ]
    },
    "HK": {
      "name": "Hong Kong",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "CAN",
        "ECS",
        "SCS"
      ],
      "fleetAdjacent": [
        "CAN",
        "ECS",
        "SCS"
      ]
    },
    "HYD": {
      "name": "Hyderabad",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "BEN",
        "BOB",
        "BOM",
        "LUC",
        "MAD",
        "MYS",
        "NAG"
      ],
      "fleetAdjacent": [
        "BEN",
        "BOB",
        "MAD"
      ]
    },
    "IRK": {
      "name": "Irkutsk",
      "type": "land",
      "supplyCenter": true,
      "homePower": "russia",
      "adjacent": [
        "KIR",
        "MAN",
        "MON",
        "OMS",
        "VLA"
      ]
    },
    "JAV": {
      "name": "Java",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "netherlands",
      "adjacent": [
        "JS",
        "SIO",
        "TS"
      ],
      "fleetAdjacent": [
        "JS",
        "SIO",
        "TS"
      ]
    },
    "JS": {
      "name": "Java Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ANS",
        "BOR",
        "CEL",
        "CS",
        "GOS",
        "JAV",
        "MAL",
        "SAR",
        "SIG",
        "SIO",
        "SUM",
        "TS"
      ]
    },
    "KAG": {
      "name": "Kashgar",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "AFG",
        "KAM",
        "KIR",
        "SIN",
        "TAS",
        "TIB",
        "URU"
      ]
    },
    "KAM": {
      "name": "Kashmir",
      "type": "land",
      "supplyCenter": true,
      "adjacent": [
        "AFG",
        "KAG",
        "PUN",
        "TIB"
      ]
    },
    "KAR": {
      "name": "Karachi",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "AFG",
        "ARS",
        "PER",
        "PG",
        "PUN",
        "RAJ"
      ],
      "fleetAdjacent": [
        "ARS",
        "PER",
        "PG",
        "RAJ"
      ]
    },
    "KIR": {
      "name": "Kirghiz",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "IRK",
        "KAG",
        "MON",
        "OMS",
        "ORE",
        "TAS",
        "URU"
      ]
    },
    "KYO": {
      "name": "Kyoto",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "japan",
      "adjacent": [
        "AKI",
        "KYU",
        "SOJ",
        "TOK",
        "UPO",
        "YS"
      ],
      "fleetAdjacent": [
        "AKI",
        "KYU",
        "SOJ",
        "TOK",
        "UPO",
        "YS"
      ]
    },
    "KYU": {
      "name": "Kyushu",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "japan",
      "adjacent": [
        "KYO",
        "UPO",
        "YS"
      ],
      "fleetAdjacent": [
        "KYO",
        "UPO",
        "YS"
      ]
    },
    "LAN": {
      "name": "Lanchow",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "CHU",
        "MON",
        "PEK",
        "SHA",
        "SIN"
      ]
    },
    "LPO": {
      "name": "Lower Pacific Ocean",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "CEB",
        "CEL",
        "CS",
        "DAV",
        "MPO",
        "NG",
        "TS"
      ]
    },
    "LUC": {
      "name": "Lucknow",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "BEN",
        "DEL",
        "HYD",
        "NAG",
        "NEP"
      ]
    },
    "MAA": {
      "name": "Maasai",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "ABY",
        "MOM",
        "SUD"
      ]
    },
    "MAD": {
      "name": "Madras",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "britain",
      "adjacent": [
        "BOB",
        "CEY",
        "HYD",
        "MYS",
        "WIO"
      ],
      "fleetAdjacent": [
        "BOB",
        "CEY",
        "HYD",
        "MYS",
        "WIO"
      ]
    },
    "MAL": {
      "name": "Malaya",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ANS",
        "BAN",
        "GOS",
        "JS",
        "RAN",
        "SIG"
      ],
      "fleetAdjacent": [
        "ANS",
        "BAN",
        "GOS",
        "JS",
        "RAN",
        "SIG"
      ]
    },
    "MAN": {
      "name": "Manchuria",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "IRK",
        "MON",
        "PA",
        "PEK",
        "VLA"
      ]
    },
    "MAY": {
      "name": "Mandalay",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "BAN",
        "RAN",
        "TON",
        "YUN"
      ]
    },
    "MEC": {
      "name": "Mecca",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ADE",
        "ARA",
        "EGY",
        "RS",
        "SYR"
      ],
      "fleetAdjacent": [
        "ADE",
        "EGY",
        "RS"
      ]
    },
    "MNA": {
      "name": "Manila",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "CEB",
        "ECS",
        "MPO",
        "SCS"
      ],
      "fleetAdjacent": [
        "CEB",
        "ECS",
        "MPO",
        "SCS"
      ]
    },
    "MOM": {
      "name": "Mombasa",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "ABY",
        "GOA",
        "MAA",
        "SOM"
      ],
      "fleetAdjacent": [
        "GOA",
        "SOM"
      ]
    },
    "MON": {
      "name": "Mongolia",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "IRK",
        "KIR",
        "LAN",
        "MAN",
        "PEK",
        "SIN",
        "URU"
      ]
    },
    "MOS": {
      "name": "Moscow",
      "type": "land",
      "supplyCenter": true,
      "homePower": "russia",
      "adjacent": [
        "BAK",
        "BOK",
        "ODE",
        "ORE"
      ]
    },
    "MPO": {
      "name": "Middle Pacific Ocean",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "CEB",
        "ECS",
        "FOR",
        "LPO",
        "MNA",
        "UPO"
      ]
    },
    "MS": {
      "name": "Mediterranean Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ANG",
        "BS",
        "CON",
        "EGY",
        "SYR"
      ]
    },
    "MYS": {
      "name": "Mysore",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ARS",
        "BOM",
        "HYD",
        "MAD",
        "WIO"
      ],
      "fleetAdjacent": [
        "ARS",
        "BOM",
        "MAD",
        "WIO"
      ]
    },
    "NAG": {
      "name": "Nagpur",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "BOM",
        "DEL",
        "HYD",
        "LUC",
        "RAJ"
      ]
    },
    "NEP": {
      "name": "Nepal",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "BEN",
        "DEL",
        "LUC",
        "PUN"
      ]
    },
    "NG": {
      "name": "New Guinea",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "LPO",
        "TS"
      ],
      "fleetAdjacent": [
        "LPO",
        "TS"
      ]
    },
    "ODE": {
      "name": "Odessa",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "russia",
      "adjacent": [
        "BAK",
        "BS",
        "MOS",
        "RUM"
      ],
      "fleetAdjacent": [
        "BAK",
        "BS",
        "RUM"
      ]
    },
    "OMA": {
      "name": "Oman",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ADE",
        "ARA",
        "ARS",
        "PG"
      ],
      "fleetAdjacent": [
        "ADE",
        "ARA",
        "ARS",
        "PG"
      ]
    },
    "OMS": {
      "name": "Omsk",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "IRK",
        "KIR",
        "ORE"
      ]
    },
    "ORE": {
      "name": "Orenburg",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "BOK",
        "KIR",
        "MOS",
        "OMS",
        "TAS"
      ]
    },
    "OTA": {
      "name": "Otaru",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "AKI",
        "SAK",
        "SOJ",
        "SOO"
      ],
      "fleetAdjacent": [
        "AKI",
        "SAK",
        "SOJ",
        "SOO"
      ]
    },
    "PA": {
      "name": "Port Arthur",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "COR",
        "MAN",
        "PEK",
        "VLA",
        "YS"
      ],
      "fleetAdjacent": [
        "COR",
        "PEK",
        "YS"
      ]
    },
    "PEK": {
      "name": "Peking",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "china",
      "adjacent": [
        "LAN",
        "MAN",
        "MON",
        "PA",
        "SHA",
        "YS"
      ],
      "fleetAdjacent": [
        "PA",
        "SHA",
        "YS"
      ]
    },
    "PER": {
      "name": "Persia",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "AFG",
        "BOK",
        "KAR",
        "PG",
        "SHI",
        "TAB"
      ],
      "fleetAdjacent": [
        "KAR",
        "PG",
        "SHI"
      ]
    },
    "PG": {
      "name": "Persian Gulf",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ARA",
        "ARS",
        "BAG",
        "KAR",
        "OMA",
        "PER",
        "SHI"
      ]
    },
    "PUN": {
      "name": "Punjab",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "AFG",
        "DEL",
        "KAM",
        "KAR",
        "NEP",
        "RAJ",
        "TIB"
      ]
    },
    "RAJ": {
      "name": "Rajputana",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ARS",
        "BOM",
        "DEL",
        "KAR",
        "NAG",
        "PUN"
      ],
      "fleetAdjacent": [
        "ARS",
        "BOM",
        "KAR"
      ]
    },
    "RAN": {
      "name": "Rangoon",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "ANS",
        "ASM",
        "BAN",
        "BEN",
        "BOB",
        "MAL",
        "MAY",
        "YUN"
      ],
      "fleetAdjacent": [
        "ANS",
        "BEN",
        "BOB",
        "MAL"
      ]
    },
    "RS": {
      "name": "Red Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ADE",
        "EGY",
        "ERI",
        "GOA",
        "MEC",
        "SUD"
      ]
    },
    "RUM": {
      "name": "Rumania",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "BS",
        "CON",
        "ODE"
      ],
      "fleetAdjacent": [
        "BS",
        "CON",
        "ODE"
      ]
    },
    "SAK": {
      "name": "Sakhalin",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "OTA",
        "SOJ",
        "SOO",
        "VLA"
      ],
      "fleetAdjacent": [
        "OTA",
        "SOJ",
        "SOO",
        "VLA"
      ]
    },
    "SAR": {
      "name": "Sarawak",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "BOR",
        "CS",
        "GOS",
        "JS",
        "SCS"
      ],
      "fleetAdjacent": [
        "BOR",
        "CS",
        "GOS",
        "JS",
        "SCS"
      ]
    },
    "SCS": {
      "name": "South China Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ANN",
        "CAN",
        "CEB",
        "CS",
        "DAV",
        "ECS",
        "GOS",
        "HK",
        "MNA",
        "SAR",
        "TON",
        "YUN"
      ]
    },
    "SHA": {
      "name": "Shanghai",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "china",
      "adjacent": [
        "CAN",
        "CHU",
        "ECS",
        "LAN",
        "PEK",
        "YS"
      ],
      "fleetAdjacent": [
        "CAN",
        "ECS",
        "PEK",
        "YS"
      ]
    },
    "SHI": {
      "name": "Shiraz",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "BAG",
        "PER",
        "PG",
        "TAB"
      ],
      "fleetAdjacent": [
        "BAG",
        "PER",
        "PG"
      ]
    },
    "SIG": {
      "name": "Singapore",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "GOS",
        "JS",
        "MAL"
      ],
      "fleetAdjacent": [
        "GOS",
        "JS",
        "MAL"
      ]
    },
    "SIN": {
      "name": "Sinkiang",
      "type": "land",
      "supplyCenter": true,
      "homePower": "china",
      "adjacent": [
        "ASM",
        "CHU",
        "KAG",
        "LAN",
        "MON",
        "TIB",
        "URU"
      ]
    },
    "SIO": {
      "name": "South Indian Ocean",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "EIO",
        "GOA",
        "JAV",
        "JS",
        "SUM",
        "TS",
        "WIO"
      ]
    },
    "SOJ": {
      "name": "Sea of Japan",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "AKI",
        "COR",
        "KYO",
        "OTA",
        "SAK",
        "SOO",
        "VLA",
        "YS"
      ]
    },
    "SOM": {
      "name": "Somalia",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ABY",
        "ERI",
        "GOA",
        "MOM"
      ],
      "fleetAdjacent": [
        "ERI",
        "GOA",
        "MOM"
      ]
    },
    "SOO": {
      "name": "Sea of Okhotsk",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "AKI",
        "OTA",
        "SAK",
        "SOJ",
        "TOK",
        "UPO",
        "VLA"
      ]
    },
    "SUD": {
      "name": "Sudan",
      "type": "coast",
      "supplyCenter": true,
      "adjacent": [
        "ABY",
        "EGY",
        "ERI",
        "MAA",
        "RS"
      ],
      "fleetAdjacent": [
        "EGY",
        "ERI",
        "RS"
      ]
    },
    "SUM": {
      "name": "Sumatra",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "netherlands",
      "adjacent": [
        "ANS",
        "EIO",
        "JS",
        "SIO"
      ],
      "fleetAdjacent": [
        "ANS",
        "EIO",
        "JS",
        "SIO"
      ]
    },
    "SYR": {
      "name": "Syria",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ANG",
        "ARA",
        "ARM",
        "BAG",
        "EGY",
        "MEC",
        "MS"
      ],
      "fleetAdjacent": [
        "ANG",
        "EGY",
        "MS"
      ]
    },
    "TAB": {
      "name": "Tabriz",
      "type": "land",
      "supplyCenter": true,
      "adjacent": [
        "ARM",
        "BAG",
        "BAK",
        "PER",
        "SHI"
      ]
    },
    "TAS": {
      "name": "Tashkent",
      "type": "land",
      "supplyCenter": true,
      "adjacent": [
        "AFG",
        "BOK",
        "KAG",
        "KIR",
        "ORE"
      ]
    },
    "TIB": {
      "name": "Tibet",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "ASM",
        "BEN",
        "KAG",
        "KAM",
        "PUN",
        "SIN"
      ]
    },
    "TOK": {
      "name": "Tokyo",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "japan",
      "adjacent": [
        "AKI",
        "KYO",
        "SOO",
        "UPO"
      ],
      "fleetAdjacent": [
        "AKI",
        "KYO",
        "SOO",
        "UPO"
      ]
    },
    "TON": {
      "name": "Tonkin",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "france",
      "adjacent": [
        "ANN",
        "BAN",
        "CAM",
        "MAY",
        "SCS",
        "YUN"
      ],
      "fleetAdjacent": [
        "ANN",
        "SCS",
        "YUN"
      ]
    },
    "TS": {
      "name": "Timor Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "CEL",
        "JAV",
        "JS",
        "LPO",
        "NG",
        "SIO"
      ]
    },
    "UPO": {
      "name": "Upper Pacific Ocean",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "FOR",
        "KYO",
        "KYU",
        "MPO",
        "SOO",
        "TOK",
        "YS"
      ]
    },
    "URU": {
      "name": "Urumchi",
      "type": "land",
      "supplyCenter": false,
      "adjacent": [
        "KAG",
        "KIR",
        "MON",
        "SIN"
      ]
    },
    "VLA": {
      "name": "Vladivostok",
      "type": "coast",
      "supplyCenter": true,
      "homePower": "russia",
      "adjacent": [
        "COR",
        "IRK",
        "MAN",
        "PA",
        "SAK",
        "SOJ",
        "SOO"
      ],
      "fleetAdjacent": [
        "COR",
        "SAK",
        "SOJ",
        "SOO"
      ]
    },
    "WIO": {
      "name": "West Indian Ocean",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "ARS",
        "BOB",
        "CEY",
        "EIO",
        "GOA",
        "MAD",
        "MYS",
        "SIO"
      ]
    },
    "YS": {
      "name": "Yellow Sea",
      "type": "sea",
      "supplyCenter": false,
      "adjacent": [
        "COR",
        "ECS",
        "FOR",
        "KYO",
        "KYU",
        "PA",
        "PEK",
        "SHA",
        "SOJ",
        "UPO"
      ]
    },
    "YUN": {
      "name": "Yunnan",
      "type": "coast",
      "supplyCenter": false,
      "adjacent": [
        "ASM",
        "CAN",
        "CHU",
        "MAY",
        "RAN",
        "SCS",
        "TON"
      ],
      "fleetAdjacent": [
        "CAN",
        "SCS",
        "TON"
      ]
    }
  },
  "startingUnits": [
    {
      "type": "army",
      "power": "britain",
      "territory": "DEL"
    },
    {
      "type": "fleet",
      "power": "britain",
      "territory": "MAD"
    },
    {
      "type": "army",
      "power": "britain",
      "territory": "BOM"
    },
    {
      "type": "fleet",
      "power": "britain",
      "territory": "ADE"
    },
    {
      "type": "army",
      "power": "china",
      "territory": "PEK"
    },
    {
      "type": "fleet",
      "power": "china",
      "territory": "SHA"
    },
    {
      "type": "army",
      "power": "china",
      "territory": "SIN"
    },
    {
      "type": "army",
      "power": "france",
      "territory": "TON"
    },
    {
      "type": "fleet",
      "power": "france",
      "territory": "ANN"
    },
    {
      "type": "army",
      "power": "france",
      "territory": "COC"
    },
    {
      "type": "army",
      "power": "japan",
      "territory": "TOK"
    },
    {
      "type": "fleet",
      "power": "japan",
      "territory": "KYU"
    },
    {
      "type": "fleet",
      "power": "japan",
      "territory": "KYO"
    },
    {
      "type": "army",
      "power": "netherlands",
      "territory": "BOR"
    },
    {
      "type": "fleet",
      "power": "netherlands",
      "territory": "JAV"
    },
    {
      "type": "fleet",
      "power": "netherlands",
      "territory": "SUM"
    },
    {
      "type": "army",
      "power": "russia",
      "territory": "MOS"
    },
    {
      "type": "army",
      "power": "russia",
      "territory": "IRK"
    },
    {
      "type": "fleet",
      "power": "russia",
      "territory": "VLA"
    },
    {
      "type": "fleet",
      "power": "russia",
      "territory": "ODE"
    },
    {
      "type": "army",
      "power": "turkey",
      "territory": "ANG"
    },
    {
      "type": "fleet",
      "power": "turkey",
      "territory": "BAG"
    },
    {
      "type": "fleet",
      "power": "turkey",
      "territory": "CON"
    }
  ]
};

// src/lib/maps/index.ts
var maps = {
  classical: classicalMap,
  "1900": map1900,
  era: mapEra
};
function getMap(id) {
  const map = maps[id];
  if (!map) throw new Error(`Unknown map variant: ${id}`);
  return map;
}
export {
  ORDER_PHASES,
  adjudicate,
  boardFromUnits,
  getMap,
  idleNations,
  initialBoard,
  isOrderPhase,
  replayLog,
  roundRank
};
