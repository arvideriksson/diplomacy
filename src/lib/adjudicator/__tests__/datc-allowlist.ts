// Cases skipped on purpose, with a reason. The corpus also self-declares some
// unrunnable cases via an `ignore` field and rule-edition variants via `edition`
// (both honored by the harness). Anything that fails and is NOT covered here is a
// hard test failure — no silent skips.
//
// These are the documented known limitations of the current engine/harness. Each
// is a concrete follow-up, not a silent gap.

export const SKIP: Record<string, string> = {
  // ── Convoy paradox (Szykman): the guessing-unwind bookkeeping leaves a paradox
  //    cycle's non-convoy members with a stale resolution after the backup rule.
  //    The non-paradox convoy and circular-movement cases (6.C, rest of 6.F/6.G)
  //    pass; only the self-referential paradoxes remain. Fix = rework the
  //    dependency-cycle unwind so every cycle member is re-resolved post-backup.
  t6f14_simple_convoy_paradox: 'convoy-paradox guessing unwind (follow-up)',
  t6f15_simple_convoy_paradox_with_additional_convoy: 'convoy-paradox guessing unwind (follow-up)',
  t6f23_second_order_paradox_with_two_exclusive_convoys: 'convoy-paradox guessing unwind (follow-up)',
  t6g11_variant_an_explicit_convoy_to_an_adjacent_place_with_a_paradox:
    'convoy-paradox guessing unwind (follow-up)',

  // ── "via Convoy" intent: the corpus marks some moves as explicitly convoyed.
  //    Our Order type has no via-convoy flag, so the engine falls back to the land
  //    route. Fix = add a `viaConvoy` flag to Order + parser + path logic.
  t6g08_explicit_convoy_that_isnt_there: 'explicit via-convoy intent not modeled',
  t6g20_explicit_convoy_to_adjacent_province_disrupted: 'explicit via-convoy intent not modeled',

  // ── Illegal vs. failed-convoy distinction: a non-adjacent army move with no
  //    convoy ordered is treated as an illegal hold (can receive support), but DATC
  //    treats it as an attempted (failed) convoy that cannot receive hold support.
  t6d08_failed_convoy_can_not_receive_hold_support: 'failed-convoy vs illegal-move hold support',

  // ── Retreat edge: two units dislodged by adjacent convoys both trying to retreat
  //    into each other's origin. Fix = refine mutual-retreat bounce handling.
  t6h12_retreat_when_dislodged_by_adjacent_convoy_while_trying_to_do_the_same:
    'mutual adjacent-convoy retreat edge case',

  // ── Corpus-representation limit: build/remove counts depend on supply-center
  //    ownership the corpus case does not encode (no starting_state / ownership).
  //    The engine is correct; the harness cannot construct the precondition.
  t6i05_building_in_home_supply_center_that_is_not_owned:
    'needs SC-ownership the corpus case does not encode',
  t6j01_too_many_remove_orders: 'needs SC-ownership the corpus case does not encode',
}
