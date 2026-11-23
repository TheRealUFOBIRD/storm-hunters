// Player profile: money, reputation, owned vehicles, upgrades, stats, photo album. Pure data + localStorage.
export const VERSION = 2;
const KEY = 'sh.profile', PKEY = 'sh.photos', MAX_PHOTOS = 24;

// level thresholds (total rep) and titles
export const RANKS = ['Weather Tourist', 'Back-Road Spotter', 'Storm Spotter', 'Field Chaser', 'Core Runner', 'Intercept Crew', 'Lead Chaser', 'Research Partner', 'Veteran Chaser', 'Plains Legend'];
export const repForLevel = (l) => (l <= 1 ? 0 : Math.round(70 * Math.pow(l - 1, 1.75) / 10) * 10);
export function levelFor(rep) { let l = 1; while (rep >= repForLevel(l + 1) && l < 60) l++; return l; }
export const rankName = (l) => RANKS[Math.min(RANKS.length - 1, Math.floor((l - 1) / 2))];

// Vehicle upgrades are stored per vehicle, gear upgrades globally.
export const VEHICLE_UPGRADES = {
  engine: { name: 'Engine tune', desc: 'Forced induction and a remapped ECU. More power for the escape.', cost: [900, 2200, 5200], stat: ['+10% power', '+20% power', '+32% power'], mod: { power: [1, 1.1, 1.2, 1.32] } },
  tires: { name: 'All-terrain tires', desc: 'Deep siped tread for mud, gravel and standing water.', cost: [450, 1200, 2800], stat: ['+12% loose grip', '+24% loose grip', '+36% loose grip'], mod: { grip: [1, 1.04, 1.08, 1.12], looseGrip: [1, 1.12, 1.24, 1.36] } },
  armor: { name: 'Body plating', desc: 'Bolt-on steel and laminated glass. Heavier, takes more debris.', cost: [1200, 3400, 8200], stat: ['-18% damage', '-34% damage', '-48% damage'], mod: { armor: [1, 0.82, 0.66, 0.52], mass: [1, 1.05, 1.11, 1.18] } },
  hail: { name: 'Hail cage', desc: 'Expanded-metal guard over the glass. Softball stones stop being fatal.', cost: [750, 1900], stat: ['-60% hail damage', '-90% hail damage'], mod: { hail: [1, 0.4, 0.1] } },
  tank: { name: 'Long-range tank', desc: 'Auxiliary fuel cell under the load bed.', cost: [380, 1100], stat: ['+40% range', '+90% range'], mod: { fuel: [1, 1.4, 1.9] } },
  anchor: { name: 'Ground anchors', desc: 'Hydraulic spikes and a drop skirt. Holds the vehicle in violent wind.', cost: [2600, 7200], stat: ['+35% hold', '+80% hold'], mod: { anchor: [1, 1.35, 1.8] } },
};
export const GEAR_UPGRADES = {
  radar: { name: 'Radar uplink', desc: 'Longer range and faster volume updates on the field computer.', cost: [600, 1800, 4600], stat: ['30 km range', '45 km, fast sweep', '70 km, velocity dealias'], value: { range: [20000, 30000, 45000, 70000], rate: [60, 75, 110, 150] } },
  lens: { name: 'Camera lens', desc: 'Faster, longer, stabilised glass.', cost: [400, 1300, 3600], stat: ['24-200 mm', '24-400 mm, IS', '24-600 mm f/4 IS'], value: { max: [105, 200, 400, 600], steady: [0, 0.15, 0.35, 0.55] } },
  scanner: { name: 'Scanner power', desc: 'Higher pulse power for the portable Doppler. Scans build faster and further out.', cost: [700, 2100, 5000], stat: ['+35% rate', '+75% rate', '+130% rate'], value: { rate: [1, 1.35, 1.75, 2.3], range: [6000, 7500, 9500, 12000] } },
  probes: { name: 'Probe rack', desc: 'More ground stations in the rack, deeper anchors.', cost: [500, 1600, 4200], stat: ['4 pods', '5 pods', '6 pods, deep anchor'], value: { count: [3, 4, 5, 6], hold: [62, 72, 84, 98] } },
  drone: { name: 'Drone airframe', desc: 'Bigger cells, stiffer arms, stronger radio.', cost: [600, 1700, 4300], stat: ['+40% battery', '+80% battery, +thrust', '+130% battery, storm rated'], value: { battery: [150, 210, 270, 345], thrust: [1, 1.1, 1.3, 1.6], range: [1800, 2400, 3200, 4500] } },
  stream: { name: 'Live uplink', desc: 'Bonded cellular and satellite. Streaming pays more near a tornado.', cost: [550, 1900, 4800], stat: ['+30% stream pay', '+70% stream pay', '+130% stream pay'], value: { rate: [1, 1.3, 1.7, 2.3] } },
};
export const gearValue = (p, key, field) => { const g = GEAR_UPGRADES[key].value[field]; return g[Math.min(p.upgrades.gear[key] || 0, g.length - 1)]; };

const DEF = () => ({
  v: VERSION, money: 600, rep: 0, level: 1, owned: [], current: null, name: '', story: 0, storyDone: [], hintsSeen: {},
  upgrades: { gear: {}, vehicles: {} },
  stats: { km: 0, tornadoes: 0, photos: 0, best: 0, scans: 0, probes: 0, probeHits: 0, drones: 0, swept: 0, earned: 0, missions: 0, closest: 0, maxWind: 0, reports: 0, hail: 0, seen: [] },
  best: {}, photos: [],
});
const merge = (d, s) => { for (const k in s) { if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && d[k] && typeof d[k] === 'object') merge(d[k], s[k]); else d[k] = s[k]; } return d; };

