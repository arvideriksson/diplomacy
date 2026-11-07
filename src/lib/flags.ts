// National-flag roundels for every power on every map. Each asset in
// src/assets/flags/ is a self-contained 64×64 circular badge (clipped + ringed);
// Vite resolves these imports to served URLs.
import austria from '../assets/flags/austria.svg'
import china from '../assets/flags/china.svg'
import england from '../assets/flags/england.svg'
import france from '../assets/flags/france.svg'
import germany from '../assets/flags/germany.svg'
import italy from '../assets/flags/italy.svg'
import japan from '../assets/flags/japan.svg'
import netherlands from '../assets/flags/netherlands.svg'
import russia from '../assets/flags/russia.svg'
import russiaImperial from '../assets/flags/russia-imperial.svg'
import turkey from '../assets/flags/turkey.svg'

/** Flag-roundel image URL by key: the power id, or a power's own `flag` (PowerDefinition). */
export const flagUrl: Record<string, string> = {
  austria,
  england,
  // The 1900 variant names the same power Britain (the asset is the Union Jack).
  britain: england,
  // Era of Empire (1870): the Qing Yellow Dragon, the Hinomaru and the Dutch tricolour.
  china,
  japan,
  netherlands,
  france,
  germany,
  italy,
  russia,
  // Era of Empire's Russia (1870): the official black-yellow-white of 1858–1883.
  'russia-imperial': russiaImperial,
  turkey,
}
