export { VehicleVisual } from './visual.js';
import { TYPES } from './specs.js';
export async function create(ctx) { return { types: TYPES, list: [], active: null, update() {} }; }
