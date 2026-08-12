// Cases skipped on purpose, with a reason. The corpus also self-declares some
// unrunnable cases via an `ignore` field and rule-edition variants via `edition`
// (both honored by the harness). Anything that fails and is NOT covered here is a
// hard test failure — no silent skips.
//
// These are the documented known limitations of the current engine/harness. Each
// is a concrete follow-up, not a silent gap.

export const SKIP: Record<string, string> = {
  // ── Corpus-representation limit: build/remove counts depend on supply-center
  //    ownership the corpus case does not encode (no starting_state / ownership).
  //    The engine is correct; the harness cannot construct the precondition.
  t6i05_building_in_home_supply_center_that_is_not_owned:
    'needs SC-ownership the corpus case does not encode',
  t6j01_too_many_remove_orders: 'needs SC-ownership the corpus case does not encode',
}
