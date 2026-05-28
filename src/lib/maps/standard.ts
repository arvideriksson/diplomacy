import type { MapDefinition } from '../mapDefinition'

export const standardMap: MapDefinition = {
  id: 'standard',
  name: 'Standard',
  description: 'Classic Diplomacy — Europe 1901, 7 great powers, 34 supply centers',
  playerCount: 7,
  viewBox: '0 0 610 560',
  powers: [
    { id: 'england', name: 'England',         color: '#1e40af' },
    { id: 'france',  name: 'France',           color: '#2563eb' },
    { id: 'germany', name: 'Germany',          color: '#6b7280' },
    { id: 'italy',   name: 'Italy',            color: '#16a34a' },
    { id: 'austria', name: 'Austria-Hungary',  color: '#dc2626' },
    { id: 'russia',  name: 'Russia',           color: '#7c3aed' },
    { id: 'turkey',  name: 'Turkey',           color: '#f59e0b' },
  ],

  territories: {
    // ──────────────────────────── ENGLAND ────────────────────────────
    CLY: {
      name: 'Clyde', type: 'coast', supplyCenter: false,
      adjacent: ['EDI', 'LVP', 'NWG', 'NAO'],
      render: { center: [133, 201], path: 'm138 214l-8-6-1-11 10-8 1-7 8-5 14 4-1 4-7 3-2 6-6 6-2 13z' },
    },
    EDI: {
      name: 'Edinburgh', type: 'coast', supplyCenter: true, homePower: 'england',
      adjacent: ['CLY', 'YOR', 'LVP', 'NTH', 'NWG'],
      render: { center: [152, 202], path: 'm152 194l6-1 13 4-1 5-5 8-7 4-7 1 6 1 4 2 2 8-8 2-10-11-1-4 2-13z' },
    },
    LVP: {
      name: 'Liverpool', type: 'coast', supplyCenter: true, homePower: 'england',
      adjacent: ['CLY', 'EDI', 'YOR', 'WAL', 'NAO', 'IRI'],
      render: { center: [138, 230], path: 'm128 262l-2-6-5 1 11-7h3l4-10-3-11-6-2v-4l8-6v-3l6-1 1 4 10 11v11l-4 9-1 16-7-2z' },
    },
    YOR: {
      name: 'Yorkshire', type: 'coast', supplyCenter: false,
      adjacent: ['EDI', 'LVP', 'LON', 'WAL', 'NTH'],
      render: { center: [155, 254], path: 'm163 226v13l5 7 2 6-1 13-3 4-13 2-3-7 1-16 4-9v-11z' },
    },
    WAL: {
      name: 'Wales', type: 'coast', supplyCenter: false,
      adjacent: ['LVP', 'YOR', 'LON', 'ENG', 'IRI'],
      render: { center: [130, 275], path: 'm100 291l12-4 10-6 8 1-3-6-8-4h-3l-1-7 13-3h15l7 2 3 7-3 6-5 4 2 14-13-1-10-3-4 4-10-3z' },
    },
    LON: {
      name: 'London', type: 'coast', supplyCenter: true, homePower: 'england',
      adjacent: ['YOR', 'WAL', 'NTH', 'ENG'],
      render: { center: [160, 280], path: 'm166 269l2 1 3-2 6 2 1 4-2 9-11 10 7 1-4 2-8 2-13-3-2-14 5-4 3-6z' },
    },

    // ──────────────────────────── FRANCE ────────────────────────────
    BRE: {
      name: 'Brest', type: 'coast', supplyCenter: true, homePower: 'france',
      adjacent: ['PIC', 'PAR', 'GAS', 'ENG', 'MAO'],
      render: { center: [130, 345], path: 'm150 319l-6-1-2-6-6-2v16l-12-3-2-5-20-1-2 5 3 6 6 1 14 15-1 6 1 7 5 6 18 2v-28l2-8z' },
    },
    PIC: {
      name: 'Picardy', type: 'coast', supplyCenter: false,
      adjacent: ['BRE', 'PAR', 'BUR', 'BEL', 'ENG'],
      render: { center: [168, 326], path: 'm169 311l-16 4 2 5-5-1-2 10 11 2h6l7-3 16 4 4-9-8-8z' },
    },
    PAR: {
      name: 'Paris', type: 'land', supplyCenter: true, homePower: 'france',
      adjacent: ['BRE', 'PIC', 'BUR', 'GAS'],
      render: { center: [155, 358], path: 'm146 365l3 7 7 2 9-9 20-21 3-12-16-4-7 3h-6l-11-2-2 8z' },
    },
    BUR: {
      name: 'Burgundy', type: 'land', supplyCenter: false,
      adjacent: ['PIC', 'PAR', 'GAS', 'MAR', 'BEL', 'RUH', 'MUN'],
      render: { center: [185, 371], path: 'm192 323l13 8-1 7 7 8 2 6-4 11-1 4-14 15-16-1v9l-5 6-5-1-5-8 2-4-7-3-2-6 9-9 20-21 3-12z' },
    },
    GAS: {
      name: 'Gascony', type: 'coast', supplyCenter: false,
      adjacent: ['BRE', 'PAR', 'BUR', 'MAR', 'SPA', 'MAO'],
      render: { center: [130, 400], path: 'm128 363l-7 19 1 2-10 15 1 8 10 5 11 5 1-3 7 3 7-14 8-6 11-2-5-8 2-4-7-3-2-6-7-2-3-7z' },
    },
    MAR: {
      name: 'Marseilles', type: 'coast', supplyCenter: true, homePower: 'france',
      adjacent: ['GAS', 'BUR', 'PIE', 'SPA', 'GOL'],
      render: { center: [173, 412], path: 'm142 417l7-14 8-6 11-2 5 1 5-6v-9l16 1 3 3 6-6 4 7-3 4 3 6-6 3 3 3-1 8 8 6-13 5-10 1-12-5-7-5-11 6v7l-4 2z' },
    },

    // ──────────────────────────── GERMANY ────────────────────────────
    KIE: {
      name: 'Kiel', type: 'coast', supplyCenter: true, homePower: 'germany',
      adjacent: ['HOL', 'DEN', 'BER', 'MUN', 'RUH', 'HEL'],
      render: { center: [237, 285], path: 'm244 254l-1 3 2 6-1 7v3l-9 4-1-3-4-1-4 2 1 5-2 12-5 6-5-1-2 5 19 6 9 8 2 6 20-12-2-14 3-3-2-6 4-4v-8l-5-1-1-5-4-3v-3l-2-8z' },
    },
    BER: {
      name: 'Berlin', type: 'coast', supplyCenter: true, homePower: 'germany',
      adjacent: ['KIE', 'MUN', 'SIL', 'PRU', 'BAL'],
      render: { center: [272, 292], path: 'm294 275l-8-1 1-7-7-1-14 9v8l-4 4 2 6-3 3 2 14 25-5 8-5 1-4-5-6z' },
    },
    MUN: {
      name: 'Munich', type: 'land', supplyCenter: true, homePower: 'germany',
      adjacent: ['KIE', 'BER', 'SIL', 'BOH', 'TYR', 'BUR', 'RUH'],
      render: { center: [235, 360], path: 'm234 366l9 4 3-1 4 2 17-3 4 2-2-8h6l6-6-5-10-8-3-4-14 2-4 12 1 10-5-4-7 4-9-25 5-20 12h-6l-18 22-8 2 2 6-4 11 13 2 3-3 7 1z' },
    },
    PRU: {
      name: 'Prussia', type: 'coast', supplyCenter: false,
      adjacent: ['BER', 'SIL', 'WAR', 'LVN', 'BAL'],
      render: { center: [335, 283], path: 'm347 243v5l1 6-4 8-7 2-3 9-6 1-2-9-12 1-7 7-13 2-2 15 5 6-1 4 24 3 4-4 2-7 15-5 4 2 14-3 6-5 2-16-5-5-6 1-2-10z' },
    },
    RUH: {
      name: 'Ruhr', type: 'land', supplyCenter: false,
      adjacent: ['BEL', 'HOL', 'KIE', 'MUN', 'BUR'],
      render: { center: [215, 330], path: 'm213 302l-3 11-2 2 2 11-5 5-1 7 7 8 8-2 18-22h6l-2-6-9-8z' },
    },
    SIL: {
      name: 'Silesia', type: 'land', supplyCenter: false,
      adjacent: ['MUN', 'BER', 'PRU', 'WAR', 'GAL', 'BOH'],
      render: { center: [304, 325], path: 'm288 321l9 1 14 12 3-2 7 7 4 1 4-2 4-8-7-3-3-5-3-19-24-3-8 5-4 9z' },
    },

    // ──────────────────────────── ITALY ────────────────────────────
    PIE: {
      name: 'Piedmont', type: 'coast', supplyCenter: false,
      adjacent: ['MAR', 'TYR', 'VEN', 'TUS', 'GOL'],
      render: { center: [215, 408], path: 'm207 386l-3 4 3 6-6 3 3 3-1 8 8 6 11-6 11 5 3-4-3-7 13-12-3-4-14-3-2 5-6-5-8 2z' },
    },
    VEN: {
      name: 'Venice', type: 'coast', supplyCenter: true, homePower: 'italy',
      adjacent: ['PIE', 'TYR', 'TRI', 'TUS', 'APU', 'ADR'],
      render: { center: [245, 407], path: 'm278 443l-6-19-12-7 1-16 9-3 6 1 3-10-3-3-8-1-9 3-4 6-5 3-4-5-13 12 3 7 4 4 6 1 7 2 10 16 11 13z' },
    },
    TUS: {
      name: 'Tuscany', type: 'coast', supplyCenter: false,
      adjacent: ['PIE', 'VEN', 'ROM', 'GOL', 'TYS'],
      render: { center: [240, 425], path: 'm233 415l5 16 9 11 3-4 13-4-10-16-7-2-6-1-4-4z' },
    },
    ROM: {
      name: 'Rome', type: 'coast', supplyCenter: true, homePower: 'italy',
      adjacent: ['TUS', 'NAP', 'APU', 'TYS', 'VEN'],
      render: { center: [257, 452], path: 'm247 442l1 5 8 11 15 6 8-6 1-3-1-4-5-4-11-13-13 4z' },
    },
    NAP: {
      name: 'Naples', type: 'coast', supplyCenter: true, homePower: 'italy',
      adjacent: ['ROM', 'APU', 'TYS', 'ION'],
      render: { center: [293, 493], path: 'm271 464l5 10 14 13 4 15-5 9 1 3 5 1 13-15 3-9-7-7-11-3-14-23z' },
    },
    APU: {
      name: 'Apulia', type: 'coast', supplyCenter: false,
      adjacent: ['VEN', 'ROM', 'NAP', 'ADR', 'ION'],
      render: { center: [291, 470], path: 'm304 484l6-4 8 5h4v-5l-25-24 3-3h-10l-12-10-4 4 5 4 1 4-1 3 14 23z' },
    },

    // ──────────────────────────── AUSTRIA-HUNGARY ────────────────────────────
    BOH: {
      name: 'Bohemia', type: 'land', supplyCenter: false,
      adjacent: ['MUN', 'SIL', 'GAL', 'VIE', 'TYR'],
      render: { center: [283, 347], path: 'm281 356l-5-10-8-3-4-14 2-4 12 1 10-5 9 1 14 12 3-2 7 7 1 8-6 1-13-2-8 3-3 8z' },
    },
    TYR: {
      name: 'Tyrolia', type: 'land', supplyCenter: false,
      adjacent: ['MUN', 'BOH', 'VIE', 'TRI', 'VEN', 'PIE'],
      render: { center: [255, 380], path: 'm234 366l9 4 3-1 4 2 17-3 4 2-2-8h6l6-6 11 1 3 5-1 18-5 5-13 1-8-1-9 3-4 6-5 3-4-5-3-4 2-4-4-6-7-4z' },
    },
    VIE: {
      name: 'Vienna', type: 'land', supplyCenter: true, homePower: 'austria',
      adjacent: ['BOH', 'GAL', 'BUD', 'TRI', 'TYR'],
      render: { center: [307, 370], path: 'm292 357l3-8 8-3 13 2 6-1 7-1 8 4-2 4-13 16-11 5-3 8-9 2-5-5 1-18z' },
    },
    TRI: {
      name: 'Trieste', type: 'coast', supplyCenter: true, homePower: 'austria',
      adjacent: ['TYR', 'VIE', 'BUD', 'SER', 'ALB', 'ADR', 'VEN'],
      render: { center: [305, 425], path: 'm276 399l-1 4 3 7 4-9 4 1 3 16 17 18 25 18-1-9 7 1-7-9-3-8 4-5-1-8 2-6-9-2-2-10-10-4-3-11-9 2-5-5-5 5-13 1 3 3z' },
    },
    BUD: {
      name: 'Budapest', type: 'land', supplyCenter: true, homePower: 'austria',
      adjacent: ['VIE', 'GAL', 'RUM', 'SER', 'TRI'],
      render: { center: [350, 390], path: 'm394 376l1 6 6 3 5 11-5 6h-14l-20 4-2 6-5 1-18-3-4 2-3-2h-3l-9-2-2-10-10-4-3-11 3-8 11-5 13-16 2-4 13-3 10 4 8 2 9 7 1 3 6 2z' },
    },
    GAL: {
      name: 'Galicia', type: 'land', supplyCenter: false,
      adjacent: ['BOH', 'SIL', 'WAR', 'UKR', 'RUM', 'BUD', 'VIE'],
      render: { center: [355, 343], path: 'm333 330h8l3 2 9-5 3-4 5 1 6 5 7-2 5-3 4 3 2 5 14 6 5 16-1 6 1 11-10 5-10-11-6-2-1-3-9-7-8-2-10-4-13 3-8-4-7 1-1-8 1 8-1-8 4 1 4-2z' },
    },

    // ──────────────────────────── RUSSIA ────────────────────────────
    STP: {
      name: 'St. Petersburg', type: 'coast', supplyCenter: true, homePower: 'russia',
      adjacent: ['NOR', 'FIN', 'MOS', 'LVN', 'BAR', 'BOT'],
      coasts: {
        nc: { name: 'North Coast', fleetAdjacency: ['BAR', 'NOR'], render: { center: [530, 40] } },
        sc: { name: 'South Coast', fleetAdjacency: ['BOT', 'LVN', 'FIN'], render: { center: [440, 165] } },
      },
      render: { center: [460, 149], path: 'm534 164l30-5 9-16 25-11 11-15v-117h-69l-5 9-5-3-13 13-1 14-3 5v-15l-6-3-2 6-6 7-7 15 3 10-7 2-9-3-2-2 4-5-8-7-7 2 6 17 6 4v8l-6-2-4 2-11 17 12 9-2 6-5 3-18-8-2 9 5 5 7 4-2 3-18-4-8-15v-9l-12-6-2-5 33 1 12-5 2-13-6-5-36-14-12 2-4-4-4 3-9 13-1 7 6 5-1 19 9 18 1 8 8 12 4 17' },
    },
    MOS: {
      name: 'Moscow', type: 'land', supplyCenter: true, homePower: 'russia',
      adjacent: ['STP', 'LVN', 'WAR', 'UKR', 'SEV'],
      render: { center: [460, 265], path: 'm609 117l-11 15-25 11-9 16-30 5-19 5-26 15-13-1-18 11-2 13 1 3-6 3-4-4-8 2-11 14-7 4-12-1-4 11-1 36-12 3-3 7-10 5 7 19 4-3 66-14 12 3 9-6 17 6 11-15 11 6 10 1 7-4 16 1 5 20 10 1 5 16 28 9h12z' },
    },
    FIN: {
      name: 'Finland', type: 'coast', supplyCenter: false,
      adjacent: ['STP', 'NOR', 'SWE', 'BOT'],
      render: { center: [375, 160], path: 'm362 107l6 1 4 12-6 1-7 15-14 15 2 9 3 5-2 13 1 6 8 2 8 5 19-6 18-8 10-16-2-9 4-5-4-17-8-12-1-8-9-18 1-19-6-5 1-7-2-3 2-4-9-6-9 1-1 12-14 1-9-8-4 7 14 10z' },
    },
    LVN: {
      name: 'Livonia', type: 'coast', supplyCenter: false,
      adjacent: ['STP', 'MOS', 'WAR', 'PRU', 'BAL', 'BOT'],
      render: { center: [380, 260], path: 'm369 202l-4 2 3 6 4 3 1 8 4 6-4 2-7-1-7-8-10 9-2 14 7 8 2 10 6-1 5 5-2 16 7 2 7 7 10-5 3-7 12-3 1-36 4-11-4-11-11-12-12 1-10-1z' },
    },
    WAR: {
      name: 'Warsaw', type: 'land', supplyCenter: true, homePower: 'russia',
      adjacent: ['LVN', 'MOS', 'UKR', 'GAL', 'SIL', 'PRU'],
      render: { center: [355, 304], path: 'm333 330l-7-3-3-5-3-19 4-4 2-7 15-5 4 2 14-3 6-5 7 2 7 7 7 19-3 18-4-3-5 3-7 2-6-5-5-1-3 4-9 5-3-2z' },
    },
    UKR: {
      name: 'Ukraine', type: 'land', supplyCenter: false,
      adjacent: ['MOS', 'WAR', 'GAL', 'RUM', 'SEV'],
      render: { center: [420, 340], path: 'm383 327l2 5 14 6 5 16-1 6 8 1 3 11 9 4 9-4 2-12 11-10 15-5 6-38 4-4-2-8-12-3-66 14-4 3z' },
    },
    SEV: {
      name: 'Sevastopol', type: 'coast', supplyCenter: true, homePower: 'russia',
      adjacent: ['MOS', 'UKR', 'RUM', 'ARM', 'BLA'],
      render: { center: [540, 350], path: 'm438 397l8-19 13-3 2 2-2 2 6 4 11-2 2 2-6 2-4 7 9 4v5l9 3 2-7 6-1 3-4 10-3-1-5-12 3-9-9 18-14 23-13 1 3-13 11 3 6h3l-5 13-4-1-1 3 7 7 11 1 26 12 13 2 6 9-3 10 19 15 5-3 9 2 6-1v-110h-12l-28-9-5-16-10-1-5-20-16-1-7 4-10-1-11-6-11 15-17-6-9 6 2 8-4 4-6 38-15 5-11 10-2 12-9 4-1 6 5 17z' },
    },

    // ──────────────────────────── TURKEY ────────────────────────────
    CON: {
      name: 'Constantinople', type: 'coast', supplyCenter: true, homePower: 'turkey',
      adjacent: ['BUL', 'BLA', 'ANK', 'SMY', 'AEG'],
      render: { center: [435, 483], path: 'm408 470l2 3 4 2-4 7-1 5 8-1v3l6-2 9 6 20 2 14-4 2-12v-18l-4-4-22 3-2-2-10-3-4-5-6 1-8 3 1 10z' },
    },
    ANK: {
      name: 'Ankara', type: 'coast', supplyCenter: true, homePower: 'turkey',
      adjacent: ['CON', 'BLA', 'ARM'],
      render: { center: [510, 455], path: 'm555 438l-4-1-31 4-6-3-3 2-9-7-21 5-11 9-6 10 4 4v18l-2 12h7l17-11 11 2 7-2 23-20 15 2 9-2 2-11z' },
    },
    SMY: {
      name: 'Smyrna', type: 'coast', supplyCenter: true, homePower: 'turkey',
      adjacent: ['CON', 'AEG', 'EAS', 'SYR', 'ARM', 'ANK'],
      render: { center: [460, 510], path: 'm417 489l3 6-3 3v9l6 3 4 14 8-1v7l6-4 6 2 6 6 11-3 2-10 9-1 10 8 6 2 14-4 6-12 9 3 7-9 3 1 6-15 9-8 10-2 8-5-1-8-6-4-1-7-9 2-15-2-23 20-7 2-11-2-17 11h-7l-14 4-20-2-9-6z' },
    },
    ARM: {
      name: 'Armenia', type: 'coast', supplyCenter: false,
      adjacent: ['SEV', 'BLA', 'ANK', 'SMY', 'SYR'],
      render: { center: [585, 467], path: 'm609 493l-25-15-21 1-1-8-6-4-1-7 2-11-2-11 15-11 19 15 5-3 9 2 6-1z' },
    },
    SYR: {
      name: 'Syria', type: 'coast', supplyCenter: false,
      adjacent: ['SMY', 'ARM', 'EAS'],
      render: { center: [570, 535], path: 'm530 509l6-15 9-8 10-2 8-5 21-1 25 15v66h-81l4-24-6-5-1-12z' },
    },

    // ──────────────────────────── NEUTRALS ────────────────────────────
    NOR: {
      name: 'Norway', type: 'coast', supplyCenter: true,
      adjacent: ['NWG', 'NTH', 'SKA', 'SWE', 'FIN', 'STP', 'BAR'],
      render: { center: [250, 175], path: 'm397 48l-6-1 4-6-1-3-10-5-2 7-2-7-3-2-3 7-3-5-5 9v-9h-4l-5 6-14 5-19 10-4 10-10 11-1 9-6 2-11 25-15 21-8 2-5 8-6-1-22 13 1 6-4 7-2 13 2 6-4 6 2 9 10 8 5 1 20-9 4-8 5 10 4 1 8-27-2-7 5-6 2-31 9-1-1-6 9-11-1-11 3-3 13-30 8 3-2-10 11 1 1-4 4-7 9 8 14-1 1-12 9-1 9 6-2 4 2 3z' },
    },
    SWE: {
      name: 'Sweden', type: 'coast', supplyCenter: true,
      adjacent: ['NOR', 'FIN', 'DEN', 'SKA', 'BAL', 'BOT'],
      render: { center: [300, 170], path: 'm275 203l2 15-1 6 6 12-3 4v3l3 10 7 1 5-9 11-1 7-15-1-9 3-11 8-3 6-3 3-10-5-10-6-1 1-21 9-15 13-8 8-10-4-7 2-9 6-8 7 3-6-36-14-10-1 4-11-1 2 10-8-3-13 30-3 3 1 11-9 11 1 6-9 1-2 31-5 6 2 7-8 27z' },
    },
    DEN: {
      name: 'Denmark', type: 'coast', supplyCenter: true,
      adjacent: ['NTH', 'SKA', 'SWE', 'KIE', 'HEL', 'BAL'],
      render: { center: [250, 235], path: 'm279 243l-4-1-6 1-3-3 1-6-1-13-3 2-15 1-3 13-2 10 1 7 10 1h12l5 5 7-6-1-4 3-2z' },
    },
    HOL: {
      name: 'Holland', type: 'coast', supplyCenter: true,
      adjacent: ['BEL', 'RUH', 'KIE', 'NTH', 'HEL'],
      render: { center: [210, 290], path: 'm226 275l1 5-2 12-5 6-5-1-2 5-3 11-2 2-3-4 1-5-12-3-3-4 7-10 7-13v3h2l4-5z' },
    },
    BEL: {
      name: 'Belgium', type: 'coast', supplyCenter: true,
      adjacent: ['HOL', 'RUH', 'BUR', 'PIC', 'ENG', 'NTH'],
      render: { center: [192, 321], path: 'm191 299l3 4 12 3-1 5 3 4 2 11-5 5-13-8-8-8-15-4 4-10z' },
    },
    SPA: {
      name: 'Spain', type: 'coast', supplyCenter: true,
      adjacent: ['POR', 'GAS', 'MAR', 'MAO', 'GOL', 'WES'],
      coasts: {
        nc: { name: 'North Coast', fleetAdjacency: ['POR', 'GAS', 'MAO'], render: { center: [65, 430] } },
        sc: { name: 'South Coast', fleetAdjacency: ['POR', 'MAR', 'GOL', 'WES'], render: { center: [90, 480] } },
      },
      render: { center: [85, 450], path: 'm40 441l-6 6 2 10-9 11 6 7 1 9 3 6 10-2 5 1 8-3 18 5 5 3 3-9 4-2 8 1 9-10 6-1 2-4-5-8 14-17 7-5 15-1 11-6 1-7-4 2-12-10-7-3-1 3-11-5' },
    },
    POR: {
      name: 'Portugal', type: 'coast', supplyCenter: true,
      adjacent: ['SPA', 'MAO'],
      render: { center: [22, 440], path: 'm32 396l-2 10-13 21h-3l-4 6 3 7 2 1-3 9 1 4-5 8 11 7 8-1 9-11-2-10 6-6-3-10 5 1 10-20 9-1 1-4-7-7-13-1 1-4z' },
    },
    NAF: {
      name: 'North Africa', type: 'coast', supplyCenter: false,
      adjacent: ['MAO', 'WES', 'TUN'],
      render: { center: [130, 536], path: 'm203 520l-24-5-10 3-19-7-33-2-11 2-7 4-10-3-5 6-5 2-11-4v-5l-4 3-18-5-4-7-1-8-4 1-4 1-16 22-17 2v39h195l2-32z' },
    },
    TUN: {
      name: 'Tunis', type: 'coast', supplyCenter: true,
      adjacent: ['NAF', 'WES', 'TYS', 'ION'],
      render: { center: [210, 555], path: 'm232 559l2-8-2-7-7-9 6-4 5-7-3-1-9 4-1-9-5-2-6 1-4 4-5-1-6 7-2 32z' },
    },
    SER: {
      name: 'Serbia', type: 'land', supplyCenter: true,
      adjacent: ['BUD', 'TRI', 'ALB', 'GRE', 'BUL', 'RUM'],
      render: { center: [350, 450], path: 'm365 412l-5 1-18-3-4 2-3-2h-3l-2 6 1 8-4 5 3 8 7 9 9 6v14l4 5h6l5-4 8-3-4-3 6-5-5-17 5-1-3-5-3-8 2-4z' },
    },
    ALB: {
      name: 'Albania', type: 'coast', supplyCenter: false,
      adjacent: ['TRI', 'SER', 'GRE', 'ADR', 'ION'],
      render: { center: [333, 460], path: 'm331 454v23l4 3 4 7 11-10v-6l-4-5v-14l-9-6-7-1z' },
    },
    GRE: {
      name: 'Greece', type: 'coast', supplyCenter: true,
      adjacent: ['SER', 'ALB', 'BUL', 'AEG', 'ION'],
      render: { center: [352, 490], path: 'm339 487l7 11h4l-3 2 5 8 15-1 4 4-16-1-5 4 7 7 2 12 1-5 7 8 1-5 8 6-5-17 7 1-1-8 9 3-1-7-15-15 1-3 7 3-10-11 3-6 8 7 3-1-1-6 5 1-6-6h12l-4-12-12 4h-7l-8 3-5 4h-6v6z' },
    },
    BUL: {
      name: 'Bulgaria', type: 'coast', supplyCenter: true,
      adjacent: ['SER', 'GRE', 'CON', 'RUM', 'BLA', 'AEG'],
      coasts: {
        ec: { name: 'East Coast', fleetAdjacency: ['BLA', 'CON', 'RUM'], render: { center: [420, 440] } },
        sc: { name: 'South Coast', fleetAdjacency: ['AEG', 'GRE', 'CON'], render: { center: [400, 460] } },
      },
      render: { center: [395, 443], path: 'm413 464l-1-10 8-3 6-1-4-9 3-14 4-1 1-3-8-3h-12l-6 2-6 5-8-2-8 2-7-4-5 2-3-4-2 4 3 8 3 5' },
    },
    RUM: {
      name: 'Rumania', type: 'coast', supplyCenter: true,
      adjacent: ['BUD', 'GAL', 'UKR', 'SEV', 'BUL', 'SER', 'BLA'],
      render: { center: [410, 415], path: 'm403 360l1 11-10 5 1 6 6 3 5 11-5 6h-14l-20 4-2 6 2 9 3 4 5-2 7 4 8-2 8 2 6-5 6-2h12l8 3 2-14 7-5-1-7-11 2-5-17 1-6-9-4-3-11z' },
    },

    // ──────────────────────────── SEA ZONES ────────────────────────────
    NAO: {
      name: 'North Atlantic Ocean', type: 'sea', supplyCenter: false,
      adjacent: ['NWG', 'CLY', 'LVP', 'IRI', 'MAO'],
      render: { center: [65, 120], path: 'm70 261l-6-11 3-8 4 3 10-11-7-6 6-3-2-7 4-1 7 3h5l1-2-1-2h3l4-4h9l9 5 1 10h10v-4l8-6v-3l-8-6-1-11 10-8 1-7 8-5v-177h-148v273h58z' },
    },
    NWG: {
      name: 'Norwegian Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NAO', 'CLY', 'EDI', 'NOR', 'BAR', 'NTH'],
      render: { center: [220, 70], path: 'm362 33l-5 6-14 5-19 10-4 10-10 11-1 9-6 2-11 25-15 21-8 2-5 8-6-1-22 13h-38l-27 27v16l-13-4-6 1 2-6 7-3 1-4-14-4v-177h214z' },
    },
    BAR: {
      name: 'Barents Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NWG', 'NOR', 'STP'],
      render: { center: [440, 15], path: 'm540 0l-5 9-5-3-13 13-1 14-3 5v-15l-6-3-2 6-6 7-7 15 3 10-7 2-9-3-2-2 4-5-8-7-7 2 6 17 6 4v8l-6-2-4 2-11 17 12 9-2 6-5 3-18-8-2 9 5 5 7 4-2 3-18-4-8-15v-9l-12-6-2-5 33 1 12-5 2-13-6-5-36-14-12 2-4-4-4 3-6-1 4-6-1-3-10-5-2 7-2-7-3-2-3 7-3-5-5 9v-9h-4v-33z' },
    },
    NTH: {
      name: 'North Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NWG', 'NOR', 'DEN', 'SKA', 'HOL', 'BEL', 'ENG', 'LON', 'YOR', 'EDI', 'HEL'],
      render: { center: [190, 230], path: 'm171 197v-16c0-3.55 0.7-7.06 2.06-10.33 1.35-3.28 3.34-6.25 5.85-8.76 2.51-2.51 5.48-4.5 8.76-5.85 3.27-1.36 6.78-2.06 10.33-2.06h43v70h7l-3 13h-34v64h-38l-8-8-25-96z' },
    },
    SKA: {
      name: 'Skagerrak', type: 'sea', supplyCenter: false,
      adjacent: ['NOR', 'SWE', 'DEN', 'NTH'],
      render: { center: [255, 220], path: 'm241 209l5 1 20-9 4-8 5 10 2 15-1 6 6 12-3 4v3l-4-1-6 1-3-3 1-6-1-13-3 2-15 1h-7z' },
    },
    HEL: {
      name: 'Helgoland Bight', type: 'sea', supplyCenter: false,
      adjacent: ['NTH', 'HOL', 'DEN', 'KIE'],
      render: { center: [220, 265], path: 'm245 237l-2 10 1 7-1 3 2 6-1 7v3l-9 4-1-3-4-1-4 2-15-1v-37z' },
    },
    BAL: {
      name: 'Baltic Sea', type: 'sea', supplyCenter: false,
      adjacent: ['DEN', 'SWE', 'KIE', 'BER', 'PRU', 'LVN', 'BOT'],
      render: { center: [308, 260], path: 'm266 255l5 5 7-6-1-4 3-2-1-5 3 10 7 1 5-9 11-1 7-15-1-9h48l-10 9-2 14v5l1 6-4 8-7 2-3 9-6 1-2-9-12 1-7 7-13 2-8-1 1-7-7-1-14 9-5-1-1-5-4-3v-3l-2-8z' },
    },
    BOT: {
      name: 'Gulf of Bothnia', type: 'sea', supplyCenter: false,
      adjacent: ['SWE', 'FIN', 'STP', 'LVN', 'BAL'],
      render: { center: [328, 175], path: 'm311 220l3-11 8-3 6-3 3-10-5-10-6-1 1-21 9-15 13-8 8-10-4-7 2-9 6-8 7 3 6 1 4 12-6 1-7 15-14 15 2 9 3 5-2 13 1 6 8 2 8 5 19-6 18-8 1 6 8 1 3 3h-6l-8 5-1 5-12-1-16 2-2 4-4 2 3 6 4 3 1 8 4 6-4 2-7-1-7-8z' },
    },
    ENG: {
      name: 'English Channel', type: 'sea', supplyCenter: false,
      adjacent: ['LON', 'WAL', 'IRI', 'MAO', 'BRE', 'PIC', 'BEL', 'NTH'],
      render: { center: [135, 306], path: 'm173 301l-4 10-16 4 2 5-5-1-6-1-2-6-6-2v16l-12-3-2-5-20-1-14-14 12-12 10 1 10 3 4-4 10 3 13 1 13 3 8-2z' },
    },
    IRI: {
      name: 'Irish Sea', type: 'sea', supplyCenter: false,
      adjacent: ['NAO', 'LVP', 'WAL', 'ENG', 'MAO'],
      render: { center: [95, 270], path: 'm100 291l12-4 10-6 8 1-3-6-8-4h-3l-1-7 13-3-2-6-5 1 11-7h3l4-10-3-11-6-2h-10l-10 5-1 14-11 13-11-2-17 4-12 12 30 30z' },
    },
    MAO: {
      name: 'Mid-Atlantic Ocean', type: 'sea', supplyCenter: false,
      adjacent: ['NAO', 'IRI', 'ENG', 'BRE', 'GAS', 'SPA', 'POR', 'NAF', 'WES'],
      render: { center: [50, 355], path: 'm102 317l-2 5 3 6 6 1 14 15-1 6 1 7 5 6-7 19 1 2-10 15-11-3-5 1-24-13-13-3-5-6-6-1-2 4-7-3-6 6 2 3-3 12-2 10-13 21h-3l-4 6 3 7 2 1-3 9 1 4-5 8 11 7 8-1 6 7 1 9 3 6v5l-4 1-16 22-17 2v-247h58z' },
    },
    WES: {
      name: 'Western Mediterranean', type: 'sea', supplyCenter: false,
      adjacent: ['MAO', 'SPA', 'GOL', 'NAF', 'TUN', 'TYS'],
      render: { center: [160, 491], path: 'm37 490l10-2 5 1 8-3 18 5 5 3 3-9 4-2 8 1 9-10 6-1 2-4h27l8 2 4-5h51l1 10-2 9 4 7h4l5-3 1 1v26l-6 1-4 4-5-1-24-5-10 3-19-7-33-2-11 2-7 4-10-3-5 6-5 2-11-4v-5l-4 3-18-5-4-7-1-8-4 1z' },
    },
    GOL: {
      name: 'Gulf of Lyon', type: 'sea', supplyCenter: false,
      adjacent: ['SPA', 'MAR', 'PIE', 'TUS', 'WES', 'TYS'],
      render: { center: [170, 457], path: 'm115 469l-5-8 14-17 7-5 15-1 11-6 1-7v-7l11-6 7 5 12 5 10-1 13-5 11-6 11 5 5 16h-14l-3 3-10 2 2 15 5 3v4l-4 3-8 1-1 4h-51l-6-3-6 6z' },
    },
    TYS: {
      name: 'Tyrrhenian Sea', type: 'sea', supplyCenter: false,
      adjacent: ['GOL', 'TUS', 'ROM', 'NAP', 'WES', 'TUN', 'ION'],
      render: { center: [245, 495], path: 'm238 431l9 11 1 5 8 11 15 6 5 10 14 13 4 15-5 9h-4v-3l-9 2h-13l-6-3-5 1-5 5-11 11-3-1-9 4-1-9-5-2v-26h2l4-22-2-10h-4v-4l5-4 2-6v-8l-1-5z' },
    },
    ION: {
      name: 'Ionian Sea', type: 'sea', supplyCenter: false,
      adjacent: ['TUN', 'TYS', 'NAP', 'APU', 'ADR', 'ALB', 'GRE', 'AEG', 'EAS'],
      render: { center: [315, 520], path: 'm289 511l1 3 5 1 13-15 3-9-7-7 6-4 8 5h4v-5h13l4 7 7 11h4l-3 2 5 8 15-1 4 4-16-1-5 4 7 7 2 12 1-5 7 8 1-5 8 6 7 7-3 3 3 3 17 4v5h-168l2-8-2-7-7-9 6-4 5-7 11-11 11 6 15 12 8 1 1-11 3-8v-2z' },
    },
    ADR: {
      name: 'Adriatic Sea', type: 'sea', supplyCenter: false,
      adjacent: ['VEN', 'TRI', 'ALB', 'APU', 'ION'],
      render: { center: [308, 460], path: 'm322 480l-25-24 3-3h-10l-12-10-6-19-12-7 1-16 9-3 6 1-1 4 3 7 4-9 4 1 3 16 17 18 25 18v23l4 3z' },
    },
    AEG: {
      name: 'Aegean Sea', type: 'sea', supplyCenter: false,
      adjacent: ['GRE', 'BUL', 'CON', 'SMY', 'EAS', 'ION'],
      render: { center: [392, 510], path: 'm376 537l-5-17 7 1-1-8 9 3-1-7-15-15 1-3 7 3-10-11 3-6 8 7 3-1-1-6 5 1-6-6h12l8-4 8 2 2 3 4 2-4 7-1 5 8-1v3l3 6-3 3v9l6 3 4 14 8-1v7l-19 19-4-2-25-1-4-2z' },
    },
    EAS: {
      name: 'Eastern Mediterranean', type: 'sea', supplyCenter: false,
      adjacent: ['AEG', 'SMY', 'SYR', 'ION'],
      render: { center: [455, 550], path: 'm435 530l6-4 6 2 6 6 11-3 2-10 9-1 10 8 6 2 14-4 6-12 9 3 7-9 3 1-5 9 1 12 6 5-4 24h-128v-5l14-2 2-3z' },
    },
    BLA: {
      name: 'Black Sea', type: 'sea', supplyCenter: false,
      adjacent: ['RUM', 'SEV', 'ARM', 'ANK', 'CON', 'BUL'],
      render: { center: [500, 418], path: 'm440 458l-10-3-4-5-4-9 3-14 4-1 1-3 2-14 7-5-1-7 8-19 13-3 2 2-2 2 6 4 11-2 2 2-6 2-4 7 9 4v5l9 3 2-7 6-1 3-4 10-3-1-5-12 3-9-9 18-14 23-13 1 3-13 11 3 6h3l-5 13-4-1-1 3 7 7 11 1 26 12 13 2 6 9-3 10-15 11-4-1-31 4-6-3-3 2-9-7-21 5-11 9-6 10-22 3z' },
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
