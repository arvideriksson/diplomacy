import { adjudicate, initialBoard } from '../adjudicator'
import type { AnyOrder, BoardState } from '../adjudicator'
import type { MapDefinition } from '../mapDefinition'
import { map1900 } from '../maps/1900'
import { classicalMap } from '../maps/classical'
import type { Frame } from '../sandbox'
import { CoastKind, OrderKind, PhaseKind, PowerKind, SeasonKind, UnitKind } from './wire'

export enum TestPlace {
  Belgium = 'BEL',
  Brest = 'BRE',
  Burgundy = 'BUR',
  EnglishChannel = 'ENG',
  Holland = 'HOL',
  London = 'LON',
  Marseilles = 'MAR',
  Moscow = 'MOS',
  Munich = 'MUN',
  NorthSea = 'NTH',
  Paris = 'PAR',
  Picardy = 'PIC',
  Spain = 'SPA',
  Tyrolia = 'TYR',
}

export enum TestLimit {
  Dictionary = 100,
  LongGame = 60,
  BadCursor = 5,
  TooManyChars = 44001,
  OverflowBytes = 32769,
}

export const GOLDEN_NAME = 'Opening'
export const GOLDEN_PAYLOAD = 'EAVN5RuIT3BlbmluZ1kSc-3agK2UXms'
export const TEST_NAME = 'Shared game'
export const RETREAT_NAME = 'Retreat'
export const CONVOY_NAME = 'Convoy'
export const COAST_NAME = '1900 coast'

export const OPEN_MOVE: AnyOrder = {
  type: OrderKind.Move,
  nation: PowerKind.England,
  source: TestPlace.London,
  target: TestPlace.NorthSea,
}
export const OPEN_HOLD: AnyOrder = {
  type: OrderKind.Hold,
  nation: PowerKind.England,
  source: TestPlace.NorthSea,
}
export const DRAFT_MOVE: AnyOrder = {
  type: OrderKind.Move,
  nation: PowerKind.France,
  source: TestPlace.Paris,
}
export const FORK_MOVE: AnyOrder = {
  type: OrderKind.Move,
  nation: PowerKind.Germany,
  source: TestPlace.Munich,
  target: TestPlace.Tyrolia,
}
export const INVALID_MOVE: AnyOrder = {
  type: OrderKind.Move,
  nation: PowerKind.England,
  source: TestPlace.London,
  target: TestPlace.Moscow,
}
export const DUPLICATE_HOLD: AnyOrder = {
  type: OrderKind.Hold,
  nation: PowerKind.England,
  source: TestPlace.London,
}

const ATTACK_ORDERS: AnyOrder[] = [
  { type: OrderKind.Hold, nation: PowerKind.Germany, source: TestPlace.Belgium },
  { type: OrderKind.Move, nation: PowerKind.France, source: TestPlace.Burgundy, target: TestPlace.Belgium },
  {
    type: OrderKind.Support,
    nation: PowerKind.France,
    source: TestPlace.Picardy,
    aux: TestPlace.Burgundy,
    target: TestPlace.Belgium,
  },
]
const RETREAT_ORDERS: AnyOrder[] = [
  { type: OrderKind.Retreat, nation: PowerKind.Germany, source: TestPlace.Belgium, target: TestPlace.Holland },
]
const CONVOY_ORDERS: AnyOrder[] = [
  {
    type: OrderKind.Move,
    nation: PowerKind.France,
    source: TestPlace.Brest,
    target: TestPlace.Belgium,
    viaConvoy: true,
  },
  {
    type: OrderKind.Convoy,
    nation: PowerKind.France,
    source: TestPlace.EnglishChannel,
    aux: TestPlace.Brest,
    target: TestPlace.Belgium,
  },
]
const BUILD_ORDERS: AnyOrder[] = [
  { type: OrderKind.Build, nation: PowerKind.France, source: TestPlace.Brest, unitType: UnitKind.Fleet },
]

/** Fixture builder resolves exactly the phases given by a test. */
export class FixtureGame {
  private readonly frames: Frame[] = []
  readonly map: MapDefinition
  board: BoardState

  constructor(map: MapDefinition = classicalMap, board: BoardState = initialBoard(map)) {
    this.map = map
    this.board = board
  }

  resolve(orders: AnyOrder[]): void {
    const before = this.board
    const result = adjudicate(this.map, before, orders)
    this.frames.push({ board: before, orders, results: result.results })
    this.board = result.newBoardState
  }

  sandbox(name: string = TEST_NAME) {
    const frames = [...this.frames, { board: this.board, orders: [] }]
    const cursor = this.frames.length
    return { name, mapId: this.map.id, frames, cursor }
  }
}

export function game(map: MapDefinition = classicalMap, rounds: AnyOrder[][] = []) {
  const fixture = new FixtureGame(map)
  for (const orders of rounds) fixture.resolve(orders)
  return fixture.sandbox()
}

export function retreatBoard(): BoardState {
  const opening = initialBoard(classicalMap)
  const units: BoardState['units'] = [
    { nation: PowerKind.Germany, type: UnitKind.Army, territory: TestPlace.Belgium },
    { nation: PowerKind.France, type: UnitKind.Army, territory: TestPlace.Burgundy },
    { nation: PowerKind.France, type: UnitKind.Army, territory: TestPlace.Picardy },
  ]
  const supplyCenters = { BEL: PowerKind.Germany, PAR: PowerKind.France, BRE: PowerKind.France, MAR: PowerKind.France }
  return { ...opening, units, supplyCenters }
}

export function convoyBoard(): BoardState {
  const opening = initialBoard(classicalMap)
  const units: BoardState['units'] = [
    { nation: PowerKind.France, type: UnitKind.Army, territory: TestPlace.Brest },
    { nation: PowerKind.France, type: UnitKind.Fleet, territory: TestPlace.EnglishChannel },
  ]
  const supplyCenters = { BRE: PowerKind.France }
  return { ...opening, units, supplyCenters }
}

export function coastBoard(): BoardState {
  const opening = initialBoard(map1900)
  const units: BoardState['units'] = [
    { nation: PowerKind.France, type: UnitKind.Fleet, territory: TestPlace.Spain, coast: CoastKind.West },
  ]
  const supplyCenters = { BRE: PowerKind.France, PAR: PowerKind.France }
  const year = 1903
  const season = SeasonKind.Fall
  const phase = PhaseKind.Build
  const dislodged: BoardState['dislodged'] = []
  const contested: string[] = []
  return { ...opening, year, season, phase, units, supplyCenters, dislodged, contested }
}

export function retreatGame() {
  const fixture = new FixtureGame(classicalMap, retreatBoard())
  fixture.resolve(ATTACK_ORDERS)
  fixture.resolve(RETREAT_ORDERS)
  const sandbox = fixture.sandbox(RETREAT_NAME)
  sandbox.cursor = 1
  return sandbox
}

export function convoyGame() {
  const fixture = new FixtureGame(classicalMap, convoyBoard())
  fixture.resolve(CONVOY_ORDERS)
  return fixture.sandbox(CONVOY_NAME)
}

export function coastGame() {
  const fixture = new FixtureGame(map1900, coastBoard())
  fixture.resolve(BUILD_ORDERS)
  return fixture.sandbox(COAST_NAME)
}
