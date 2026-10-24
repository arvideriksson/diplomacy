// App province ids whose classical dSVG id is not simply the id lowercased. A leaf module
// (no imports) so the 1900 map build (tools/variants/1900/build.mjs) can load it in Node.
export const GAME_TO_DSVG_OVERRIDES: Record<string, string> = {
  MAO: 'mid', // Mid-Atlantic Ocean
  NAO: 'nat', // North Atlantic Ocean
  NWG: 'nrg', // Norwegian Sea
  NOR: 'nwy', // Norway
}
