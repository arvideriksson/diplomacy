# Sandbox share format, version 1

The share URL is `/sandbox/s/<payload>`. The payload is unpadded Base64url. Opening a link shows a read-only preview without saving it; the recipient can browse its history and save an independent local sandbox to edit it. If the resulting URL exceeds 8,000 characters, sharing reports that it is too large.

The envelope begins with `0x10` (raw) or `0x11` (raw DEFLATE), followed by the body and a big-endian CRC-32/IEEE of the **uncompressed padded body**. The encoder uses compression only when it saves bytes. The maximum body is 32,768 bytes and the maximum timeline length is 1,024 frames. The decoder checks the envelope, CRC, trailing zero padding, and final-board checksum before storing anything.

The body is packed most-significant-bit first. `U(n)` means Elias gamma of `n + 1`. A string is its UTF-8 byte length as `U`, then its bytes. Province IDs are indexed in sorted map-key order; supply centers have their own sorted dictionary. The province and center indexes use the minimum fixed width for their dictionary. Powers are England (Britain on 1900), France, Italy, Germany, Austria, Turkey, Russia and neutral, in that order, with three bits. A coast is unspecified, north, south, east (two bits); 1900 adds west and uses three bits.

The field definitions in `src/lib/share/fields.ts` compose symmetric codecs for powers, provinces, coasts, and units. They use the map context to select the correct dictionaries and widths.

`@thi.ng/bitstream` handles bit-level input and output. The sandbox adapter retains the format-specific integer coding, bounds checks, and exact-length appends needed when comparing candidate encodings.

Encoding validates the sandbox and derives a timeline with checkpoints, writes its metadata and frames to a shared bitstream, adds the checksum, optionally compresses the result, and converts it to Base64url. Decoding reverses these steps and validates the reconstructed sandbox. The generic order mode preserves drafts, while the compact mode uses board-derived choices; the encoder selects the shorter valid representation. Movement, support, convoy, retreat, and build codecs own their respective fields. A separate convoyed-army codec selects sparse or bitmap encoding.

The body contains:

1. Map bit (Classical / 1900), 32-bit rules identifier, name string, frame count `U`, cursor `U`.
2. Starting board. An opening-template bit represents the unmodified map opening; otherwise encode year `U`, season bit, phase (movement / retreat / build, two bits), units, ownership, dislodged units and contested provinces. Units have power, army/fleet bit, province and fleet coast. Unit lists choose the shorter of a complete list and removals/additions relative to the opening. Ownership chooses opening ownership, changes from opening, or all centers. Dislodged units additionally store an optional attacker province.
3. For each frame: order list, one results-present bit, and, except in the last frame, a transition bit. A zero transition re-adjudicates orders; a one is followed by an explicit next board. Checkpoints preserve edited past orders whose retained future no longer follows from those orders.
4. CRC-32/IEEE of the final board. Its canonical representation uses a full sorted unit list, ownership for every center, sorted contested provinces and zero padding.

Order lists choose the shorter of generic and compact encodings. Generic lists support indexed or explicit source, power and coast, sparse or dense records, optional target and auxiliary provinces, target coast, via-convoy bit and build unit type. Missing orders and explicit Holds remain different. A candidate compact list is decoded and compared to the original before it is selected, so it cannot silently discard drafts, order ordering or optional fields.

Compact movement and retreat lists use the current board's unit roster sorted by province. An all-ordered bit can replace per-unit presence bits. A frame-level convoy list chooses the shorter of a bitmap and gaps between eligible army indexes. Movement action prefixes are `0` Move, `10` Support, `110` Hold, `111` Convoy. Retreat actions are `0` Disband and `1` Retreat. Move targets, support auxiliary/target, convoy auxiliary/target and retreat targets are indexes into sorted, deduplicated candidate lists derived from the map and current board. Fleet destinations with named coasts carry a coast field. A build list indexes complete Build/Remove candidates derived from the board's build situation. Each candidate index uses truncated binary: if there are `n` choices, `k = floor(log2(n))` and `cutoff = 2^(k+1) - n`; indexes below cutoff use `k` bits, and the rest encode `index + cutoff` in `k + 1` bits. A single choice needs no bits.

The rules identifier and the format version identify this implementation's dictionaries and rules. Changes to candidate construction, map definitions or adjudication need compatibility handling: the decoder must either retain the earlier behavior or reject older links rather than silently misinterpret them. The final-board checksum detects replay differences; CRCs are corruption checks, not signatures.

## Detailed field layout

The rules identifier is `0x0a9bca37`. In each list, counts are `U` values. Boolean fields use `0` for false and `1` for true.

```text
Board = opening:1
  if opening=0:
    year:U, season:1 (0 Spring, 1 Fall), phase:2 (0 movement, 1 retreat, 2 build)
    unitList, ownership, dislodgedCount:U, dislodged[], contestedCount:U, contested[]
Unit = power:3, type:1 (0 army, 1 fleet), province, [fleet coast]
Dislodged = unit, attackerPresent:1, [attackerProvince]
UnitList = mode:1
  mode=0: count:U, units[]
  mode=1: removedCount:U, openingUnitIndexes[], addedCount:U, units[]
Ownership = mode:2
  00: opening ownership
  01: count:U, (supplyCenterIndex, power:3)[]
  10: power:3 for each supply center, in dictionary order
```

