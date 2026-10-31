import { describe, expect, it } from 'vitest'
import { classicalMap } from '../maps/classical'
import type { Unit } from '../types'
import type { AnyOrder, Order } from './types'
import { adjudicate, initialBoard, replayLog } from '../adjudicator'
import {
  applyChoice,
  buildMapInputs,
  buildPrompt,
  choiceNotes,
  commitMove,
  openBuildSpots,
  openRemovals,
  retreatChoices,
  orderFailed,
  toRenderOrders,
  unorderedUnitIds,
  withImplicitHolds,
  type NationSituation,
} from './board'
import { nextStep, type Draft } from './wizard'
import { supportAux } from './options'

const army = (nation: string, territory: string): Unit => ({ type: 'army', nation, territory })
const fleet = (nation: string, territory: string): Unit => ({ type: 'fleet', nation, territory })

describe('choiceNotes', () => {
  it('groups annotated destinations by note, capitalised', () => {
    expect(
      choiceNotes([
        { label: 'Picardy' },
        { label: 'Norway (via convoy)' },
        { label: 'Sweden (via convoy)' },
        { label: 'Syria (long route, half strength)' },
      ]),
    ).toEqual([
      ['Via convoy', 'Norway, Sweden'],
      ['Long route, half strength', 'Syria'],
    ])
  })
  it('is empty when nothing is annotated', () => {
    expect(choiceNotes([{ label: 'Picardy' }])).toEqual([])
  })
})

describe('withImplicitHolds', () => {
  const units = [army('france', 'PAR'), fleet('france', 'BRE')]
  const move: Order = { type: 'Move', nation: 'france', source: 'PAR', target: 'BUR' }
  it('holds every un-ordered unit in movement', () => {
    expect(withImplicitHolds([move], 'movement', units)).toEqual([
      move,
      { type: 'Hold', nation: 'france', source: 'BRE', sourceCoast: undefined },
    ])
  })
  it('leaves other phases untouched', () => {
    expect(withImplicitHolds([], 'build', units)).toEqual([])
  })
})

describe('toRenderOrders', () => {
  it('maps retreat and build orders to overlays', () => {
    const orders: AnyOrder[] = [
      { type: 'Retreat', nation: 'france', source: 'PAR', target: 'GAS' },
      { type: 'Disband', nation: 'france', source: 'BRE' },
      { type: 'Build', nation: 'russia', source: 'STP', sourceCoast: 'nc', unitType: 'fleet' },
      { type: 'Remove', nation: 'austria', source: 'VIE' },
    ]
    expect(toRenderOrders(orders)).toEqual([
      { type: 'Move', nation: 'france', source: 'par', target: 'gas', dislodged: true },
      { type: 'Disband', nation: 'france', source: 'bre', dislodged: true },
      { type: 'Build', nation: 'russia', source: 'stp/nc', unitType: 'Fleet' },
      { type: 'Disband', nation: 'austria', source: 'vie' },
    ])
  })
  it('crosses out the orders a history frame says failed', () => {
    // Spring 1901: Paris and Munich both move to Burgundy and bounce; Marseilles holds.
    const orders: AnyOrder[] = [
      { type: 'Move', nation: 'france', source: 'PAR', target: 'BUR' },
      { type: 'Move', nation: 'germany', source: 'MUN', target: 'BUR' },
      { type: 'Hold', nation: 'france', source: 'MAR' },
    ]
    const { results } = adjudicate(classicalMap, initialBoard(classicalMap), orders)
    const failed = new Set(results.filter(orderFailed).map((r) => (r.order as Order).source))
    expect(toRenderOrders(orders, (o) => failed.has((o as Order).source))).toEqual([
      { type: 'Move', nation: 'france', source: 'par', target: 'bur', failed: true },
      { type: 'Move', nation: 'germany', source: 'mun', target: 'bur', failed: true },
      { type: 'Hold', nation: 'france', source: 'mar' },
    ])
  })
})

describe('replayLog results', () => {
  it('carries each resolved frame\'s results, not the live one', () => {
    const frames = replayLog(classicalMap, initialBoard(classicalMap), [
      { year: 1901, season: 'Spring', phase: 'movement', nation: 'france', orders: [{ type: 'Move', nation: 'france', source: 'PAR', target: 'BUR' }] },
    ])
    expect(frames[0].results?.find((r) => (r.order as Order).source === 'PAR')?.code).toBe('succeeds')
    expect(frames.at(-1)?.results).toBeUndefined()
  })
})