export function createProfile(events, types = {}, store = typeof localStorage === 'undefined' ? null : localStorage) {
  const p = DEF(); let dirty = false, saveT = 0;
  try { const s = JSON.parse(store?.getItem(KEY) || 'null'); if (s) merge(p, migrate(s)); } catch { /* corrupt or blocked */ }
  try { p.photos = JSON.parse(store?.getItem(PKEY) || '[]') || []; } catch { p.photos = []; }
  p.v = VERSION; p.level = levelFor(p.rep);
  function ensureVehicles(t = types) {
    const ids = Object.keys(t); if (!ids.length) return;
    p.owned = p.owned.filter((i) => t[i]);
    if (!p.owned.length) p.owned.push(ids.reduce((a, b) => ((t[b].price ?? 0) < (t[a].price ?? 0) ? b : a)));
    if (!p.owned.includes(p.current)) p.current = p.owned[0];
  }
  ensureVehicles();
  const save = () => { dirty = false; try { const { photos, ...r } = p; store?.setItem(KEY, JSON.stringify(r)); } catch { /* quota */ } };
  function savePhotos() {
    while (p.photos.length > MAX_PHOTOS) { // drop the worst unpinned shot
      let w = -1; p.photos.forEach((f, i) => { if (!f.pin && i < p.photos.length - 1 && (w < 0 || f.score < p.photos[w].score)) w = i; }); p.photos.splice(w < 0 ? 0 : w, 1);
    }
    for (let k = 0; k < 6; k++) { try { store?.setItem(PKEY, JSON.stringify(p.photos)); return; } catch { if (p.photos.length < 2) return; p.photos.splice(0, 2); } }
  }
  const api = {
    data: p, ensureVehicles, save, savePhotos,
    touch() { dirty = true; },
    tick(dt) { saveT += dt; if (dirty && saveT > 3) { saveT = 0; save(); } },
    earn(n, why = '') { n = Math.round(n); if (!n) return 0; p.money = Math.max(0, p.money + n); if (n > 0) p.stats.earned += n; dirty = true; events?.emit('money', { amount: n, total: p.money, why }); return n; },
    canPay: (n) => p.money >= n,
    pay(n, why) { n = Math.round(n); if (p.money < n) return false; p.money -= n; dirty = true; events?.emit('money', { amount: -n, total: p.money, why }); return true; },
    addRep(n) { n = Math.round(n); if (!n) return; p.rep = Math.max(0, p.rep + n); const l = levelFor(p.rep), up = l > p.level; p.level = l; dirty = true; events?.emit('rep', { amount: n, total: p.rep }); if (up) events?.emit('levelup', { level: l, rank: rankName(l) }); },
    levelProgress() { const a = repForLevel(p.level), b = repForLevel(p.level + 1); return (p.rep - a) / (b - a); },
    buyVehicle(id) { const t = types[id] || api.types?.[id]; if (!t || p.owned.includes(id)) return false; if (!api.pay(t.price || 0, t.name)) return false; p.owned.push(id); p.current = id; save(); events?.emit('profile:vehicle', { id }); return true; },
    select(id) { if (!p.owned.includes(id)) return false; p.current = id; save(); events?.emit('profile:vehicle', { id }); return true; },
    upLevel: (key, veh) => (VEHICLE_UPGRADES[key] ? p.upgrades.vehicles[veh]?.[key] || 0 : p.upgrades.gear[key] || 0),
    buyUpgrade(key, veh) {
      const d = VEHICLE_UPGRADES[key] || GEAR_UPGRADES[key]; if (!d) return false; const l = api.upLevel(key, veh);
      if (l >= d.cost.length || (VEHICLE_UPGRADES[key] && !p.owned.includes(veh))) return false;
      if (!api.pay(d.cost[l], d.name)) return false;
      if (VEHICLE_UPGRADES[key]) (p.upgrades.vehicles[veh] ||= {})[key] = l + 1; else p.upgrades.gear[key] = l + 1;
      save(); events?.emit('profile:upgrade', { key, level: l + 1, vehicle: veh }); return true;
    },
    vehicleMods(id) {
      const m = { power: 1, grip: 1, looseGrip: 1, armor: 1, mass: 1, hail: 1, fuel: 1, anchor: 1 }, u = p.upgrades.vehicles[id] || {};
      for (const k in VEHICLE_UPGRADES) { const l = u[k] || 0, mod = VEHICLE_UPGRADES[k].mod; for (const f in mod) m[f] *= mod[f][Math.min(l, mod[f].length - 1)]; }
      return m;
    },
    addPhoto(f) { p.photos.push(f); p.stats.photos++; p.stats.best = Math.max(p.stats.best, f.score); dirty = true; savePhotos(); },
    removePhoto(id) { const i = p.photos.findIndex((f) => f.id === id); if (i >= 0) { p.photos.splice(i, 1); savePhotos(); } },
    wipe() { const d = DEF(); for (const k in p) delete p[k]; Object.assign(p, d); ensureVehicles(api.types || types); save(); savePhotos(); events?.emit('profile:reset'); },
  };
  api.types = types;
  return api;
}
export function migrate(s) {
  if ((s.v || 1) < 2) { // v1 stored flat upgrades
    const g = {}; for (const k in s.upgrades || {}) if (GEAR_UPGRADES[k]) g[k] = s.upgrades[k];
    s.upgrades = { gear: g, vehicles: {} }; s.v = 2;
  }
  return s;
}
