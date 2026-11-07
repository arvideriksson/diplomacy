import type { MapDefinition } from '../mapDefinition'

export const classicalMap: MapDefinition = {
  id: 'classical',
  name: 'Classical',
  description: 'Classic Diplomacy — Europe 1901, 7 great powers, 34 supply centers',
  playerCount: 7,
  startingYear: 1901,
  victoryCenters: 18, // a majority of the 34
  powers: [
    // OKLCH-balanced palette (hues preserved). Most powers sit at L=0.66; chroma is pushed
    // per-hue toward each one's gamut so reds/blues/purples stay vivid. Turkey is lifted to
    // L=0.80 so its amber reads as gold, not brown (brown = a dark, low-chroma amber).
    { id: 'england', name: 'England',         color: '#4b85fe' }, // L.64 C.190 h263 (royal blue)
    { id: 'france',  name: 'France',           color: '#00bdd5' }, // L.73 C.130 h210 (bright cyan — lighter + hue-shifted off England's blue)
    { id: 'germany', name: 'Germany',          color: '#8c929f' }, // L.66 C.020 (neutral)
    { id: 'italy',   name: 'Italy',            color: '#4aa961' }, // L.66 C.140 h149
    { id: 'austria', name: 'Austria-Hungary',  color: '#f0574e' }, // L.66 C.190 h27
    { id: 'russia',  name: 'Russia',           color: '#9975fa' }, // L.66 C.190 h293
    { id: 'turkey',  name: 'Turkey',           color: '#f5af20' }, // L.80 C.160 h78
  ],

  territories: {
    // ──────────────────────────── ENGLAND ────────────────────────────
    CLY: {
      name: 'Clyde', type: 'coast', supplyCenter: false,
      adjacent: ['EDI', 'LVP', 'NWG', 'NAO'],
      fleetAdjacent: ['EDI', 'LVP', 'NWG', 'NAO'],
    },
    EDI: {
      name: 'Edinburgh', type: 'coast', supplyCenter: true, homePower: 'england',
      adjacent: ['CLY', 'YOR', 'LVP', 'NTH', 'NWG'],
      fleetAdjacent: ['CLY', 'YOR', 'NTH', 'NWG'],
    },
    LVP: {
      name: 'Liverpool', type: 'coast', supplyCenter: true, homePower: 'england',
      adjacent: ['CLY', 'EDI', 'YOR', 'WAL', 'NAO', 'IRI'],
      fleetAdjacent: ['CLY', 'WAL', 'NAO', 'IRI'],
    },
    YOR: {
      name: 'Yorkshire', type: 'coast', supplyCenter: false,
      adjacent: ['EDI', 'LVP', 'LON', 'WAL', 'NTH'],
      fleetAdjacent: ['EDI', 'LON', 'NTH'],
    },
    WAL: {
      name: 'Wales', type: 'coast', supplyCenter: false,
      adjacent: ['LVP', 'YOR', 'LON', 'ENG', 'IRI'],
      fleetAdjacent: ['LVP', 'LON', 'ENG', 'IRI'],
    },
    LON: {
      name: 'London', type: 'coast', supplyCenter: true, homePower: 'england',
      adjacent: ['YOR', 'WAL', 'NTH', 'ENG'],
      fleetAdjacent: ['YOR', 'WAL', 'NTH', 'ENG'],
    },

    // ──────────────────────────── FRANCE ────────────────────────────
    BRE: {
      name: 'Brest', type: 'coast', supplyCenter: true, homePower: 'france',
      adjacent: ['PIC', 'PAR', 'GAS', 'ENG', 'MAO'],
      fleetAdjacent: ['PIC', 'GAS', 'ENG', 'MAO'],
    },
    PIC: {
      name: 'Picardy', type: 'coast', supplyCenter: false,
      adjacent: ['BRE', 'PAR', 'BUR', 'BEL', 'ENG'],
      fleetAdjacent: ['BRE', 'BEL', 'ENG'],
    },
    PAR: {
      name: 'Paris', type: 'land', supplyCenter: true, homePower: 'france',
      adjacent: ['BRE', 'PIC', 'BUR', 'GAS'],
    },
    BUR: {
      name: 'Burgundy', type: 'land', supplyCenter: false,
      adjacent: ['PIC', 'PAR', 'GAS', 'MAR', 'BEL', 'RUH', 'MUN'],
    },
    GAS: {
      name: 'Gascony', type: 'coast', supplyCenter: false,
      adjacent: ['BRE', 'PAR', 'BUR', 'MAR', 'SPA', 'MAO'],
      // Not MAR: Gascony and Marseilles share only a land border, no coastline.
      fleetAdjacent: ['BRE', 'SPA', 'MAO'],
    },
    MAR: {
      name: 'Marseilles', type: 'coast', supplyCenter: true, homePower: 'france',
      adjacent: ['GAS', 'BUR', 'PIE', 'SPA', 'GOL'],
      // Not GAS: land border only.
      fleetAdjacent: ['PIE', 'SPA', 'GOL'],
    },

    // ──────────────────────────── GERMANY ────────────────────────────
    KIE: {
      name: 'Kiel', type: 'coast', supplyCenter: true, homePower: 'germany',
      // BAL belongs here (Kiel is the canal joining HEL and BAL); it was missing,
      // which broke F Kie–Bal and convoys staged out of Kiel via the Baltic.
      adjacent: ['HOL', 'DEN', 'BER', 'MUN', 'RUH', 'HEL', 'BAL'],
      fleetAdjacent: ['HOL', 'DEN', 'BER', 'HEL', 'BAL'],
    },
    BER: {
      name: 'Berlin', type: 'coast', supplyCenter: true, homePower: 'germany',
      adjacent: ['KIE', 'MUN', 'SIL', 'PRU', 'BAL'],
      fleetAdjacent: ['KIE', 'PRU', 'BAL'],
    },
    MUN: {
      name: 'Munich', type: 'land', supplyCenter: true, homePower: 'germany',
      adjacent: ['KIE', 'BER', 'SIL', 'BOH', 'TYR', 'BUR', 'RUH'],
    },
    PRU: {
      name: 'Prussia', type: 'coast', supplyCenter: false,
      adjacent: ['BER', 'SIL', 'WAR', 'LVN', 'BAL'],
      fleetAdjacent: ['BER', 'LVN', 'BAL'],
    },
    RUH: {
      name: 'Ruhr', type: 'land', supplyCenter: false,
      adjacent: ['BEL', 'HOL', 'KIE', 'MUN', 'BUR'],
    },
    SIL: {
      name: 'Silesia', type: 'land', supplyCenter: false,
      adjacent: ['MUN', 'BER', 'PRU', 'WAR', 'GAL', 'BOH'],
    },

    // ──────────────────────────── ITALY ────────────────────────────
    PIE: {
      name: 'Piedmont', type: 'coast', supplyCenter: false,
      adjacent: ['MAR', 'TYR', 'VEN', 'TUS', 'GOL'],
      // Not VEN: Piedmont (Ligurian coast) and Venice (Adriatic) share land only.
      fleetAdjacent: ['MAR', 'TUS', 'GOL'],
    },
    VEN: {
      name: 'Venice', type: 'coast', supplyCenter: true, homePower: 'italy',
      adjacent: ['PIE', 'TYR', 'TRI', 'TUS', 'APU', 'ADR', 'ROM'],
      // Not PIE/TUS/ROM: those border Venice by land only (Venice is Adriatic-side).
      fleetAdjacent: ['TRI', 'APU', 'ADR'],
    },
    TUS: {
      name: 'Tuscany', type: 'coast', supplyCenter: false,
      adjacent: ['PIE', 'VEN', 'ROM', 'GOL', 'TYS'],
      // Not VEN: land border only.
      fleetAdjacent: ['PIE', 'ROM', 'GOL', 'TYS'],
    },
    ROM: {
      name: 'Rome', type: 'coast', supplyCenter: true, homePower: 'italy',
      adjacent: ['TUS', 'NAP', 'APU', 'TYS', 'VEN'],
      // Not APU/VEN: both border Rome by land only (DATC 6.A.9 / 6.A.10).
      fleetAdjacent: ['TUS', 'NAP', 'TYS'],
    },
    NAP: {
      name: 'Naples', type: 'coast', supplyCenter: true, homePower: 'italy',
      adjacent: ['ROM', 'APU', 'TYS', 'ION'],
      fleetAdjacent: ['ROM', 'APU', 'TYS', 'ION'],
    },
    APU: {
      name: 'Apulia', type: 'coast', supplyCenter: false,
      adjacent: ['VEN', 'ROM', 'NAP', 'ADR', 'ION'],
      // Not ROM: land border only (Apulia is Adriatic/Ionian-side).
      fleetAdjacent: ['VEN', 'NAP', 'ADR', 'ION'],
    },

    // ──────────────────────────── AUSTRIA-HUNGARY ────────────────────────────
    BOH: {
      name: 'Bohemia', type: 'land', supplyCenter: false,
      adjacent: ['MUN', 'SIL', 'GAL', 'VIE', 'TYR'],
    },
    TYR: {
      name: 'Tyrolia', type: 'land', supplyCenter: false,
      adjacent: ['MUN', 'BOH', 'VIE', 'TRI', 'VEN', 'PIE'],
    },
    VIE: {
      name: 'Vienna', type: 'land', supplyCenter: true, homePower: 'austria',
      adjacent: ['BOH', 'GAL', 'BUD', 'TRI', 'TYR'],
    },
    TRI: {
      name: 'Trieste', type: 'coast', supplyCenter: true, homePower: 'austria',
      adjacent: ['TYR', 'VIE', 'BUD', 'SER', 'ALB', 'ADR', 'VEN'],
      fleetAdjacent: ['ALB', 'ADR', 'VEN'],
    },
    BUD: {
      name: 'Budapest', type: 'land', supplyCenter: true, homePower: 'austria',
      adjacent: ['VIE', 'GAL', 'RUM', 'SER', 'TRI'],
    },
    GAL: {
      name: 'Galicia', type: 'land', supplyCenter: false,
      adjacent: ['BOH', 'SIL', 'WAR', 'UKR', 'RUM', 'BUD', 'VIE'],
    },

    // ──────────────────────────── RUSSIA ────────────────────────────
    STP: {
      name: 'St. Petersburg', type: 'coast', supplyCenter: true, homePower: 'russia',
      adjacent: ['NOR', 'FIN', 'MOS', 'LVN', 'BAR', 'BOT'],
      coasts: {
        nc: { name: 'North Coast', fleetAdjacency: ['BAR', 'NOR'] },
        sc: { name: 'South Coast', fleetAdjacency: ['BOT', 'LVN', 'FIN'] },
      },
    },
    MOS: {
      name: 'Moscow', type: 'land', supplyCenter: true, homePower: 'russia',
      adjacent: ['STP', 'LVN', 'WAR', 'UKR', 'SEV'],
    },
    FIN: {
      name: 'Finland', type: 'coast', supplyCenter: false,
      adjacent: ['STP', 'NOR', 'SWE', 'BOT'],
      // Not NOR: Finland and Norway share a land border only.
      fleetAdjacent: ['STP', 'SWE', 'BOT'],
    },
    LVN: {
      name: 'Livonia', type: 'coast', supplyCenter: false,
      adjacent: ['STP', 'MOS', 'WAR', 'PRU', 'BAL', 'BOT'],
      fleetAdjacent: ['STP', 'PRU', 'BAL', 'BOT'],
    },
    WAR: {
      name: 'Warsaw', type: 'land', supplyCenter: true, homePower: 'russia',
      adjacent: ['LVN', 'MOS', 'UKR', 'GAL', 'SIL', 'PRU'],
    },
    UKR: {
      name: 'Ukraine', type: 'land', supplyCenter: false,
      adjacent: ['MOS', 'WAR', 'GAL', 'RUM', 'SEV'],
    },
    SEV: {
      name: 'Sevastopol', type: 'coast', supplyCenter: true, homePower: 'russia',
      adjacent: ['MOS', 'UKR', 'RUM', 'ARM', 'BLA'],
      fleetAdjacent: ['RUM', 'ARM', 'BLA'],
    },

    // ──────────────────────────── TURKEY ────────────────────────────
    CON: {
      name: 'Constantinople', type: 'coast', supplyCenter: true, homePower: 'turkey',
      adjacent: ['BUL', 'BLA', 'ANK', 'SMY', 'AEG'],
      // Constantinople is the strait joining the Black Sea (BLA) and the Aegean (AEG).
      fleetAdjacent: ['BUL', 'BLA', 'ANK', 'SMY', 'AEG'],
    },
    ANK: {
      name: 'Ankara', type: 'coast', supplyCenter: true, homePower: 'turkey',
      adjacent: ['CON', 'BLA', 'ARM', 'SMY'],
      // Not SMY: Ankara (Black Sea side) reaches Smyrna by land only.
      fleetAdjacent: ['CON', 'BLA', 'ARM'],
    },
    SMY: {
      name: 'Smyrna', type: 'coast', supplyCenter: true, homePower: 'turkey',
      adjacent: ['CON', 'AEG', 'EAS', 'SYR', 'ARM', 'ANK'],
      // Not ARM/ANK: Smyrna (Aegean side) reaches them by land only.
      fleetAdjacent: ['CON', 'AEG', 'EAS', 'SYR'],
    },
    ARM: {
      name: 'Armenia', type: 'coast', supplyCenter: false,
      adjacent: ['SEV', 'BLA', 'ANK', 'SMY', 'SYR'],
      // Not SMY/SYR: Armenia (Black Sea side) reaches them by land only.
      fleetAdjacent: ['SEV', 'BLA', 'ANK'],
    },
    SYR: {
      name: 'Syria', type: 'coast', supplyCenter: false,
      adjacent: ['SMY', 'ARM', 'EAS'],
      // Not ARM: land border only.
      fleetAdjacent: ['SMY', 'EAS'],
    },

    // ──────────────────────────── NEUTRALS ────────────────────────────
    NOR: {
      name: 'Norway', type: 'coast', supplyCenter: true,
      adjacent: ['NWG', 'NTH', 'SKA', 'SWE', 'FIN', 'STP', 'BAR'],
      // Not FIN: Norway and Finland share a land border only.
      fleetAdjacent: ['NWG', 'NTH', 'SKA', 'SWE', 'STP', 'BAR'],
    },
    SWE: {
      name: 'Sweden', type: 'coast', supplyCenter: true,
      adjacent: ['NOR', 'FIN', 'DEN', 'SKA', 'BAL', 'BOT'],
      fleetAdjacent: ['NOR', 'FIN', 'DEN', 'SKA', 'BAL', 'BOT'],
    },
    DEN: {
      name: 'Denmark', type: 'coast', supplyCenter: true,
      adjacent: ['NTH', 'SKA', 'SWE', 'KIE', 'HEL', 'BAL'],
      fleetAdjacent: ['NTH', 'SKA', 'SWE', 'KIE', 'HEL', 'BAL'],
    },
    HOL: {
      name: 'Holland', type: 'coast', supplyCenter: true,
      adjacent: ['BEL', 'RUH', 'KIE', 'NTH', 'HEL'],
      fleetAdjacent: ['BEL', 'KIE', 'NTH', 'HEL'],
    },
    BEL: {
      name: 'Belgium', type: 'coast', supplyCenter: true,
      adjacent: ['HOL', 'RUH', 'BUR', 'PIC', 'ENG', 'NTH'],
      fleetAdjacent: ['HOL', 'PIC', 'ENG', 'NTH'],
    },
    SPA: {
      name: 'Spain', type: 'coast', supplyCenter: true,
      adjacent: ['POR', 'GAS', 'MAR', 'MAO', 'GOL', 'WES'],
      coasts: {
        nc: { name: 'North Coast', fleetAdjacency: ['POR', 'GAS', 'MAO'] },
        sc: { name: 'South Coast', fleetAdjacency: ['POR', 'MAR', 'GOL', 'WES'] },
      },
    },
    POR: {
      name: 'Portugal', type: 'coast', supplyCenter: true,
      adjacent: ['SPA', 'MAO'],
      fleetAdjacent: ['SPA', 'MAO'],
    },
    NAF: {
      name: 'North Africa', type: 'coast', supplyCenter: false,
      adjacent: ['MAO', 'WES', 'TUN'],
      fleetAdjacent: ['MAO', 'WES', 'TUN'],
    },
    TUN: {
      name: 'Tunis', type: 'coast', supplyCenter: true,
      adjacent: ['NAF', 'WES', 'TYS', 'ION'],
      fleetAdjacent: ['NAF', 'WES', 'TYS', 'ION'],
    },
    SER: {
      name: 'Serbia', type: 'land', supplyCenter: true,
      adjacent: ['BUD', 'TRI', 'ALB', 'GRE', 'BUL', 'RUM'],
    },
    ALB: {
      name: 'Albania', type: 'coast', supplyCenter: false,
      adjacent: ['TRI', 'SER', 'GRE', 'ADR', 'ION'],
      fleetAdjacent: ['TRI', 'GRE', 'ADR', 'ION'],
    },
    GRE: {
      name: 'Greece', type: 'coast', supplyCenter: true,
      adjacent: ['SER', 'ALB', 'BUL', 'AEG', 'ION'],
      fleetAdjacent: ['ALB', 'BUL', 'AEG', 'ION'],
    },
    BUL: {
      name: 'Bulgaria', type: 'coast', supplyCenter: true,
      adjacent: ['SER', 'GRE', 'CON', 'RUM', 'BLA', 'AEG'],
      coasts: {
        ec: { name: 'East Coast', fleetAdjacency: ['BLA', 'CON', 'RUM'] },
        sc: { name: 'South Coast', fleetAdjacency: ['AEG', 'GRE', 'CON'] },
      },
    },
    RUM: {
      name: 'Rumania', type: 'coast', supplyCenter: true,
      adjacent: ['BUD', 'GAL', 'UKR', 'SEV', 'BUL', 'SER', 'BLA'],
      fleetAdjacent: ['SEV', 'BUL', 'BLA'],
    },

    // ──────────────────────────── SEA ZONES ────────────────────────────
    NAO: {
      name: 'North Atlantic Ocean', type: 'sea', supplyCenter: false,
      adjacent: ['NWG', 'CLY', 'LVP', 'IRI', 'MAO'],
    },
    NWG: {
      name: 'Norwegian Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NAO', 'CLY', 'EDI', 'NOR', 'BAR', 'NTH'],
    },
    BAR: {
      name: 'Barents Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NWG', 'NOR', 'STP'],
    },
    NTH: {
      name: 'North Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NWG', 'NOR', 'DEN', 'SKA', 'HOL', 'BEL', 'ENG', 'LON', 'YOR', 'EDI', 'HEL'],
    },
    SKA: {
      name: 'Skagerrak', type: 'sea', supplyCenter: false,
      adjacent: ['NOR', 'SWE', 'DEN', 'NTH'],
    },
    HEL: {
      name: 'Helgoland Bight', type: 'sea', supplyCenter: false,
      adjacent: ['NTH', 'HOL', 'DEN', 'KIE'],
    },
    BAL: {
      name: 'Baltic Sea', type: 'sea', supplyCenter: false,
      adjacent: ['DEN', 'SWE', 'KIE', 'BER', 'PRU', 'LVN', 'BOT'],
    },
    BOT: {
      name: 'Gulf of Bothnia', type: 'sea', supplyCenter: false,
      adjacent: ['SWE', 'FIN', 'STP', 'LVN', 'BAL'],
    },
    ENG: {
      name: 'English Channel', type: 'sea', supplyCenter: false,
      adjacent: ['LON', 'WAL', 'IRI', 'MAO', 'BRE', 'PIC', 'BEL', 'NTH'],
    },
    IRI: {
      name: 'Irish Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NAO', 'LVP', 'WAL', 'ENG', 'MAO'],
    },
    MAO: {
      name: 'Mid-Atlantic Ocean', type: 'sea', supplyCenter: false,
      adjacent: ['NAO', 'IRI', 'ENG', 'BRE', 'GAS', 'SPA', 'POR', 'NAF', 'WES'],
    },
    WES: {
      name: 'Western Mediterranean', type: 'sea', supplyCenter: false,
      adjacent: ['MAO', 'SPA', 'GOL', 'NAF', 'TUN', 'TYS'],
    },
    GOL: {
      name: 'Gulf of Lyon', type: 'sea', supplyCenter: false,
      adjacent: ['SPA', 'MAR', 'PIE', 'TUS', 'WES', 'TYS'],
    },
    TYS: {
      name: 'Tyrrhenian Sea', type: 'sea', supplyCenter: false,
      adjacent: ['GOL', 'TUS', 'ROM', 'NAP', 'WES', 'TUN', 'ION'],
    },
    ION: {
      name: 'Ionian Sea', type: 'sea', supplyCenter: false,
      adjacent: ['TUN', 'TYS', 'NAP', 'APU', 'ADR', 'ALB', 'GRE', 'AEG', 'EAS'],
    },
    ADR: {
      name: 'Adriatic Sea', type: 'sea', supplyCenter: false,
      adjacent: ['VEN', 'TRI', 'ALB', 'APU', 'ION'],
    },
    AEG: {
      name: 'Aegean Sea', type: 'sea', supplyCenter: false,
      adjacent: ['GRE', 'BUL', 'CON', 'SMY', 'EAS', 'ION'],
    },
    EAS: {
      name: 'Eastern Mediterranean', type: 'sea', supplyCenter: false,
      adjacent: ['AEG', 'SMY', 'SYR', 'ION'],
    },
    BLA: {
      name: 'Black Sea', type: 'sea', supplyCenter: false,
      adjacent: ['RUM', 'SEV', 'ARM', 'ANK', 'CON', 'BUL'],
    },
  },

  startingUnits: [
    { type: 'fleet',  power: 'england', territory: 'LON' },
    { type: 'fleet',  power: 'england', territory: 'EDI' },
    { type: 'army',   power: 'england', territory: 'LVP' },

    { type: 'army',   power: 'france',  territory: 'PAR' },
    { type: 'army',   power: 'france',  territory: 'MAR' },
    { type: 'fleet',  power: 'france',  territory: 'BRE' },

    { type: 'army',   power: 'germany', territory: 'MUN' },
    { type: 'army',   power: 'germany', territory: 'BER' },
    { type: 'fleet',  power: 'germany', territory: 'KIE' },

    { type: 'army',   power: 'italy',   territory: 'ROM' },
    { type: 'army',   power: 'italy',   territory: 'VEN' },
    { type: 'fleet',  power: 'italy',   territory: 'NAP' },

    { type: 'army',   power: 'austria', territory: 'VIE' },
    { type: 'army',   power: 'austria', territory: 'BUD' },
    { type: 'fleet',  power: 'austria', territory: 'TRI' },

    { type: 'army',   power: 'russia',  territory: 'MOS' },
    { type: 'army',   power: 'russia',  territory: 'WAR' },
    { type: 'fleet',  power: 'russia',  territory: 'STP', coast: 'sc' },
    { type: 'fleet',  power: 'russia',  territory: 'SEV' },

    { type: 'army',   power: 'turkey',  territory: 'CON' },
    { type: 'army',   power: 'turkey',  territory: 'SMY' },
    { type: 'fleet',  power: 'turkey',  territory: 'ANK' },
  ],
}
