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

// src/lib/orders/options.ts
var territory = (map, id) => map.territories[id];
var reachable = (map, unit) => {
  const t = territory(map, unit.territory);
  if (!t) return [];
  if (unit.type === "army") {
    return t.adjacent.filter((id) => {
      const adj = territory(map, id);
      return adj ? canArmyEnter(adj) : false;
    });
  }
  if (unit.coast && t.coasts?.[unit.coast]) {
    return [...t.coasts[unit.coast].fleetAdjacency];
  }
  if (t.fleetAdjacent) return [...t.fleetAdjacent];
  return t.adjacent.filter((id) => {
    const adj = territory(map, id);
    return adj ? canFleetEnter(adj) : false;
  });
};
var reachableCoasts = (map, target, from) => {
  const t = territory(map, target);
  if (!t?.coasts) return [];
  return Object.entries(t.coasts).filter(([, coast]) => coast.fleetAdjacency.includes(from)).map(([id]) => id);
};

// src/lib/adjudicator/graph.ts
var adjacentProvinces = (map, province) => {
  const t = map.territories[province];
  return t ? [...t.adjacent].sort() : [];
};
var directReach = (map, unit) => reachable(map, unit);
var canMoveDirect = (map, unit, dest) => reachable(map, unit).includes(dest);
var landingCoasts = (map, target, from) => reachableCoasts(map, target, from);
var isSea = (map, province) => map.territories[province]?.type === "sea";
var convoyPathExists = (map, from, to, convoyFleets) => {
  if (from === to) return false;
  const seasAdjTo = (p) => adjacentProvinces(map, p).includes(to);
  const frontier = adjacentProvinces(map, from).filter((s) => convoyFleets.has(s));
  const visited = new Set(frontier);
  const queue = [...frontier].sort();
  while (queue.length) {
    const s = queue.shift();
    if (seasAdjTo(s)) return true;
    for (const n of adjacentProvinces(map, s)) {
      if (convoyFleets.has(n) && !visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return false;
};

// src/lib/adjudicator/movement.ts
function resolveMovement(map, board, orders) {
  const units = board.units;
  const mo = [];
  const byProvince = /* @__PURE__ */ new Map();
  const submitted = /* @__PURE__ */ new Map();
  for (const o of orders) submitted.set(o.source, o);
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
    if (vacated) return 1 + supportCount(m);
    if (occ.unit.nation === m.unit.nation) return 0;
    return 1 + supportCount(m, occ.unit.nation);
  };
  const defendStrength = (m) => 1 + supportCount(m);
  const preventStrength = (m) => {
    if (!hasPath(m)) return 0;
    const h2h = headToHeadOpponent(m);
    if (h2h && resolve(h2h.idx)) return 0;
    return 1 + supportCount(m);
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
      const seaFleets = new Set(
        units.filter((u) => u.type === "fleet" && isSea(map, u.territory)).map((u) => u.territory)
      );
      if (convoyIntents.has(`${unit.territory}->${o.target}`) || convoyPathExists(map, unit.territory, o.target, seaFleets)) {
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
    return s;
  }
  if (o.type === "Convoy") {
    const c = base("convoy", { aux: o.aux, dst: o.target });
    if (unit.type !== "fleet" || map.territories[unit.territory]?.type !== "sea") {
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
  const byProvince = /* @__PURE__ */ new Map();
  for (const o of orders) byProvince.set(o.source, o);
  const dislodgedSet = new Set(board.dislodged.map((d) => d.unit.territory));
  for (const o of orders) {
    if (!dislodgedSet.has(o.source)) {
      results.push({ order: o, code: "void", reason: "no dislodged unit to retreat" });
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
  const destCount = /* @__PURE__ */ new Map();
  for (const it of intents) destCount.set(it.dest, (destCount.get(it.dest) ?? 0) + 1);
  for (const it of intents) {
    if ((destCount.get(it.dest) ?? 0) >= 2) {
      results.push({ order: it.order, code: "disbanded", reason: "retreats bounced" });
      continue;
    }
    survivors.push({ ...it.dis.unit, territory: it.dest, coast: it.coast });
    results.push({ order: it.order, code: "succeeds", reason: "retreat succeeds" });
  }
  return { units: sortUnits(survivors), results };
}
function legalRetreat(map, dis, dest, coast, occupied, contested) {
  if (occupied.has(dest)) return false;
  if (dest === dis.attackedFrom) return false;
  if (contested.includes(dest)) return false;
  if (!directReach(map, dis.unit).includes(dest)) return false;
  const destT = map.territories[dest];
  if (dis.unit.type === "fleet" && destT?.coasts) {
    const valid = landingCoasts(map, dest, dis.unit.territory);
    if (valid.length === 0) return false;
    if (coast && !valid.includes(coast)) return false;
    if (!coast && valid.length > 1) return false;
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
  const scCount = scCountByNation(owners);
  const unitCount = unitCountByNation(board.units);
  const units = board.units.map((u) => ({ ...u }));
  const results = [];
  const occupied = new Set(units.map((u) => u.territory));
  const nations = sortIds([.../* @__PURE__ */ new Set([...Object.keys(scCount), ...Object.keys(unitCount)])]);
  const ordersByNation = /* @__PURE__ */ new Map();
  for (const o of orders) {
    const list = ordersByNation.get(o.nation) ?? [];
    list.push(o);
    ordersByNation.set(o.nation, list);
  }
  for (const nation of nations) {
    const delta = (scCount[nation] ?? 0) - (unitCount[nation] ?? 0);
    const nationOrders = ordersByNation.get(nation) ?? [];
    if (delta > 0) {
      const homes = homeCenters(map, nation).filter(
        (sc) => owners[sc] === nation && !occupied.has(sc)
      );
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
        const candidates = units.filter((u) => u.nation === nation && !removed.has(u.territory)).sort(civilDisorderOrder(map, nation));
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
  }
  return { units: sortUnits(units), results };
}
function civilDisorderOrder(map, nation) {
  const homes = homeCenters(map, nation);
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
  const sc = scCountByNation(newOwners);
  const uc = unitCountByNation(units);
  const nations = /* @__PURE__ */ new Set([...Object.keys(sc), ...Object.keys(uc)]);
  const needsAdjustment = [...nations].some((n) => (sc[n] ?? 0) !== (uc[n] ?? 0));
  if (needsAdjustment) {
    return { phase: "build", season: "Fall", year, units, supplyCenters: newOwners, dislodged: [], contested: [] };
  }
  return { phase: "movement", season: "Spring", year: year + 1, units, supplyCenters: newOwners, dislodged: [], contested: [] };
}
function finalize(map, next, results) {
  const sc = scCountByNation(next.supplyCenters);
  const threshold = Math.floor(supplyCenterProvinces(map).length / 2) + 1;
  let victory;
  for (const [nation, centers] of Object.entries(sc)) {
    if (centers >= threshold && (!victory || centers > victory.centers)) {
      victory = { nation, centers };
    }
  }
  return { newBoardState: next, results, victory };
}

// src/lib/adjudicator/idle.ts
function idleNations(map, board) {
  const present = /* @__PURE__ */ new Set([
    ...board.units.map((u) => u.nation),
    ...Object.values(board.supplyCenters)
  ]);
  const idle = [];
  if (board.phase === "retreat") {
    const needsRetreat = new Set(board.dislodged.map((d) => d.unit.nation));
    for (const n of present) if (!needsRetreat.has(n)) idle.push(n);
    return idle;
  }
  if (board.phase === "build") {
    const sc = scCountByNation(board.supplyCenters);
    const un = unitCountByNation(board.units);
    const occupied = new Set(board.units.map((u) => u.territory));
    for (const n of present) {
      const delta = (sc[n] ?? 0) - (un[n] ?? 0);
      if (delta < 0) continue;
      if (delta > 0 && homeCenters(map, n).some((c) => board.supplyCenters[c] === n && !occupied.has(c))) {
        continue;
      }
      idle.push(n);
    }
    return idle;
  }
  const withUnits = new Set(board.units.map((u) => u.nation));
  for (const n of present) if (!withUnits.has(n)) idle.push(n);
  return idle;
}

// src/lib/adjudicator/index.ts
function seedOwnership(map, units) {
  const owners = {};
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
function initialBoard(map) {
  const units = map.startingUnits.map((u) => ({
    type: u.type,
    nation: u.power,
    territory: u.territory,
    coast: u.coast
  }));
  const owners = {};
  for (const [id, t] of Object.entries(map.territories)) {
    if (t.supplyCenter && t.homePower) owners[id] = t.homePower;
  }
  return {
    mapId: map.id,
    year: 1901,
    season: "Spring",
    phase: "movement",
    units: sortUnits(units),
    supplyCenters: recomputeSupplyCenters(map, units, owners),
    dislodged: [],
    contested: []
  };
}

// src/lib/maps/classical.ts
var classicalMap = {
  id: "classical",
  name: "Classical",
  description: "Classic Diplomacy \u2014 Europe 1901, 7 great powers, 34 supply centers",
  playerCount: 7,
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
      fleetAdjacent: ["EDI", "LVP", "NWG", "NAO"],
      render: { center: [133, 201] }
    },
    EDI: {
      name: "Edinburgh",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["CLY", "YOR", "LVP", "NTH", "NWG"],
      fleetAdjacent: ["CLY", "YOR", "NTH", "NWG"],
      render: { center: [152, 202] }
    },
    LVP: {
      name: "Liverpool",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["CLY", "EDI", "YOR", "WAL", "NAO", "IRI"],
      fleetAdjacent: ["CLY", "WAL", "NAO", "IRI"],
      render: { center: [138, 230] }
    },
    YOR: {
      name: "Yorkshire",
      type: "coast",
      supplyCenter: false,
      adjacent: ["EDI", "LVP", "LON", "WAL", "NTH"],
      fleetAdjacent: ["EDI", "LON", "NTH"],
      render: { center: [155, 254] }
    },
    WAL: {
      name: "Wales",
      type: "coast",
      supplyCenter: false,
      adjacent: ["LVP", "YOR", "LON", "ENG", "IRI"],
      fleetAdjacent: ["LVP", "LON", "ENG", "IRI"],
      render: { center: [130, 275] }
    },
    LON: {
      name: "London",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["YOR", "WAL", "NTH", "ENG"],
      fleetAdjacent: ["YOR", "WAL", "NTH", "ENG"],
      render: { center: [160, 280] }
    },
    // ──────────────────────────── FRANCE ────────────────────────────
    BRE: {
      name: "Brest",
      type: "coast",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["PIC", "PAR", "GAS", "ENG", "MAO"],
      fleetAdjacent: ["PIC", "GAS", "ENG", "MAO"],
      render: { center: [130, 345] }
    },
    PIC: {
      name: "Picardy",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BRE", "PAR", "BUR", "BEL", "ENG"],
      fleetAdjacent: ["BRE", "BEL", "ENG"],
      render: { center: [168, 326] }
    },
    PAR: {
      name: "Paris",
      type: "land",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["BRE", "PIC", "BUR", "GAS"],
      render: { center: [155, 358] }
    },
    BUR: {
      name: "Burgundy",
      type: "land",
      supplyCenter: false,
      adjacent: ["PIC", "PAR", "GAS", "MAR", "BEL", "RUH", "MUN"],
      render: { center: [185, 371] }
    },
    GAS: {
      name: "Gascony",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BRE", "PAR", "BUR", "MAR", "SPA", "MAO"],
      // Not MAR: Gascony and Marseilles share only a land border, no coastline.
      fleetAdjacent: ["BRE", "SPA", "MAO"],
      render: { center: [130, 400] }
    },
    MAR: {
      name: "Marseilles",
      type: "coast",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["GAS", "BUR", "PIE", "SPA", "GOL"],
      // Not GAS: land border only.
      fleetAdjacent: ["PIE", "SPA", "GOL"],
      render: { center: [173, 412] }
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
      fleetAdjacent: ["HOL", "DEN", "BER", "HEL", "BAL"],
      render: { center: [237, 285] }
    },
    BER: {
      name: "Berlin",
      type: "coast",
      supplyCenter: true,
      homePower: "germany",
      adjacent: ["KIE", "MUN", "SIL", "PRU", "BAL"],
      fleetAdjacent: ["KIE", "PRU", "BAL"],
      render: { center: [272, 292] }
    },
    MUN: {
      name: "Munich",
      type: "land",
      supplyCenter: true,
      homePower: "germany",
      adjacent: ["KIE", "BER", "SIL", "BOH", "TYR", "BUR", "RUH"],
      render: { center: [235, 360] }
    },
    PRU: {
      name: "Prussia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BER", "SIL", "WAR", "LVN", "BAL"],
      fleetAdjacent: ["BER", "LVN", "BAL"],
      render: { center: [335, 283] }
    },
    RUH: {
      name: "Ruhr",
      type: "land",
      supplyCenter: false,
      adjacent: ["BEL", "HOL", "KIE", "MUN", "BUR"],
      render: { center: [215, 330] }
    },
    SIL: {
      name: "Silesia",
      type: "land",
      supplyCenter: false,
      adjacent: ["MUN", "BER", "PRU", "WAR", "GAL", "BOH"],
      render: { center: [304, 325] }
    },
    // ──────────────────────────── ITALY ────────────────────────────
    PIE: {
      name: "Piedmont",
      type: "coast",
      supplyCenter: false,
      adjacent: ["MAR", "TYR", "VEN", "TUS", "GOL"],
      // Not VEN: Piedmont (Ligurian coast) and Venice (Adriatic) share land only.
      fleetAdjacent: ["MAR", "TUS", "GOL"],
      render: { center: [215, 408] }
    },
    VEN: {
      name: "Venice",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["PIE", "TYR", "TRI", "TUS", "APU", "ADR", "ROM"],
      // Not PIE/TUS/ROM: those border Venice by land only (Venice is Adriatic-side).
      fleetAdjacent: ["TRI", "APU", "ADR"],
      render: { center: [245, 407] }
    },
    TUS: {
      name: "Tuscany",
      type: "coast",
      supplyCenter: false,
      adjacent: ["PIE", "VEN", "ROM", "GOL", "TYS"],
      // Not VEN: land border only.
      fleetAdjacent: ["PIE", "ROM", "GOL", "TYS"],
      render: { center: [240, 425] }
    },
    ROM: {
      name: "Rome",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["TUS", "NAP", "APU", "TYS", "VEN"],
      // Not APU/VEN: both border Rome by land only (DATC 6.A.9 / 6.A.10).
      fleetAdjacent: ["TUS", "NAP", "TYS"],
      render: { center: [257, 452] }
    },
    NAP: {
      name: "Naples",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["ROM", "APU", "TYS", "ION"],
      fleetAdjacent: ["ROM", "APU", "TYS", "ION"],
      render: { center: [293, 493] }
    },
    APU: {
      name: "Apulia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["VEN", "ROM", "NAP", "ADR", "ION"],
      // Not ROM: land border only (Apulia is Adriatic/Ionian-side).
      fleetAdjacent: ["VEN", "NAP", "ADR", "ION"],
      render: { center: [291, 470] }
    },
    // ──────────────────────────── AUSTRIA-HUNGARY ────────────────────────────
    BOH: {
      name: "Bohemia",
      type: "land",
      supplyCenter: false,
      adjacent: ["MUN", "SIL", "GAL", "VIE", "TYR"],
      render: { center: [283, 347] }
    },
    TYR: {
      name: "Tyrolia",
      type: "land",
      supplyCenter: false,
      adjacent: ["MUN", "BOH", "VIE", "TRI", "VEN", "PIE"],
      render: { center: [255, 380] }
    },
    VIE: {
      name: "Vienna",
      type: "land",
      supplyCenter: true,
      homePower: "austria",
      adjacent: ["BOH", "GAL", "BUD", "TRI", "TYR"],
      render: { center: [307, 370] }
    },
    TRI: {
      name: "Trieste",
      type: "coast",
      supplyCenter: true,
      homePower: "austria",
      adjacent: ["TYR", "VIE", "BUD", "SER", "ALB", "ADR", "VEN"],
      fleetAdjacent: ["ALB", "ADR", "VEN"],
      render: { center: [305, 425] }
    },
    BUD: {
      name: "Budapest",
      type: "land",
      supplyCenter: true,
      homePower: "austria",
      adjacent: ["VIE", "GAL", "RUM", "SER", "TRI"],
      render: { center: [350, 390] }
    },
    GAL: {
      name: "Galicia",
      type: "land",
      supplyCenter: false,
      adjacent: ["BOH", "SIL", "WAR", "UKR", "RUM", "BUD", "VIE"],
      render: { center: [355, 343] }
    },
    // ──────────────────────────── RUSSIA ────────────────────────────
    STP: {
      name: "St. Petersburg",
      type: "coast",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["NOR", "FIN", "MOS", "LVN", "BAR", "BOT"],
      coasts: {
        nc: { name: "North Coast", fleetAdjacency: ["BAR", "NOR"], render: { center: [466, 128] } },
        sc: { name: "South Coast", fleetAdjacency: ["BOT", "LVN", "FIN"], render: { center: [416, 201] } }
      },
      render: { center: [460, 149] }
    },
    MOS: {
      name: "Moscow",
      type: "land",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["STP", "LVN", "WAR", "UKR", "SEV"],
      render: { center: [460, 265] }
    },
    FIN: {
      name: "Finland",
      type: "coast",
      supplyCenter: false,
      adjacent: ["STP", "NOR", "SWE", "BOT"],
      // Not NOR: Finland and Norway share a land border only.
      fleetAdjacent: ["STP", "SWE", "BOT"],
      render: { center: [375, 160] }
    },
    LVN: {
      name: "Livonia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["STP", "MOS", "WAR", "PRU", "BAL", "BOT"],
      fleetAdjacent: ["STP", "PRU", "BAL", "BOT"],
      render: { center: [380, 260] }
    },
    WAR: {
      name: "Warsaw",
      type: "land",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["LVN", "MOS", "UKR", "GAL", "SIL", "PRU"],
      render: { center: [355, 304] }
    },
    UKR: {
      name: "Ukraine",
      type: "land",
      supplyCenter: false,
      adjacent: ["MOS", "WAR", "GAL", "RUM", "SEV"],
      render: { center: [420, 340] }
    },
    SEV: {
      name: "Sevastopol",
      type: "coast",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["MOS", "UKR", "RUM", "ARM", "BLA"],
      fleetAdjacent: ["RUM", "ARM", "BLA"],
      render: { center: [540, 350] }
    },
    // ──────────────────────────── TURKEY ────────────────────────────
    CON: {
      name: "Constantinople",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["BUL", "BLA", "ANK", "SMY", "AEG"],
      // Constantinople is the strait joining the Black Sea (BLA) and the Aegean (AEG).
      fleetAdjacent: ["BUL", "BLA", "ANK", "SMY", "AEG"],
      render: { center: [435, 483] }
    },
    ANK: {
      name: "Ankara",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["CON", "BLA", "ARM", "SMY"],
      // Not SMY: Ankara (Black Sea side) reaches Smyrna by land only.
      fleetAdjacent: ["CON", "BLA", "ARM"],
      render: { center: [510, 455] }
    },
    SMY: {
      name: "Smyrna",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["CON", "AEG", "EAS", "SYR", "ARM", "ANK"],
      // Not ARM/ANK: Smyrna (Aegean side) reaches them by land only.
      fleetAdjacent: ["CON", "AEG", "EAS", "SYR"],
      render: { center: [460, 510] }
    },
    ARM: {
      name: "Armenia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["SEV", "BLA", "ANK", "SMY", "SYR"],
      // Not SMY/SYR: Armenia (Black Sea side) reaches them by land only.
      fleetAdjacent: ["SEV", "BLA", "ANK"],
      render: { center: [585, 467] }
    },
    SYR: {
      name: "Syria",
      type: "coast",
      supplyCenter: false,
      adjacent: ["SMY", "ARM", "EAS"],
      // Not ARM: land border only.
      fleetAdjacent: ["SMY", "EAS"],
      render: { center: [570, 535] }
    },
    // ──────────────────────────── NEUTRALS ────────────────────────────
    NOR: {
      name: "Norway",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NWG", "NTH", "SKA", "SWE", "FIN", "STP", "BAR"],
      // Not FIN: Norway and Finland share a land border only.
      fleetAdjacent: ["NWG", "NTH", "SKA", "SWE", "STP", "BAR"],
      render: { center: [250, 175] }
    },
    SWE: {
      name: "Sweden",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NOR", "FIN", "DEN", "SKA", "BAL", "BOT"],
      fleetAdjacent: ["NOR", "FIN", "DEN", "SKA", "BAL", "BOT"],
      render: { center: [300, 170] }
    },
    DEN: {
      name: "Denmark",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NTH", "SKA", "SWE", "KIE", "HEL", "BAL"],
      fleetAdjacent: ["NTH", "SKA", "SWE", "KIE", "HEL", "BAL"],
      render: { center: [250, 235] }
    },
    HOL: {
      name: "Holland",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BEL", "RUH", "KIE", "NTH", "HEL"],
      fleetAdjacent: ["BEL", "KIE", "NTH", "HEL"],
      render: { center: [210, 290] }
    },
    BEL: {
      name: "Belgium",
      type: "coast",
      supplyCenter: true,
      adjacent: ["HOL", "RUH", "BUR", "PIC", "ENG", "NTH"],
      fleetAdjacent: ["HOL", "PIC", "ENG", "NTH"],
      render: { center: [192, 321] }
    },
    SPA: {
      name: "Spain",
      type: "coast",
      supplyCenter: true,
      adjacent: ["POR", "GAS", "MAR", "MAO", "GOL", "WES"],
      coasts: {
        nc: { name: "North Coast", fleetAdjacency: ["POR", "GAS", "MAO"], render: { center: [78, 406] } },
        sc: { name: "South Coast", fleetAdjacency: ["POR", "MAR", "GOL", "WES"], render: { center: [98, 468] } }
      },
      render: { center: [85, 450] }
    },
    POR: {
      name: "Portugal",
      type: "coast",
      supplyCenter: true,
      adjacent: ["SPA", "MAO"],
      fleetAdjacent: ["SPA", "MAO"],
      render: { center: [22, 440] }
    },
    NAF: {
      name: "North Africa",
      type: "coast",
      supplyCenter: false,
      adjacent: ["MAO", "WES", "TUN"],
      fleetAdjacent: ["MAO", "WES", "TUN"],
      render: { center: [130, 536] }
    },
    TUN: {
      name: "Tunis",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NAF", "WES", "TYS", "ION"],
      fleetAdjacent: ["NAF", "WES", "TYS", "ION"],
      render: { center: [210, 555] }
    },
    SER: {
      name: "Serbia",
      type: "land",
      supplyCenter: true,
      adjacent: ["BUD", "TRI", "ALB", "GRE", "BUL", "RUM"],
      render: { center: [350, 450] }
    },
    ALB: {
      name: "Albania",
      type: "coast",
      supplyCenter: false,
      adjacent: ["TRI", "SER", "GRE", "ADR", "ION"],
      fleetAdjacent: ["TRI", "GRE", "ADR", "ION"],
      render: { center: [333, 460] }
    },
    GRE: {
      name: "Greece",
      type: "coast",
      supplyCenter: true,
      adjacent: ["SER", "ALB", "BUL", "AEG", "ION"],
      fleetAdjacent: ["ALB", "BUL", "AEG", "ION"],
      render: { center: [352, 490] }
    },
    BUL: {
      name: "Bulgaria",
      type: "coast",
      supplyCenter: true,
      adjacent: ["SER", "GRE", "CON", "RUM", "BLA", "AEG"],
      coasts: {
        ec: { name: "East Coast", fleetAdjacency: ["BLA", "CON", "RUM"], render: { center: [415, 433] } },
        sc: { name: "South Coast", fleetAdjacency: ["AEG", "GRE", "CON"], render: { center: [402, 459] } }
      },
      render: { center: [395, 443] }
    },
    RUM: {
      name: "Rumania",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BUD", "GAL", "UKR", "SEV", "BUL", "SER", "BLA"],
      fleetAdjacent: ["SEV", "BUL", "BLA"],
      render: { center: [410, 415] }
    },
    // ──────────────────────────── SEA ZONES ────────────────────────────
    NAO: {
      name: "North Atlantic Ocean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NWG", "CLY", "LVP", "IRI", "MAO"],
      render: { center: [65, 120] }
    },
    NWG: {
      name: "Norwegian Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NAO", "CLY", "EDI", "NOR", "BAR", "NTH"],
      render: { center: [220, 70] }
    },
    BAR: {
      name: "Barents Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NWG", "NOR", "STP"],
      render: { center: [440, 15] }
    },
    NTH: {
      name: "North Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NWG", "NOR", "DEN", "SKA", "HOL", "BEL", "ENG", "LON", "YOR", "EDI", "HEL"],
      render: { center: [190, 230] }
    },
    SKA: {
      name: "Skagerrak",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NOR", "SWE", "DEN", "NTH"],
      render: { center: [255, 220] }
    },
    HEL: {
      name: "Helgoland Bight",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NTH", "HOL", "DEN", "KIE"],
      render: { center: [220, 265] }
    },
    BAL: {
      name: "Baltic Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["DEN", "SWE", "KIE", "BER", "PRU", "LVN", "BOT"],
      render: { center: [308, 260] }
    },
    BOT: {
      name: "Gulf of Bothnia",
      type: "sea",
      supplyCenter: false,
      adjacent: ["SWE", "FIN", "STP", "LVN", "BAL"],
      render: { center: [328, 175] }
    },
    ENG: {
      name: "English Channel",
      type: "sea",
      supplyCenter: false,
      adjacent: ["LON", "WAL", "IRI", "MAO", "BRE", "PIC", "BEL", "NTH"],
      render: { center: [135, 306] }
    },
    IRI: {
      name: "Irish Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NAO", "LVP", "WAL", "ENG", "MAO"],
      render: { center: [95, 270] }
    },
    MAO: {
      name: "Mid-Atlantic Ocean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NAO", "IRI", "ENG", "BRE", "GAS", "SPA", "POR", "NAF", "WES"],
      render: { center: [50, 355] }
    },
    WES: {
      name: "Western Mediterranean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["MAO", "SPA", "GOL", "NAF", "TUN", "TYS"],
      render: { center: [160, 491] }
    },
    GOL: {
      name: "Gulf of Lyon",
      type: "sea",
      supplyCenter: false,
      adjacent: ["SPA", "MAR", "PIE", "TUS", "WES", "TYS"],
      render: { center: [170, 457] }
    },
    TYS: {
      name: "Tyrrhenian Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["GOL", "TUS", "ROM", "NAP", "WES", "TUN", "ION"],
      render: { center: [245, 495] }
    },
    ION: {
      name: "Ionian Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["TUN", "TYS", "NAP", "APU", "ADR", "ALB", "GRE", "AEG", "EAS"],
      render: { center: [315, 520] }
    },
    ADR: {
      name: "Adriatic Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["VEN", "TRI", "ALB", "APU", "ION"],
      render: { center: [308, 460] }
    },
    AEG: {
      name: "Aegean Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["GRE", "BUL", "CON", "SMY", "EAS", "ION"],
      render: { center: [392, 510] }
    },
    EAS: {
      name: "Eastern Mediterranean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["AEG", "SMY", "SYR", "ION"],
      render: { center: [455, 550] }
    },
    BLA: {
      name: "Black Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["RUM", "SEV", "ARM", "ANK", "CON", "BUL"],
      render: { center: [500, 418] }
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
  id: "1900",
  name: "1900",
  description: "Baron M. Powell's 1900 \u2014 historically tuned Europe, 7 powers, 39 supply centers",
  playerCount: 7,
  powers: [
    { id: "austria", name: "Austria-Hungary", color: "#f0574e" },
    { id: "england", name: "Britain", color: "#4b85fe" },
    { id: "france", name: "France", color: "#00bdd5" },
    { id: "germany", name: "Germany", color: "#8c929f" },
    { id: "italy", name: "Italy", color: "#4aa961" },
    { id: "russia", name: "Russia", color: "#9975fa" },
    { id: "turkey", name: "Turkey", color: "#f5af20" }
  ],
  territories: {
    ADR: {
      name: "Adriatic Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["APU", "BOS", "ION", "MAC", "TRI", "VEN"],
      render: { center: [455, 495] }
    },
    AEG: {
      name: "Aegean Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["CON", "EAS", "GRE", "ION", "KON", "MAC"],
      render: { center: [545, 532] }
    },
    ALG: {
      name: "Algeria",
      type: "coast",
      supplyCenter: true,
      adjacent: ["MOR", "SOU", "TUN", "TYS", "WES"],
      fleetAdjacent: ["MOR", "TUN", "TYS", "WES"],
      render: { center: [270, 585] }
    },
    ALS: {
      name: "Alsace",
      type: "land",
      supplyCenter: false,
      adjacent: ["BEL", "BUR", "COL", "MUN", "SWI"],
      render: { center: [350, 375] }
    },
    ANK: {
      name: "Ankara",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["ARM", "BLA", "CON", "KON"],
      fleetAdjacent: ["ARM", "BLA", "CON"],
      render: { center: [645, 480] }
    },
    APU: {
      name: "Apulia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["ADR", "ION", "NAP", "ROM", "VEN"],
      fleetAdjacent: ["ADR", "ION", "NAP", "VEN"],
      render: { center: [408, 485] }
    },
    ARA: {
      name: "Arabia",
      type: "land",
      supplyCenter: false,
      adjacent: ["DAM", "HEJ", "PAL"],
      render: { center: [740, 610] }
    },
    ARM: {
      name: "Armenia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["ANK", "BLA", "DAM", "KON", "SEV"],
      fleetAdjacent: ["ANK", "BLA", "SEV"],
      render: { center: [700, 490] }
    },
    BAL: {
      name: "Baltic Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["BER", "DEN", "GBO", "KIE", "LVO", "PRU", "SWE"],
      render: { center: [435, 283] }
    },
    BAR: {
      name: "Barents Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["NWS", "NWY", "STP"],
      render: { center: [580, 20] }
    },
    BEL: {
      name: "Belgium",
      type: "coast",
      supplyCenter: true,
      adjacent: ["ALS", "BUR", "COL", "ENG", "NET", "NTH", "PIC"],
      fleetAdjacent: ["ENG", "NET", "NTH", "PIC"],
      render: { center: [328, 346] }
    },
    BER: {
      name: "Berlin",
      type: "coast",
      supplyCenter: true,
      homePower: "germany",
      adjacent: ["BAL", "KIE", "MUN", "PRU", "SIL"],
      fleetAdjacent: ["BAL", "KIE", "PRU"],
      render: { center: [428, 315] }
    },
    BLA: {
      name: "Black Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["ANK", "ARM", "BUL", "CON", "RUM", "SEV"],
      render: { center: [615, 458] }
    },
    BOH: {
      name: "Bohemia",
      type: "land",
      supplyCenter: false,
      adjacent: ["BUD", "GAL", "MUN", "SIL", "TYR", "VIE"],
      render: { center: [450, 370] }
    },
    BOS: {
      name: "Bosnia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["ADR", "MAC", "SER", "TRI"],
      fleetAdjacent: ["ADR", "MAC", "TRI"],
      render: { center: [460, 468] }
    },
    BRE: {
      name: "Brest",
      type: "coast",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["ENG", "GAS", "MID", "PAR", "PIC"],
      fleetAdjacent: ["ENG", "GAS", "MID", "PIC"],
      render: { center: [265, 390] }
    },
    BUD: {
      name: "Budapest",
      type: "land",
      supplyCenter: true,
      homePower: "austria",
      adjacent: ["BOH", "GAL", "RUM", "SER", "TRI", "VIE"],
      render: { center: [495, 390] }
    },
    BUL: {
      name: "Bulgaria",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BLA", "CON", "MAC", "RUM", "SER"],
      fleetAdjacent: ["BLA", "CON", "RUM"],
      render: { center: [550, 475] }
    },
    BUR: {
      name: "Burgundy",
      type: "land",
      supplyCenter: false,
      adjacent: ["ALS", "BEL", "GAS", "MAR", "PAR", "PIC", "SWI"],
      render: { center: [325, 398] }
    },
    CLY: {
      name: "Clyde",
      type: "coast",
      supplyCenter: false,
      adjacent: ["EDI", "IRE", "LVP", "NAT", "NWS"],
      fleetAdjacent: ["EDI", "IRE", "LVP", "NAT", "NWS"],
      render: { center: [267, 220] }
    },
    COL: {
      name: "Cologne",
      type: "land",
      supplyCenter: true,
      homePower: "germany",
      adjacent: ["ALS", "BEL", "KIE", "MUN", "NET"],
      render: { center: [360, 335] }
    },
    CON: {
      name: "Constantinople",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["AEG", "ANK", "BLA", "BUL", "KON", "MAC"],
      fleetAdjacent: ["AEG", "ANK", "BLA", "BUL", "KON", "MAC"],
      render: { center: [575, 520] }
    },
    CYR: {
      name: "Cyrenaica",
      type: "coast",
      supplyCenter: false,
      adjacent: ["EAS", "EGY", "ION", "TRP"],
      fleetAdjacent: ["EAS", "EGY", "ION", "TRP"],
      render: { center: [535, 670] }
    },
    DAM: {
      name: "Damascus",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["ARA", "ARM", "EAS", "KON", "PAL"],
      fleetAdjacent: ["EAS", "KON", "PAL"],
      render: { center: [730, 545] }
    },
    DEN: {
      name: "Denmark",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BAL", "HEL", "KIE", "NTH", "SKA", "SWE"],
      fleetAdjacent: ["BAL", "HEL", "KIE", "NTH", "SKA", "SWE"],
      render: { center: [383, 275] }
    },
    EAS: {
      name: "Eastern Mediterranean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["AEG", "CYR", "DAM", "EGY", "ION", "KON", "PAL"],
      render: { center: [585, 610] }
    },
    EDI: {
      name: "Edinburgh",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["CLY", "LVP", "NTH", "NWS", "YOR"],
      fleetAdjacent: ["CLY", "NTH", "NWS", "YOR"],
      render: { center: [275, 237] }
    },
    EGY: {
      name: "Egypt",
      type: "coast",
      supplyCenter: true,
      adjacent: ["CYR", "EAS", "HEJ", "MID", "PAL"],
      fleetAdjacent: ["CYR", "EAS", "HEJ", "MID", "PAL"],
      render: { center: [625, 670] }
    },
    ENG: {
      name: "English Channel",
      type: "sea",
      supplyCenter: false,
      adjacent: ["BEL", "BRE", "IRI", "LON", "MID", "NTH", "PIC", "WAL"],
      render: { center: [280, 345] }
    },
    FIN: {
      name: "Finland",
      type: "coast",
      supplyCenter: false,
      adjacent: ["GBO", "NWY", "STP", "SWE"],
      fleetAdjacent: ["GBO", "STP", "SWE"],
      render: { center: [515, 155] }
    },
    GAL: {
      name: "Galicia",
      type: "land",
      supplyCenter: false,
      adjacent: ["BOH", "BUD", "RUM", "SIL", "UKR", "WAR"],
      render: { center: [530, 375] }
    },
    GAS: {
      name: "Gascony",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BRE", "BUR", "MAR", "MID", "PAR", "SPA"],
      fleetAdjacent: ["BRE", "MID", "SPA"],
      render: { center: [255, 440] }
    },
    GBO: {
      name: "Gulf of Bothnia",
      type: "sea",
      supplyCenter: false,
      adjacent: ["BAL", "FIN", "LVO", "STP", "SWE"],
      render: { center: [470, 225] }
    },
    GIB: {
      name: "Gibraltar",
      type: "coast",
      supplyCenter: false,
      adjacent: ["MID", "MOR", "SPA", "WES"],
      fleetAdjacent: ["MID", "MOR", "SPA", "WES"],
      render: { center: [165, 545] }
    },
    GLY: {
      name: "Gulf of Lyon",
      type: "sea",
      supplyCenter: false,
      adjacent: ["MAR", "PIE", "ROM", "SPA", "TYS", "WES"],
      render: { center: [310, 470] }
    },
    GRE: {
      name: "Greece",
      type: "coast",
      supplyCenter: true,
      adjacent: ["AEG", "ION", "MAC"],
      fleetAdjacent: ["AEG", "ION", "MAC"],
      render: { center: [510, 550] }
    },
    HEJ: {
      name: "Hejaz",
      type: "coast",
      supplyCenter: false,
      adjacent: ["ARA", "EGY", "MID", "PAL"],
      fleetAdjacent: ["EGY", "MID"],
      render: { center: [718, 675] }
    },
    HEL: {
      name: "Helgoland Bight",
      type: "sea",
      supplyCenter: false,
      adjacent: ["DEN", "KIE", "NET", "NTH"],
      render: { center: [360, 285] }
    },
    ICE: {
      name: "Iceland",
      type: "coast",
      supplyCenter: false,
      adjacent: ["ICE", "NAT", "NWS"],
      fleetAdjacent: ["NAT", "NWS"],
      render: { center: [225, 60] }
    },
    ION: {
      name: "Ionian Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["ADR", "AEG", "APU", "CYR", "EAS", "GRE", "MAC", "NAP", "TRP", "TUN", "TYS"],
      render: { center: [470, 590] }
    },
    IRE: {
      name: "Ireland",
      type: "coast",
      supplyCenter: false,
      adjacent: ["CLY", "IRI", "MID", "NAT"],
      fleetAdjacent: ["CLY", "IRI", "MID", "NAT"],
      render: { center: [225, 262] }
    },
    IRI: {
      name: "Irish Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["ENG", "IRE", "LVP", "MID", "NAT", "WAL"],
      render: { center: [215, 310] }
    },
    KIE: {
      name: "Kiel",
      type: "coast",
      supplyCenter: true,
      homePower: "germany",
      adjacent: ["BAL", "BER", "COL", "DEN", "HEL", "MUN", "NET"],
      fleetAdjacent: ["BAL", "BER", "DEN", "HEL", "NET"],
      render: { center: [360, 315] }
    },
    KON: {
      name: "Konya",
      type: "coast",
      supplyCenter: false,
      adjacent: ["AEG", "ANK", "ARM", "CON", "DAM", "EAS"],
      fleetAdjacent: ["AEG", "CON", "DAM", "EAS"],
      render: { center: [653, 530] }
    },
    LON: {
      name: "London",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["ENG", "NTH", "WAL", "YOR"],
      fleetAdjacent: ["ENG", "NTH", "WAL", "YOR"],
      render: { center: [260, 325] }
    },
    LVO: {
      name: "Livonia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BAL", "GBO", "MOS", "PRU", "STP", "WAR"],
      fleetAdjacent: ["BAL", "GBO", "PRU", "STP"],
      render: { center: [520, 240] }
    },
    LVP: {
      name: "Liverpool",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["CLY", "EDI", "IRI", "NAT", "WAL", "YOR"],
      fleetAdjacent: ["CLY", "IRI", "NAT", "WAL"],
      render: { center: [268, 269] }
    },
    MAC: {
      name: "Macedonia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["ADR", "AEG", "BOS", "BUL", "CON", "GRE", "ION", "SER"],
      coasts: {
        wc: { name: "West Coast", fleetAdjacency: ["ADR", "BOS", "GRE", "ION"], render: { center: [495, 490] } },
        ec: { name: "East Coast", fleetAdjacency: ["AEG", "CON", "GRE"], render: { center: [495, 490] } }
      },
      render: { center: [495, 490] }
    },
    MAR: {
      name: "Marseilles",
      type: "coast",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["BUR", "GAS", "GLY", "PIE", "SPA", "SWI"],
      fleetAdjacent: ["GLY", "PIE", "SPA"],
      render: { center: [287, 455] }
    },
    MID: {
      name: "Mid-Atlantic Ocean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["BRE", "EGY", "ENG", "GAS", "GIB", "HEJ", "IRE", "IRI", "MOR", "NAT", "POR", "SPA"],
      render: { center: [100, 395] }
    },
    MIL: {
      name: "Milan",
      type: "land",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["PIE", "ROM", "SWI", "TYR", "VEN"],
      render: { center: [365, 430] }
    },
    MOR: {
      name: "Morocco",
      type: "coast",
      supplyCenter: true,
      adjacent: ["ALG", "GIB", "MID", "SOU", "WES"],
      fleetAdjacent: ["ALG", "GIB", "MID", "WES"],
      render: { center: [145, 625] }
    },
    MOS: {
      name: "Moscow",
      type: "land",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["LVO", "SEV", "SIB", "STP", "UKR", "WAR"],
      render: { center: [622, 255] }
    },
    MUN: {
      name: "Munich",
      type: "land",
      supplyCenter: true,
      homePower: "germany",
      adjacent: ["ALS", "BER", "BOH", "COL", "KIE", "SIL", "SWI", "TYR"],
      render: { center: [375, 355] }
    },
    NAP: {
      name: "Naples",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["APU", "ION", "ROM", "TYS"],
      fleetAdjacent: ["APU", "ION", "ROM", "TYS"],
      render: { center: [438, 526] }
    },
    NAT: {
      name: "North Atlantic Ocean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["CLY", "ICE", "IRE", "IRI", "LVP", "MID", "NWS"],
      render: { center: [135, 140] }
    },
    NET: {
      name: "Netherlands",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BEL", "COL", "HEL", "KIE", "NTH"],
      fleetAdjacent: ["BEL", "HEL", "KIE", "NTH"],
      render: { center: [335, 320] }
    },
    NTH: {
      name: "North Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["BEL", "DEN", "EDI", "ENG", "HEL", "LON", "NET", "NWS", "NWY", "SKA", "YOR"],
      render: { center: [320, 275] }
    },
    NWS: {
      name: "Norwegian Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["BAR", "CLY", "EDI", "ICE", "NAT", "NTH", "NWY"],
      render: { center: [345, 110] }
    },
    NWY: {
      name: "Norway",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BAR", "FIN", "NTH", "NWS", "SKA", "STP", "SWE"],
      fleetAdjacent: ["BAR", "NTH", "NWS", "SKA", "STP", "SWE"],
      render: { center: [370, 190] }
    },
    PAL: {
      name: "Palestine",
      type: "coast",
      supplyCenter: false,
      adjacent: ["ARA", "DAM", "EAS", "EGY", "HEJ"],
      fleetAdjacent: ["DAM", "EAS", "EGY"],
      render: { center: [710, 620] }
    },
    PAR: {
      name: "Paris",
      type: "land",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["BRE", "BUR", "GAS", "PIC"],
      render: { center: [295, 387] }
    },
    PIC: {
      name: "Picardy",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BEL", "BRE", "BUR", "ENG", "PAR"],
      fleetAdjacent: ["BEL", "BRE", "ENG"],
      render: { center: [283, 365] }
    },
    PIE: {
      name: "Piedmont",
      type: "coast",
      supplyCenter: false,
      adjacent: ["GLY", "MAR", "MIL", "ROM", "SWI"],
      fleetAdjacent: ["GLY", "MAR", "ROM"],
      render: { center: [343, 434] }
    },
    POR: {
      name: "Portugal",
      type: "coast",
      supplyCenter: true,
      adjacent: ["MID", "SPA"],
      fleetAdjacent: ["MID", "SPA"],
      render: { center: [150, 478] }
    },
    PRU: {
      name: "Prussia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BAL", "BER", "LVO", "SIL", "WAR"],
      fleetAdjacent: ["BAL", "BER", "LVO"],
      render: { center: [457, 310] }
    },
    ROM: {
      name: "Rome",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["APU", "GLY", "MIL", "NAP", "PIE", "TYS", "VEN"],
      fleetAdjacent: ["GLY", "NAP", "PIE", "TYS"],
      render: { center: [380, 470] }
    },
    RUM: {
      name: "Rumania",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BLA", "BUD", "BUL", "GAL", "SER", "SEV", "UKR"],
      fleetAdjacent: ["BLA", "BUL", "SEV"],
      render: { center: [565, 422] }
    },
    SER: {
      name: "Serbia",
      type: "land",
      supplyCenter: true,
      adjacent: ["BOS", "BUD", "BUL", "MAC", "RUM", "TRI"],
      render: { center: [490, 465] }
    },
    SEV: {
      name: "Sevastopol",
      type: "coast",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["ARM", "BLA", "MOS", "RUM", "SIB", "UKR"],
      fleetAdjacent: ["ARM", "BLA", "RUM"],
      render: { center: [630, 400] }
    },
    SIB: {
      name: "Siberia",
      type: "land",
      supplyCenter: false,
      adjacent: ["MOS", "SEV", "STP"],
      render: { center: [730, 235] }
    },
    SIL: {
      name: "Silesia",
      type: "land",
      supplyCenter: false,
      adjacent: ["BER", "BOH", "GAL", "MUN", "PRU", "WAR"],
      render: { center: [445, 340] }
    },
    SKA: {
      name: "Skagerrak",
      type: "sea",
      supplyCenter: false,
      adjacent: ["DEN", "NTH", "NWY", "SWE"],
      render: { center: [370, 238] }
    },
    SOU: {
      name: "Southern Algeria",
      type: "land",
      supplyCenter: false,
      adjacent: ["ALG", "MOR", "TRP", "TUN"],
      render: { center: [250, 660] }
    },
    SPA: {
      name: "Spain",
      type: "coast",
      supplyCenter: true,
      adjacent: ["GAS", "GIB", "GLY", "MAR", "MID", "POR", "WES"],
      coasts: {
        nc: { name: "North Coast", fleetAdjacency: ["GAS", "MID", "POR"], render: { center: [215, 465] } },
        wc: { name: "West Coast", fleetAdjacency: ["GIB", "MID", "POR"], render: { center: [215, 465] } },
        ec: { name: "East Coast", fleetAdjacency: ["GIB", "GLY", "MAR", "WES"], render: { center: [215, 465] } }
      },
      render: { center: [215, 465] }
    },
    STP: {
      name: "St. Petersburg",
      type: "coast",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["BAR", "FIN", "GBO", "LVO", "MOS", "NWY", "SIB"],
      coasts: {
        nc: { name: "North Coast", fleetAdjacency: ["BAR", "NWY"], render: { center: [615, 155] } },
        sc: { name: "South Coast", fleetAdjacency: ["FIN", "GBO", "LVO"], render: { center: [615, 155] } }
      },
      render: { center: [615, 155] }
    },
    SWE: {
      name: "Sweden",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BAL", "DEN", "FIN", "GBO", "NWY", "SKA"],
      fleetAdjacent: ["BAL", "DEN", "FIN", "GBO", "NWY", "SKA"],
      render: { center: [425, 190] }
    },
    SWI: {
      name: "Switzerland",
      type: "land",
      supplyCenter: true,
      adjacent: ["ALS", "BUR", "MAR", "MIL", "MUN", "PIE", "TYR"],
      render: { center: [340, 416] }
    },
    TRI: {
      name: "Trieste",
      type: "coast",
      supplyCenter: true,
      homePower: "austria",
      adjacent: ["ADR", "BOS", "BUD", "SER", "TYR", "VEN", "VIE"],
      fleetAdjacent: ["ADR", "BOS", "VEN"],
      render: { center: [430, 437] }
    },
    TRP: {
      name: "Tripolitania",
      type: "coast",
      supplyCenter: true,
      adjacent: ["CYR", "ION", "SOU", "TUN"],
      fleetAdjacent: ["CYR", "ION", "TUN"],
      render: { center: [415, 670] }
    },
    TUN: {
      name: "Tunisia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["ALG", "ION", "SOU", "TRP", "TYS"],
      fleetAdjacent: ["ALG", "ION", "TRP", "TYS"],
      render: { center: [355, 600] }
    },
    TYR: {
      name: "Tyrolia",
      type: "land",
      supplyCenter: false,
      adjacent: ["BOH", "MIL", "MUN", "SWI", "TRI", "VEN", "VIE"],
      render: { center: [385, 413] }
    },
    TYS: {
      name: "Tyrrhenian Sea",
      type: "sea",
      supplyCenter: false,
      adjacent: ["ALG", "GLY", "ION", "NAP", "ROM", "TUN", "WES"],
      render: { center: [385, 515] }
    },
    UKR: {
      name: "Ukraine",
      type: "land",
      supplyCenter: false,
      adjacent: ["GAL", "MOS", "RUM", "SEV", "WAR"],
      render: { center: [560, 370] }
    },
    VEN: {
      name: "Venetia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["ADR", "APU", "MIL", "ROM", "TRI", "TYR"],
      fleetAdjacent: ["ADR", "APU", "TRI"],
      render: { center: [388, 435] }
    },
    VIE: {
      name: "Vienna",
      type: "land",
      supplyCenter: true,
      homePower: "austria",
      adjacent: ["BOH", "BUD", "TRI", "TYR"],
      render: { center: [432, 408] }
    },
    WAL: {
      name: "Wales",
      type: "coast",
      supplyCenter: false,
      adjacent: ["ENG", "IRI", "LON", "LVP", "YOR"],
      fleetAdjacent: ["ENG", "IRI", "LON", "LVP"],
      render: { center: [250, 295] }
    },
    WAR: {
      name: "Warsaw",
      type: "land",
      supplyCenter: true,
      homePower: "russia",
      adjacent: ["GAL", "LVO", "MOS", "PRU", "SIL", "UKR"],
      render: { center: [472, 325] }
    },
    WES: {
      name: "Western Mediterranean",
      type: "sea",
      supplyCenter: false,
      adjacent: ["ALG", "GIB", "GLY", "MOR", "SPA", "TYS"],
      render: { center: [300, 525] }
    },
    YOR: {
      name: "Yorkshire",
      type: "coast",
      supplyCenter: false,
      adjacent: ["EDI", "LON", "LVP", "NTH", "WAL"],
      fleetAdjacent: ["EDI", "LON", "NTH"],
      render: { center: [280, 280] }
    }
  },
  startingUnits: [
    { type: "army", power: "france", territory: "ALG" },
    { type: "fleet", power: "turkey", territory: "ANK" },
    { type: "army", power: "germany", territory: "BER" },
    { type: "fleet", power: "france", territory: "BRE" },
    { type: "army", power: "austria", territory: "BUD" },
    { type: "army", power: "germany", territory: "COL" },
    { type: "army", power: "turkey", territory: "CON" },
    { type: "army", power: "turkey", territory: "DAM" },
    { type: "fleet", power: "england", territory: "EDI" },
    { type: "fleet", power: "england", territory: "EGY" },
    { type: "fleet", power: "england", territory: "GIB" },
    { type: "fleet", power: "germany", territory: "KIE" },
    { type: "fleet", power: "england", territory: "LON" },
    { type: "army", power: "france", territory: "MAR" },
    { type: "army", power: "italy", territory: "MIL" },
    { type: "army", power: "russia", territory: "MOS" },
    { type: "army", power: "germany", territory: "MUN" },
    { type: "fleet", power: "italy", territory: "NAP" },
    { type: "army", power: "france", territory: "PAR" },
    { type: "army", power: "italy", territory: "ROM" },
    { type: "fleet", power: "russia", territory: "SEV" },
    { type: "fleet", power: "russia", territory: "STP", coast: "sc" },
    { type: "army", power: "austria", territory: "TRI" },
    { type: "army", power: "austria", territory: "VIE" },
    { type: "army", power: "russia", territory: "WAR" }
  ]
};

// src/lib/maps/index.ts
var maps = {
  classical: classicalMap,
  "1900": map1900
};
function getMap(id) {
  const map = maps[id];
  if (!map) throw new Error(`Unknown map variant: ${id}`);
  return map;
}
export {
  adjudicate,
  boardFromUnits,
  getMap,
  idleNations,
  initialBoard
};
