import type { MapDefinition } from '../mapDefinition'

export const classicalMap: MapDefinition = {
  id: 'classical',
  name: 'Classical',
  description: 'Classic Diplomacy — Europe 1901, 7 great powers, 34 supply centers',
  playerCount: 7,
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
      render: { center: [133, 201] },
    },
    EDI: {
      name: 'Edinburgh', type: 'coast', supplyCenter: true, homePower: 'england',
      adjacent: ['CLY', 'YOR', 'LVP', 'NTH', 'NWG'],
      fleetAdjacent: ['CLY', 'YOR', 'NTH', 'NWG'],
      render: { center: [152, 202] },
    },
    LVP: {
      name: 'Liverpool', type: 'coast', supplyCenter: true, homePower: 'england',
      adjacent: ['CLY', 'EDI', 'YOR', 'WAL', 'NAO', 'IRI'],
      fleetAdjacent: ['CLY', 'WAL', 'NAO', 'IRI'],
      render: { center: [138, 230] },
    },
    YOR: {
      name: 'Yorkshire', type: 'coast', supplyCenter: false,
      adjacent: ['EDI', 'LVP', 'LON', 'WAL', 'NTH'],
      fleetAdjacent: ['EDI', 'LON', 'NTH'],
      render: { center: [155, 254] },
    },
    WAL: {
      name: 'Wales', type: 'coast', supplyCenter: false,
      adjacent: ['LVP', 'YOR', 'LON', 'ENG', 'IRI'],
      fleetAdjacent: ['LVP', 'LON', 'ENG', 'IRI'],
      render: { center: [130, 275] },
    },
    LON: {
      name: 'London', type: 'coast', supplyCenter: true, homePower: 'england',
      adjacent: ['YOR', 'WAL', 'NTH', 'ENG'],
      fleetAdjacent: ['YOR', 'WAL', 'NTH', 'ENG'],
      render: { center: [160, 280] },
    },

    // ──────────────────────────── FRANCE ────────────────────────────
    BRE: {
      name: 'Brest', type: 'coast', supplyCenter: true, homePower: 'france',
      adjacent: ['PIC', 'PAR', 'GAS', 'ENG', 'MAO'],
      fleetAdjacent: ['PIC', 'GAS', 'ENG', 'MAO'],
      render: { center: [130, 345] },
    },
    PIC: {
      name: 'Picardy', type: 'coast', supplyCenter: false,
      adjacent: ['BRE', 'PAR', 'BUR', 'BEL', 'ENG'],
      fleetAdjacent: ['BRE', 'BEL', 'ENG'],
      render: { center: [168, 326] },
    },
    PAR: {
      name: 'Paris', type: 'land', supplyCenter: true, homePower: 'france',
      adjacent: ['BRE', 'PIC', 'BUR', 'GAS'],
      render: { center: [155, 358] },
    },
    BUR: {
      name: 'Burgundy', type: 'land', supplyCenter: false,
      adjacent: ['PIC', 'PAR', 'GAS', 'MAR', 'BEL', 'RUH', 'MUN'],
      render: { center: [185, 371] },
    },
    GAS: {
      name: 'Gascony', type: 'coast', supplyCenter: false,
      adjacent: ['BRE', 'PAR', 'BUR', 'MAR', 'SPA', 'MAO'],
      // Not MAR: Gascony and Marseilles share only a land border, no coastline.
      fleetAdjacent: ['BRE', 'SPA', 'MAO'],
      render: { center: [130, 400] },
    },
    MAR: {
      name: 'Marseilles', type: 'coast', supplyCenter: true, homePower: 'france',
      adjacent: ['GAS', 'BUR', 'PIE', 'SPA', 'GOL'],
      // Not GAS: land border only.
      fleetAdjacent: ['PIE', 'SPA', 'GOL'],
      render: { center: [173, 412] },
    },

    // ──────────────────────────── GERMANY ────────────────────────────
    KIE: {
      name: 'Kiel', type: 'coast', supplyCenter: true, homePower: 'germany',
      // BAL belongs here (Kiel is the canal joining HEL and BAL); it was missing,
      // which broke F Kie–Bal and convoys staged out of Kiel via the Baltic.
      adjacent: ['HOL', 'DEN', 'BER', 'MUN', 'RUH', 'HEL', 'BAL'],
      fleetAdjacent: ['HOL', 'DEN', 'BER', 'HEL', 'BAL'],
      render: { center: [237, 285] },
    },
    BER: {
      name: 'Berlin', type: 'coast', supplyCenter: true, homePower: 'germany',
      adjacent: ['KIE', 'MUN', 'SIL', 'PRU', 'BAL'],
      fleetAdjacent: ['KIE', 'PRU', 'BAL'],
      render: { center: [272, 292] },
    },
    MUN: {
      name: 'Munich', type: 'land', supplyCenter: true, homePower: 'germany',
      adjacent: ['KIE', 'BER', 'SIL', 'BOH', 'TYR', 'BUR', 'RUH'],
      render: { center: [235, 360] },
    },
    PRU: {
      name: 'Prussia', type: 'coast', supplyCenter: false,
      adjacent: ['BER', 'SIL', 'WAR', 'LVN', 'BAL'],
      fleetAdjacent: ['BER', 'LVN', 'BAL'],
      render: { center: [335, 283] },
    },
    RUH: {
      name: 'Ruhr', type: 'land', supplyCenter: false,
      adjacent: ['BEL', 'HOL', 'KIE', 'MUN', 'BUR'],
      render: { center: [215, 330] },
    },
    SIL: {
      name: 'Silesia', type: 'land', supplyCenter: false,
      adjacent: ['MUN', 'BER', 'PRU', 'WAR', 'GAL', 'BOH'],
      render: { center: [304, 325] },
    },

    // ──────────────────────────── ITALY ────────────────────────────
    PIE: {
      name: 'Piedmont', type: 'coast', supplyCenter: false,
      adjacent: ['MAR', 'TYR', 'VEN', 'TUS', 'GOL'],
      // Not VEN: Piedmont (Ligurian coast) and Venice (Adriatic) share land only.
      fleetAdjacent: ['MAR', 'TUS', 'GOL'],
      render: { center: [215, 408] },
    },
    VEN: {
      name: 'Venice', type: 'coast', supplyCenter: true, homePower: 'italy',
      adjacent: ['PIE', 'TYR', 'TRI', 'TUS', 'APU', 'ADR', 'ROM'],
      // Not PIE/TUS/ROM: those border Venice by land only (Venice is Adriatic-side).
      fleetAdjacent: ['TRI', 'APU', 'ADR'],
      render: { center: [245, 407] },
    },
    TUS: {
      name: 'Tuscany', type: 'coast', supplyCenter: false,
      adjacent: ['PIE', 'VEN', 'ROM', 'GOL', 'TYS'],
      // Not VEN: land border only.
      fleetAdjacent: ['PIE', 'ROM', 'GOL', 'TYS'],
      render: { center: [240, 425] },
    },
    ROM: {
      name: 'Rome', type: 'coast', supplyCenter: true, homePower: 'italy',
      adjacent: ['TUS', 'NAP', 'APU', 'TYS', 'VEN'],
      // Not APU/VEN: both border Rome by land only (DATC 6.A.9 / 6.A.10).
      fleetAdjacent: ['TUS', 'NAP', 'TYS'],
      render: { center: [257, 452] },
    },
    NAP: {
      name: 'Naples', type: 'coast', supplyCenter: true, homePower: 'italy',
      adjacent: ['ROM', 'APU', 'TYS', 'ION'],
      fleetAdjacent: ['ROM', 'APU', 'TYS', 'ION'],
      render: { center: [293, 493] },
    },
    APU: {
      name: 'Apulia', type: 'coast', supplyCenter: false,
      adjacent: ['VEN', 'ROM', 'NAP', 'ADR', 'ION'],
      // Not ROM: land border only (Apulia is Adriatic/Ionian-side).
      fleetAdjacent: ['VEN', 'NAP', 'ADR', 'ION'],
      render: { center: [291, 470] },
    },

    // ──────────────────────────── AUSTRIA-HUNGARY ────────────────────────────
    BOH: {
      name: 'Bohemia', type: 'land', supplyCenter: false,
      adjacent: ['MUN', 'SIL', 'GAL', 'VIE', 'TYR'],
      render: { center: [283, 347] },
    },
    TYR: {
      name: 'Tyrolia', type: 'land', supplyCenter: false,
      adjacent: ['MUN', 'BOH', 'VIE', 'TRI', 'VEN', 'PIE'],
      render: { center: [255, 380] },
    },
    VIE: {
      name: 'Vienna', type: 'land', supplyCenter: true, homePower: 'austria',
      adjacent: ['BOH', 'GAL', 'BUD', 'TRI', 'TYR'],
      render: { center: [307, 370] },
    },
    TRI: {
      name: 'Trieste', type: 'coast', supplyCenter: true, homePower: 'austria',
      adjacent: ['TYR', 'VIE', 'BUD', 'SER', 'ALB', 'ADR', 'VEN'],
      fleetAdjacent: ['ALB', 'ADR', 'VEN'],
      render: { center: [305, 425] },
    },
    BUD: {
      name: 'Budapest', type: 'land', supplyCenter: true, homePower: 'austria',
      adjacent: ['VIE', 'GAL', 'RUM', 'SER', 'TRI'],
      render: { center: [350, 390] },
    },
    GAL: {
      name: 'Galicia', type: 'land', supplyCenter: false,
      adjacent: ['BOH', 'SIL', 'WAR', 'UKR', 'RUM', 'BUD', 'VIE'],
      render: { center: [355, 343] },
    },

    // ──────────────────────────── RUSSIA ────────────────────────────
    STP: {
      name: 'St. Petersburg', type: 'coast', supplyCenter: true, homePower: 'russia',
      adjacent: ['NOR', 'FIN', 'MOS', 'LVN', 'BAR', 'BOT'],
      coasts: {
        nc: { name: 'North Coast', fleetAdjacency: ['BAR', 'NOR'], render: { center: [466, 128] } },
        sc: { name: 'South Coast', fleetAdjacency: ['BOT', 'LVN', 'FIN'], render: { center: [416, 201] } },
      },
      render: { center: [460, 149] },
    },
    MOS: {
      name: 'Moscow', type: 'land', supplyCenter: true, homePower: 'russia',
      adjacent: ['STP', 'LVN', 'WAR', 'UKR', 'SEV'],
      render: { center: [460, 265] },
    },
    FIN: {
      name: 'Finland', type: 'coast', supplyCenter: false,
      adjacent: ['STP', 'NOR', 'SWE', 'BOT'],
      // Not NOR: Finland and Norway share a land border only.
      fleetAdjacent: ['STP', 'SWE', 'BOT'],
      render: { center: [375, 160] },
    },
    LVN: {
      name: 'Livonia', type: 'coast', supplyCenter: false,
      adjacent: ['STP', 'MOS', 'WAR', 'PRU', 'BAL', 'BOT'],
      fleetAdjacent: ['STP', 'PRU', 'BAL', 'BOT'],
      render: { center: [380, 260] },
    },
    WAR: {
      name: 'Warsaw', type: 'land', supplyCenter: true, homePower: 'russia',
      adjacent: ['LVN', 'MOS', 'UKR', 'GAL', 'SIL', 'PRU'],
      render: { center: [355, 304] },
    },
    UKR: {
      name: 'Ukraine', type: 'land', supplyCenter: false,
      adjacent: ['MOS', 'WAR', 'GAL', 'RUM', 'SEV'],
      render: { center: [420, 340] },
    },
    SEV: {
      name: 'Sevastopol', type: 'coast', supplyCenter: true, homePower: 'russia',
      adjacent: ['MOS', 'UKR', 'RUM', 'ARM', 'BLA'],
      fleetAdjacent: ['RUM', 'ARM', 'BLA'],
      render: { center: [540, 350] },
    },

    // ──────────────────────────── TURKEY ────────────────────────────
    CON: {
      name: 'Constantinople', type: 'coast', supplyCenter: true, homePower: 'turkey',
      adjacent: ['BUL', 'BLA', 'ANK', 'SMY', 'AEG'],
      // Constantinople is the strait joining the Black Sea (BLA) and the Aegean (AEG).
      fleetAdjacent: ['BUL', 'BLA', 'ANK', 'SMY', 'AEG'],
      render: { center: [435, 483] },
    },
    ANK: {
      name: 'Ankara', type: 'coast', supplyCenter: true, homePower: 'turkey',
      adjacent: ['CON', 'BLA', 'ARM', 'SMY'],
      // Not SMY: Ankara (Black Sea side) reaches Smyrna by land only.
      fleetAdjacent: ['CON', 'BLA', 'ARM'],
      render: { center: [510, 455] },
    },
    SMY: {
      name: 'Smyrna', type: 'coast', supplyCenter: true, homePower: 'turkey',
      adjacent: ['CON', 'AEG', 'EAS', 'SYR', 'ARM', 'ANK'],
      // Not ARM/ANK: Smyrna (Aegean side) reaches them by land only.
      fleetAdjacent: ['CON', 'AEG', 'EAS', 'SYR'],
      render: { center: [460, 510] },
    },
    ARM: {
      name: 'Armenia', type: 'coast', supplyCenter: false,
      adjacent: ['SEV', 'BLA', 'ANK', 'SMY', 'SYR'],
      // Not SMY/SYR: Armenia (Black Sea side) reaches them by land only.
      fleetAdjacent: ['SEV', 'BLA', 'ANK'],
      render: { center: [585, 467] },
    },
    SYR: {
      name: 'Syria', type: 'coast', supplyCenter: false,
      adjacent: ['SMY', 'ARM', 'EAS'],
      // Not ARM: land border only.
      fleetAdjacent: ['SMY', 'EAS'],
      render: { center: [570, 535] },
    },

    // ──────────────────────────── NEUTRALS ────────────────────────────
    NOR: {
      name: 'Norway', type: 'coast', supplyCenter: true,
      adjacent: ['NWG', 'NTH', 'SKA', 'SWE', 'FIN', 'STP', 'BAR'],
      // Not FIN: Norway and Finland share a land border only.
      fleetAdjacent: ['NWG', 'NTH', 'SKA', 'SWE', 'STP', 'BAR'],
      render: { center: [250, 175] },
    },
    SWE: {
      name: 'Sweden', type: 'coast', supplyCenter: true,
      adjacent: ['NOR', 'FIN', 'DEN', 'SKA', 'BAL', 'BOT'],
      fleetAdjacent: ['NOR', 'FIN', 'DEN', 'SKA', 'BAL', 'BOT'],
      render: { center: [300, 170] },
    },
    DEN: {
      name: 'Denmark', type: 'coast', supplyCenter: true,
      adjacent: ['NTH', 'SKA', 'SWE', 'KIE', 'HEL', 'BAL'],
      fleetAdjacent: ['NTH', 'SKA', 'SWE', 'KIE', 'HEL', 'BAL'],
      render: { center: [250, 235] },
    },
    HOL: {
      name: 'Holland', type: 'coast', supplyCenter: true,
      adjacent: ['BEL', 'RUH', 'KIE', 'NTH', 'HEL'],
      fleetAdjacent: ['BEL', 'KIE', 'NTH', 'HEL'],
      render: { center: [210, 290] },
    },
    BEL: {
      name: 'Belgium', type: 'coast', supplyCenter: true,
      adjacent: ['HOL', 'RUH', 'BUR', 'PIC', 'ENG', 'NTH'],
      fleetAdjacent: ['HOL', 'PIC', 'ENG', 'NTH'],
      render: { center: [192, 321] },
    },
    SPA: {
      name: 'Spain', type: 'coast', supplyCenter: true,
      adjacent: ['POR', 'GAS', 'MAR', 'MAO', 'GOL', 'WES'],
      coasts: {
        nc: { name: 'North Coast', fleetAdjacency: ['POR', 'GAS', 'MAO'], render: { center: [78, 406] } },
        sc: { name: 'South Coast', fleetAdjacency: ['POR', 'MAR', 'GOL', 'WES'], render: { center: [98, 468] } },
      },
      render: { center: [85, 450] },
    },
    POR: {
      name: 'Portugal', type: 'coast', supplyCenter: true,
      adjacent: ['SPA', 'MAO'],
      fleetAdjacent: ['SPA', 'MAO'],
      render: { center: [22, 440] },
    },
    NAF: {
      name: 'North Africa', type: 'coast', supplyCenter: false,
      adjacent: ['MAO', 'WES', 'TUN'],
      fleetAdjacent: ['MAO', 'WES', 'TUN'],
      render: { center: [130, 536] },
    },
    TUN: {
      name: 'Tunis', type: 'coast', supplyCenter: true,
      adjacent: ['NAF', 'WES', 'TYS', 'ION'],
      fleetAdjacent: ['NAF', 'WES', 'TYS', 'ION'],
      render: { center: [210, 555] },
    },
    SER: {
      name: 'Serbia', type: 'land', supplyCenter: true,
      adjacent: ['BUD', 'TRI', 'ALB', 'GRE', 'BUL', 'RUM'],
      render: { center: [350, 450] },
    },
    ALB: {
      name: 'Albania', type: 'coast', supplyCenter: false,
      adjacent: ['TRI', 'SER', 'GRE', 'ADR', 'ION'],
      fleetAdjacent: ['TRI', 'GRE', 'ADR', 'ION'],
      render: { center: [333, 460] },
    },
    GRE: {
      name: 'Greece', type: 'coast', supplyCenter: true,
      adjacent: ['SER', 'ALB', 'BUL', 'AEG', 'ION'],
      fleetAdjacent: ['ALB', 'BUL', 'AEG', 'ION'],
      render: { center: [352, 490] },
    },
    BUL: {
      name: 'Bulgaria', type: 'coast', supplyCenter: true,
      adjacent: ['SER', 'GRE', 'CON', 'RUM', 'BLA', 'AEG'],
      coasts: {
        ec: { name: 'East Coast', fleetAdjacency: ['BLA', 'CON', 'RUM'], render: { center: [415, 433] } },
        sc: { name: 'South Coast', fleetAdjacency: ['AEG', 'GRE', 'CON'], render: { center: [402, 459] } },
      },
      render: { center: [395, 443] },
    },
    RUM: {
      name: 'Rumania', type: 'coast', supplyCenter: true,
      adjacent: ['BUD', 'GAL', 'UKR', 'SEV', 'BUL', 'SER', 'BLA'],
      fleetAdjacent: ['SEV', 'BUL', 'BLA'],
      render: { center: [410, 415] },
    },

    // ──────────────────────────── SEA ZONES ────────────────────────────
    NAO: {
      name: 'North Atlantic Ocean', type: 'sea', supplyCenter: false,
      adjacent: ['NWG', 'CLY', 'LVP', 'IRI', 'MAO'],
      render: { center: [65, 120] },
    },
    NWG: {
      name: 'Norwegian Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NAO', 'CLY', 'EDI', 'NOR', 'BAR', 'NTH'],
      render: { center: [220, 70] },
    },
    BAR: {
      name: 'Barents Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NWG', 'NOR', 'STP'],
      render: { center: [440, 15] },
    },
    NTH: {
      name: 'North Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NWG', 'NOR', 'DEN', 'SKA', 'HOL', 'BEL', 'ENG', 'LON', 'YOR', 'EDI', 'HEL'],
      render: { center: [190, 230] },
    },
    SKA: {
      name: 'Skagerrak', type: 'sea', supplyCenter: false,
      adjacent: ['NOR', 'SWE', 'DEN', 'NTH'],
      render: { center: [255, 220] },
    },
    HEL: {
      name: 'Helgoland Bight', type: 'sea', supplyCenter: false,
      adjacent: ['NTH', 'HOL', 'DEN', 'KIE'],
      render: { center: [220, 265] },
    },
    BAL: {
      name: 'Baltic Sea', type: 'sea', supplyCenter: false,
      adjacent: ['DEN', 'SWE', 'KIE', 'BER', 'PRU', 'LVN', 'BOT'],
      render: { center: [308, 260] },
    },
    BOT: {
      name: 'Gulf of Bothnia', type: 'sea', supplyCenter: false,
      adjacent: ['SWE', 'FIN', 'STP', 'LVN', 'BAL'],
      render: { center: [328, 175] },
    },
    ENG: {
      name: 'English Channel', type: 'sea', supplyCenter: false,
      adjacent: ['LON', 'WAL', 'IRI', 'MAO', 'BRE', 'PIC', 'BEL', 'NTH'],
      render: { center: [135, 306] },
    },
    IRI: {
      name: 'Irish Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NAO', 'LVP', 'WAL', 'ENG', 'MAO'],
      render: { center: [95, 270] },
    },
    MAO: {
      name: 'Mid-Atlantic Ocean', type: 'sea', supplyCenter: false,
      adjacent: ['NAO', 'IRI', 'ENG', 'BRE', 'GAS', 'SPA', 'POR', 'NAF', 'WES'],
      render: { center: [50, 355] },
    },
    WES: {
      name: 'Western Mediterranean', type: 'sea', supplyCenter: false,
      adjacent: ['MAO', 'SPA', 'GOL', 'NAF', 'TUN', 'TYS'],
      render: { center: [160, 491] },
    },
    GOL: {
      name: 'Gulf of Lyon', type: 'sea', supplyCenter: false,
      adjacent: ['SPA', 'MAR', 'PIE', 'TUS', 'WES', 'TYS'],
      render: { center: [170, 457] },
    },
    TYS: {
      name: 'Tyrrhenian Sea', type: 'sea', supplyCenter: false,
      adjacent: ['GOL', 'TUS', 'ROM', 'NAP', 'WES', 'TUN', 'ION'],
      render: { center: [245, 495] },
    },
    ION: {
      name: 'Ionian Sea', type: 'sea', supplyCenter: false,
      adjacent: ['TUN', 'TYS', 'NAP', 'APU', 'ADR', 'ALB', 'GRE', 'AEG', 'EAS'],
      render: { center: [315, 520] },
    },
    ADR: {
      name: 'Adriatic Sea', type: 'sea', supplyCenter: false,
      adjacent: ['VEN', 'TRI', 'ALB', 'APU', 'ION'],
      render: { center: [308, 460] },
    },
    AEG: {
      name: 'Aegean Sea', type: 'sea', supplyCenter: false,
      adjacent: ['GRE', 'BUL', 'CON', 'SMY', 'EAS', 'ION'],
      render: { center: [392, 510] },
    },
    EAS: {
      name: 'Eastern Mediterranean', type: 'sea', supplyCenter: false,
      adjacent: ['AEG', 'SMY', 'SYR', 'ION'],
      render: { center: [455, 550] },
    },
    BLA: {
      name: 'Black Sea', type: 'sea', supplyCenter: false,
      adjacent: ['RUM', 'SEV', 'ARM', 'ANK', 'CON', 'BUL'],
      render: { center: [500, 418] },
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