Opening unit indexes refer to the opening board's province-sorted units; they use `ceil(log2(opening unit count))` bits. A dislodgement caused via convoy can have no attacker province. Owner `111` means neutral. Ownership mode `11` is reserved.

```text
OrderList = mode:1
  mode=0: genericList
  mode=1: compactList
GenericList = layout:1
  layout=0: count:U, (source, action)[]
  layout=1: for each roster unit, present:1, [action]
Source = indexed:1
  indexed=1: rosterIndex:ceil(log2(rosterSize))
  indexed=0: power:3, sourceProvince, sourceCoast
```

The roster is province-sorted current units for movement/build phases and province-sorted dislodged units for retreat phases. Roster width is zero for a single unit. An indexed source inherits nation and coast; an explicit source stores them. In sparse lists, the source precedes the action. A dense list is used only if its ordering matches the roster and all sources can be inferred.

```text
Generic movement action: 00 Hold, 01 Support, 10 Move, 11 Convoy
Generic retreat action:  0 Disband, 1 Retreat
Generic build action:    0 Remove, 1 Build

Hold/Disband/Remove: no more fields
Support/Convoy: auxiliaryPresent:1, [auxiliaryProvince], targetPresent:1, [targetProvince]
Move: targetPresent:1, [targetProvince], targetCoast, viaConvoy:1
Retreat: targetPresent:1, [targetProvince], targetCoast
Build: unitType:2 (00 unspecified, 01 army, 10 fleet)
```

`sourceCoast` and `targetCoast` use the coast codes listed above, even when unspecified in the generic representation. A Move's explicit `viaConvoy` bit is true only when an order requires a convoy route.

```text
Compact movement list:
  convoyMode:1
    0: one flag for each convoy-eligible army in roster order
    1: count:U, gap:U for each flagged eligible army (gap counts skipped indexes)
  allOrdered:1
  for each roster unit: [present:1 if allOrdered=0], [action if present]
Compact retreat list:
  allOrdered:1
  for each dislodged roster unit: [present:1 if allOrdered=0], [action if present]
Compact build list:
  count:U, indexes into sorted complete build/remove candidates
```

For compact movement, convoy eligibility is an army with at least one reachable destination through fleets present on the board. A Move reads its target index from direct `moveTargets`, or `convoyReach` when its convoy flag is set. Support uses `supportAux` then `supportTargets`; Convoy uses `convoyAux` then `convoyTargets`. Retreat uses `retreatTargets` for that dislodged unit. Candidate province lists are sorted, de-duplicated, and indexed using truncated binary. Compact builds sort canonical JSON representations of candidate records; their indexes use the same truncated-binary rule. The versioned candidate lists are implemented by `src/lib/share/order-modes.ts`, `src/lib/share/order-codecs.ts`, and the existing order-option helpers.

## Version 1 map dictionaries

1900: 90 provinces (7 bits), 39 supply centers (6 bits).

Provinces, indexes starting at zero:

```text
ADR AEG ALG ALS ANK APU ARA ARM BAL BAR BEL BER BLA BOH BOS BRE BUD BUL BUR CLY COL CON CYR DAM DEN EAS EDI EGY ENG FIN GAL GAS GBO GIB GLY GRE HEJ HEL ICE ION IRE IRI KIE KON LON LVO LVP MAC MAO MAR MIL MOR MOS MUN NAO NAP NET NOR NTH NWG PAL PAR PIC PIE POR PRU ROM RUM SER SEV SIB SIL SKA SOU SPA STP SWE SWI TRI TRP TUN TYR TYS UKR VEN VIE WAL WAR WES YOR
```

Supply centers, indexes starting at zero:

```text
ALG ANK BEL BER BRE BUD BUL COL CON DAM DEN EDI EGY GRE KIE LON LVP MAR MIL MOR MOS MUN NAP NET NOR PAR POR ROM RUM SER SEV SPA STP SWE SWI TRI TRP VIE WAR
```

classical: 75 provinces (7 bits), 34 supply centers (6 bits).

Provinces, indexes starting at zero:

```text
ADR AEG ALB ANK APU ARM BAL BAR BEL BER BLA BOH BOT BRE BUD BUL BUR CLY CON DEN EAS EDI ENG FIN GAL GAS GOL GRE HEL HOL ION IRI KIE LON LVN LVP MAO MAR MOS MUN NAF NAO NAP NOR NTH NWG PAR PIC PIE POR PRU ROM RUH RUM SER SEV SIL SKA SMY SPA STP SWE SYR TRI TUN TUS TYR TYS UKR VEN VIE WAL WAR WES YOR
```

Supply centers, indexes starting at zero:

```text
ANK BEL BER BRE BUD BUL CON DEN EDI GRE HOL KIE LON LVP MAR MOS MUN NAP NOR PAR POR ROM RUM SER SEV SMY SPA STP SWE TRI TUN VEN VIE WAR
```