describe('build phase', () => {
  const situations: NationSituation[] = [
    { nation: 'england', delta: 2, spots: [{ province: 'EDI', types: ['army', 'fleet'] }, { province: 'LVP', types: ['army', 'fleet'] }], removable: [] },
    { nation: 'austria', delta: -1, spots: [], removable: [army('austria', 'VIE'), army('austria', 'BUD')] },
  ]
  it('offers open spots and removals until the quota is met', () => {
    expect(openBuildSpots(situations, []).map((s) => s.province)).toEqual(['EDI', 'LVP'])
    const built: AnyOrder[] = [{ type: 'Build', nation: 'england', source: 'EDI', unitType: 'army' }]
    expect(openBuildSpots(situations, built).map((s) => s.province)).toEqual(['LVP'])
    expect(openRemovals(situations, [])).toEqual([
      { territory: 'VIE', nation: 'austria' },
      { territory: 'BUD', nation: 'austria' },
    ])
    expect(openRemovals(situations, [{ type: 'Remove', nation: 'austria', source: 'VIE' }])).toEqual([])
  })
  it('keeps placed adjustments selectable', () => {
    const placed: AnyOrder[] = [{ type: 'Remove', nation: 'austria', source: 'VIE' }]
    expect(buildMapInputs([{ province: 'EDI' }], [], placed)).toEqual({
      buildIds: ['edi'],
      removeIds: [],
      selectable: ['edi', 'vie'],
    })
  })
  it('prompts by what is owed', () => {
    expect(buildPrompt(situations)).toBe('Select a highlighted home center to build, or a unit to remove.')
    expect(buildPrompt([situations[0]])).toBe('Select a highlighted home center to build (2 available).')
    expect(buildPrompt([situations[1]])).toBe('Select a highlighted unit to remove (1 required).')
    expect(buildPrompt([])).toBe('No adjustments needed this phase.')
  })
})

describe('retreatChoices', () => {
  it('excludes the attacker’s origin, occupied and contested provinces', () => {
    const units = [army('germany', 'PAR'), army('france', 'GAS')]
    const d = { unit: army('france', 'PAR'), attackedFrom: 'BUR' }
    const got = retreatChoices(classicalMap, d, units, ['PIC']).map((c) => c.province)
    expect(got).toContain('BRE')
    expect(got).not.toContain('BUR')
    expect(got).not.toContain('GAS')
    expect(got).not.toContain('PIC')
  })
  it('is empty without a dislodged unit', () => {
    expect(retreatChoices(classicalMap, undefined, [], [])).toEqual([])
  })
})

describe('movement entry', () => {
  it('commits a convoyed move with convoys for the fleets the player may order', () => {
    const units = [army('england', 'LON'), fleet('england', 'NTH'), fleet('france', 'ENG')]
    const prior: AnyOrder[] = [{ type: 'Hold', nation: 'england', source: 'NTH' }]
    const move: Order = { type: 'Move', nation: 'england', source: 'LON', target: 'NWY' }
    expect(commitMove(prior, move, ['NTH', 'ENG'], units, (n) => n === 'england')).toEqual([
      move,
      { type: 'Convoy', nation: 'england', source: 'NTH', aux: 'LON', target: 'NWY' },
    ])
  })
  it('applies a clicked choice to the step’s field', () => {
    const step = {
      kind: 'province' as const,
      field: 'target' as const,
      prompt: '',
      choices: [{ id: 'STP', coast: 'sc', label: 'St. Petersburg (South Coast)' }],
    }
    expect(applyChoice({ source: 'BOT', type: 'Move' }, step, 'stp/sc')).toEqual({
      source: 'BOT',
      type: 'Move',
      target: 'STP',
      targetCoast: 'sc',
    })
    expect(applyChoice({ source: 'BOT', type: 'Move' }, step, 'fin')).toBeNull()
  })
  it('supports a convoyed move by walking its route fleet by fleet', () => {
    const supporter = army('russia', 'STP')
    const units = [army('england', 'LON'), fleet('england', 'NTH'), fleet('england', 'NWG'), fleet('england', 'IRI'), supporter]
    const ctx = { map: classicalMap, unit: supporter, units }
    expect(supportAux(classicalMap, supporter, units)).toContain('LON')
    const ids = (d: Draft) => {
      const step = nextStep(d, ctx)
      return step.kind === 'province' ? step.choices.map((c) => `${c.id}${c.chain ? '*' : ''}`) : []
    }
    // IRI can carry LON, but never into the supporter's reach.
    expect(ids({ source: 'STP', type: 'Support', aux: 'LON' })).toEqual(['NTH*'])
    expect(ids({ source: 'STP', type: 'Support', aux: 'LON', convoyPath: ['NTH'] })).toEqual(['NOR', 'NWG*'])
  })
  it('lists un-ordered units except the one being drafted', () => {
    const units = [army('france', 'PAR'), fleet('france', 'BRE'), army('france', 'MAR')]
    const orders: AnyOrder[] = [{ type: 'Hold', nation: 'france', source: 'MAR' }]
    expect(unorderedUnitIds(units, orders, 'PAR')).toEqual(['bre'])
  })
})
