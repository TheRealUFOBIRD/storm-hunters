// Bake configs. node: regex for glTF node names of the variant, H: target height (m), leaf: foliage material regex,
// woodTex: image (basename w/o _1k.jpg) used as the unique trunk texture (others -> palette), K0/K1: foliage cards, w0/w1: wood tris.
export const LEAF = 'leaves|leaf|twig';
export const SPECIES = [
  { id: 'oak_a', src: 'island_tree_01', node: '^island_tree_01', H: 11, woodTex: 'island_tree_01_diff', K0: 230, K1: 46, w0: 3600, w1: 420, cross: .5, minWood0: .5, minWood1: 2.2 },
  { id: 'oak_b', src: 'island_tree_02', node: '^island_tree_02', H: 10, woodTex: 'island_tree_02_diff', K0: 200, K1: 40, w0: 3200, w1: 380, cross: .5, minWood0: .5, minWood1: 2 },
  { id: 'cottonwood_a', src: 'jacaranda_tree', node: '^jacaranda_tree', H: 16, woodTex: 'jacaranda_tree_trunk_diff', K0: 480, K1: 90, size0: 1.3, size1: 1.45, tileMul: 1.9, w0: 4200, w1: 480, cross: .5, minWood0: .9, minWood1: 3.5 },
  { id: 'pine_a', src: 'fir_tree_01', node: '^fir_tree_01_a', H: 17, woodTex: 'fir_tree_01_trunk_a_diff', K0: 520, K1: 90, tileMul: 1, cross: .2, w0: 2600, w1: 300, cross: .35, minWood0: .6, minWood1: 2.5, conifer: true, pca: .85, size0: 1.1, size1: 1.35 },
  { id: 'spruce_a', src: 'fir_sapling_medium', node: '^fir_sapling_medium_a', H: 15, woodTex: null, K0: 380, K1: 52, w0: 1800, w1: 260, cross: .35, minWood0: .4, minWood1: 2, conifer: true, pca: .75, size0: 1.3, size1: 1.45 },
  { id: 'spruce_b', src: 'fir_sapling_medium', node: '^fir_sapling_medium_b', H: 13, woodTex: null, K0: 340, K1: 46, w0: 1600, w1: 240, cross: .35, minWood0: .4, minWood1: 2, conifer: true, pca: .75, size0: 1.3, size1: 1.45 },
  { id: 'cedar_a', src: 'othonna_cerarioides', node: '^othonna_cerarioides_a', H: 5.5, woodTex: null, K0: 150, K1: 30, w0: 1200, w1: 160, cross: .5, minWood0: .3, minWood1: 1.2, conifer: true, pca: .75, size0: 1.3, size1: 1.45 },
  { id: 'cedar_b', src: 'othonna_cerarioides', node: '^othonna_cerarioides_b', H: 4.8, woodTex: null, K0: 130, K1: 28, w0: 1000, w1: 150, cross: .5, minWood0: .3, minWood1: 1.2, conifer: true, pca: .75, size0: 1.3, size1: 1.45 },
  { id: 'mesquite_a', src: 'tree_small_02', node: '^tree_small_02', H: 4.6, woodTex: 'tree_small_02_diff', K0: 170, K1: 36, w0: 2600, w1: 320, cross: .5, minWood0: .25, minWood1: 1 },
  { id: 'mesquite_b', src: 'searsia_lucida', node: '^searsia_lucida_a', H: 4, woodTex: null, K0: 140, K1: 30, w0: 2400, w1: 300, cross: .5, minWood0: .25, minWood1: 1 },
  { id: 'dead_a', src: 'island_tree_01', node: '^island_tree_01', H: 8, woodTex: 'island_tree_01_diff', K0: 0, K1: 0, w0: 5000, w1: 700, minWood0: .25, minWood1: 1.4, noLeaves: true },
  { id: 'shrub_a', src: 'wild_rooibos_bush', node: '^wild_rooibos_bush_a', H: 1.1, woodTex: null, K0: 34, K1: 8, w0: 300, w1: 40, cross: .6, minWood0: .15, minWood1: 99, atlas: 512, shrub: true },
  { id: 'shrub_b', src: 'searsia_lucida', node: '^searsia_lucida_e', H: 1.3, woodTex: null, K0: 40, K1: 9, w0: 400, w1: 40, cross: .6, minWood0: .15, minWood1: 99, atlas: 512, shrub: true },
  { id: 'shrub_c', src: 'grass_medium_01', node: '^grass_medium_01_large_a', H: .75, leaf: 'grass', woodTex: null, K0: 26, K1: 7, w0: 0, w1: 0, cross: .7, atlas: 512, shrub: true, grass: true },
  { id: 'rock_a', src: 'rock_09', node: '^rock_09', R: 1.15, solid: true, w0: 1600, w1: 260, atlas: 512 },
  { id: 'rock_b', src: 'namaqualand_boulder_05', node: '^namaqualand_boulder_05', R: 1.2, solid: true, w0: 1600, w1: 260, atlas: 512 },
  { id: 'rock_c', src: 'rock_07', node: '^rock_07', R: 1.1, solid: true, w0: 1400, w1: 240, atlas: 512 },
  { id: 'rock_d', src: 'stone_01', node: '^stone_01', R: 1.1, solid: true, w0: 1400, w1: 240, atlas: 512 },
];
