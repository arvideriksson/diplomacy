// National-flag roundels for the seven Great Powers. Each asset in
// src/assets/flags/ is a self-contained 64×64 circular badge (clipped + ringed);
// Vite resolves these imports to served URLs.
import austria from '../assets/flags/austria.svg'
import england from '../assets/flags/england.svg'
import france from '../assets/flags/france.svg'
import germany from '../assets/flags/germany.svg'
import italy from '../assets/flags/italy.svg'
import russia from '../assets/flags/russia.svg'
import turkey from '../assets/flags/turkey.svg'

/** Flag-roundel image URL by power id (matches MapDefinition power ids). */
export const flagUrl: Record<string, string> = {
  austria,
  england,
  // The 1900 variant names the same power Britain (the asset is the Union Jack).
  britain: england,
  france,
  germany,
  italy,
  russia,
  turkey,
}
