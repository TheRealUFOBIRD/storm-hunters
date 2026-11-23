// Compressed continental USA projection. World is BOUNDS metres; +X east, -Z north.
export const BOUNDS = { minX: -50000, maxX: 50000, minZ: -31500, maxZ: 31500 };
const LON0 = -96, LAT0 = 37.1, KX = Math.cos(38 * Math.PI / 180) * 111.32, KZ = 111.32; // km per degree
export const SCALE = 98000 / (59.5 * KX); // world m per real km (~18.8)
export const toWorld = (lat, lon) => ({ x: (lon - LON0 + 0.15) * KX * SCALE, z: -(lat - LAT0) * KZ * SCALE });
export const toLatLon = (x, z) => ({ lat: -z / (KZ * SCALE) + LAT0, lon: x / (KX * SCALE) + LON0 - 0.15 });
export const inBounds = (x, z, m = 0) => x > BOUNDS.minX + m && x < BOUNDS.maxX - m && z > BOUNDS.minZ + m && z < BOUNDS.maxZ - m;
