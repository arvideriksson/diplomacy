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
  const hasPath = (m) => {
    if (m.unit.type === "fleet") return true;
    if (canMoveDirect(map, m.unit, m.dst)) return true;
    const fleets = new Set(matchingConvoys(m).filter((c) => resolve(c.idx)).map((c) => c.src));
    return convoyPathExists(map, m.src, m.dst, fleets);
  };
  const isConvoyedMove = (m) => {
    if (m.unit.type !== "army" || m.void) return false;
    const convoys = matchingConvoys(m);
    if (convoys.length === 0) return false;
    const fleets = new Set(convoys.filter((c) => resolve(c.idx)).map((c) => c.src));
    return convoyPathExists(map, m.src, m.dst, fleets);
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
    backupRule(deps.slice(oldDeps));
    for (let i = oldDeps; i < deps.length; i++)
      if (state[deps[i]] !== "resolved") state[deps[i]] = "unresolved";
    deps.length = oldDeps;
    return resolve(idx);
  }
  function backupRule(cycle) {
    const orders2 = sortIds(cycle.map(String)).map((s) => mo[Number(s)]);
    const convoysInCycle = orders2.filter((o) => o.kind === "convoy");
    if (convoysInCycle.length) {
      for (const c of convoysInCycle) {
        resolution[c.idx] = false;
        state[c.idx] = "resolved";
        const carried = mo.find(
          (m) => m.kind === "move" && !m.void && m.src === c.aux && m.dst === c.dst
        );
        if (carried) {
          resolution[carried.idx] = false;
          state[carried.idx] = "resolved";
        }
      }
    } else {
      for (const o of orders2) {
        if (o.kind === "move") {
          resolution[o.idx] = true;
          state[o.idx] = "resolved";
        }
      }
    }
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
    const m = base("move", { dst: o.target, dstCoast: o.targetCoast });
    if (!o.target) return voidify(m, "move without destination");
    if (o.sourceCoast && o.sourceCoast !== unit.coast) {
      return voidify(m, "order specifies the wrong source coast");
    }
    if (unit.type === "army" && o.targetCoast) {
      return voidify(m, "army cannot be ordered to a coast");
    }
    if (unit.type === "army" && !canMoveDirect(map, unit, o.target)) {
      const destT = map.territories[o.target];
      const srcT = map.territories[unit.territory];
      const coastalPair = destT?.type === "coast" && srcT?.type === "coast";
      if (!coastalPair || !convoyIntents.has(`${unit.territory}->${o.target}`)) {
        return voidify(m, "illegal move (non-adjacent, no convoy ordered)");
      }
      return m;
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

// src/lib/maps/standard.ts
var standardMap = {
  id: "standard",
  name: "Standard",
  description: "Classic Diplomacy \u2014 Europe 1901, 7 great powers, 34 supply centers",
  playerCount: 7,
  powers: [
    { id: "england", name: "England", color: "#1e40af" },
    { id: "france", name: "France", color: "#2563eb" },
    { id: "germany", name: "Germany", color: "#6b7280" },
    { id: "italy", name: "Italy", color: "#16a34a" },
    { id: "austria", name: "Austria-Hungary", color: "#dc2626" },
    { id: "russia", name: "Russia", color: "#7c3aed" },
    { id: "turkey", name: "Turkey", color: "#f59e0b" }
  ],
  territories: {
    // ──────────────────────────── ENGLAND ────────────────────────────
    CLY: {
      name: "Clyde",
      type: "coast",
      supplyCenter: false,
      adjacent: ["EDI", "LVP", "NWG", "NAO"],
      render: { center: [133, 201] }
    },
    EDI: {
      name: "Edinburgh",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["CLY", "YOR", "LVP", "NTH", "NWG"],
      render: { center: [152, 202] }
    },
    LVP: {
      name: "Liverpool",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["CLY", "EDI", "YOR", "WAL", "NAO", "IRI"],
      render: { center: [138, 230] }
    },
    YOR: {
      name: "Yorkshire",
      type: "coast",
      supplyCenter: false,
      adjacent: ["EDI", "LVP", "LON", "WAL", "NTH"],
      render: { center: [155, 254] }
    },
    WAL: {
      name: "Wales",
      type: "coast",
      supplyCenter: false,
      adjacent: ["LVP", "YOR", "LON", "ENG", "IRI"],
      render: { center: [130, 275] }
    },
    LON: {
      name: "London",
      type: "coast",
      supplyCenter: true,
      homePower: "england",
      adjacent: ["YOR", "WAL", "NTH", "ENG"],
      render: { center: [160, 280] }
    },
    // ──────────────────────────── FRANCE ────────────────────────────
    BRE: {
      name: "Brest",
      type: "coast",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["PIC", "PAR", "GAS", "ENG", "MAO"],
      render: { center: [130, 345] }
    },
    PIC: {
      name: "Picardy",
      type: "coast",
      supplyCenter: false,
      adjacent: ["BRE", "PAR", "BUR", "BEL", "ENG"],
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
      render: { center: [130, 400] }
    },
    MAR: {
      name: "Marseilles",
      type: "coast",
      supplyCenter: true,
      homePower: "france",
      adjacent: ["GAS", "BUR", "PIE", "SPA", "GOL"],
      render: { center: [173, 412] }
    },
    // ──────────────────────────── GERMANY ────────────────────────────
    KIE: {
      name: "Kiel",
      type: "coast",
      supplyCenter: true,
      homePower: "germany",
      adjacent: ["HOL", "DEN", "BER", "MUN", "RUH", "HEL"],
      render: { center: [237, 285] }
    },
    BER: {
      name: "Berlin",
      type: "coast",
      supplyCenter: true,
      homePower: "germany",
      adjacent: ["KIE", "MUN", "SIL", "PRU", "BAL"],
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
      render: { center: [215, 408] }
    },
    VEN: {
      name: "Venice",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["PIE", "TYR", "TRI", "TUS", "APU", "ADR"],
      render: { center: [245, 407] }
    },
    TUS: {
      name: "Tuscany",
      type: "coast",
      supplyCenter: false,
      adjacent: ["PIE", "VEN", "ROM", "GOL", "TYS"],
      render: { center: [240, 425] }
    },
    ROM: {
      name: "Rome",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["TUS", "NAP", "APU", "TYS", "VEN"],
      render: { center: [257, 452] }
    },
    NAP: {
      name: "Naples",
      type: "coast",
      supplyCenter: true,
      homePower: "italy",
      adjacent: ["ROM", "APU", "TYS", "ION"],
      render: { center: [293, 493] }
    },
    APU: {
      name: "Apulia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["VEN", "ROM", "NAP", "ADR", "ION"],
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
      render: { center: [375, 160] }
    },
    LVN: {
      name: "Livonia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["STP", "MOS", "WAR", "PRU", "BAL", "BOT"],
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
      render: { center: [540, 350] }
    },
    // ──────────────────────────── TURKEY ────────────────────────────
    CON: {
      name: "Constantinople",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["BUL", "BLA", "ANK", "SMY", "AEG"],
      render: { center: [435, 483] }
    },
    ANK: {
      name: "Ankara",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["CON", "BLA", "ARM"],
      render: { center: [510, 455] }
    },
    SMY: {
      name: "Smyrna",
      type: "coast",
      supplyCenter: true,
      homePower: "turkey",
      adjacent: ["CON", "AEG", "EAS", "SYR", "ARM", "ANK"],
      render: { center: [460, 510] }
    },
    ARM: {
      name: "Armenia",
      type: "coast",
      supplyCenter: false,
      adjacent: ["SEV", "BLA", "ANK", "SMY", "SYR"],
      render: { center: [585, 467] }
    },
    SYR: {
      name: "Syria",
      type: "coast",
      supplyCenter: false,
      adjacent: ["SMY", "ARM", "EAS"],
      render: { center: [570, 535] }
    },
    // ──────────────────────────── NEUTRALS ────────────────────────────
    NOR: {
      name: "Norway",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NWG", "NTH", "SKA", "SWE", "FIN", "STP", "BAR"],
      render: { center: [250, 175] }
    },
    SWE: {
      name: "Sweden",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NOR", "FIN", "DEN", "SKA", "BAL", "BOT"],
      render: { center: [300, 170] }
    },
    DEN: {
      name: "Denmark",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NTH", "SKA", "SWE", "KIE", "HEL", "BAL"],
      render: { center: [250, 235] }
    },
    HOL: {
      name: "Holland",
      type: "coast",
      supplyCenter: true,
      adjacent: ["BEL", "RUH", "KIE", "NTH", "HEL"],
      render: { center: [210, 290] }
    },
    BEL: {
      name: "Belgium",
      type: "coast",
      supplyCenter: true,
      adjacent: ["HOL", "RUH", "BUR", "PIC", "ENG", "NTH"],
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
      render: { center: [22, 440] }
    },
    NAF: {
      name: "North Africa",
      type: "coast",
      supplyCenter: false,
      adjacent: ["MAO", "WES", "TUN"],
      render: { center: [130, 536] }
    },
    TUN: {
      name: "Tunis",
      type: "coast",
      supplyCenter: true,
      adjacent: ["NAF", "WES", "TYS", "ION"],
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
      render: { center: [333, 460] }
    },
    GRE: {
      name: "Greece",
      type: "coast",
      supplyCenter: true,
      adjacent: ["SER", "ALB", "BUL", "AEG", "ION"],
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

// src/lib/maps/index.ts
var maps = {
  standard: standardMap
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
  initialBoard
};
