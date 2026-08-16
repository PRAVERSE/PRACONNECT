// VoxelEngine.ts - Advanced High-performance Voxel World Engine with Biomes, 3D Caves & Dynamic Lighting
import * as THREE from 'three';

// Expanded Block ID definitions
export enum BlockType {
  AIR = 0,
  GRASS = 1,
  DIRT = 2,
  STONE = 3,
  SAND = 4,
  WOOD = 5,
  LEAVES = 6,
  PLANK = 7,
  BRICK = 8,
  GLASS = 9,
  ORE_IRON = 10,
  ORE_COAL = 11,
  WATER = 12,
  BEDROCK = 13,
  SNOW = 14,
  COBBLESTONE = 15,
  POLISHED_STONE = 16,
  ORE_GOLD = 17,
  ORE_DIAMOND = 18,
  LAVA = 19,
  BIRCH_LOG = 20,
  PINE_LOG = 21,
  BIRCH_LEAVES = 22,
  PINE_LEAVES = 23,
  WOOL_WHITE = 24,
  WOOL_RED = 25,
  WOOL_BLUE = 26,
  WOOL_YELLOW = 27,
  DOOR = 28,
  TORCH = 29,
  CRAFTING_TABLE = 30,
  FURNACE = 31,
  CHEST = 32,
  BED = 33,
  STAIRS = 34,
  SLAB = 35,
  FLOWER_RED = 36,
  FLOWER_YELLOW = 37,
  FENCE = 38,
  GATE = 39,
  LEVER = 40,
  PRESSURE_PLATE = 41,
  LADDER = 42,
  OBSIDIAN = 43,
  NETHERRACK = 44,
  END_STONE = 45,
  ANVIL = 46,
  ENCHANTING_TABLE = 47,
  SMITHING_TABLE = 48,
  BREWING_STAND = 49,
  BEACON = 50,
  COMMAND_BLOCK = 51,
  NOTE_BLOCK = 52,
  JUKEBOX = 53,
  CAULDRON = 54,
  PISTON = 55,
  HOPPER = 56,
  TNT = 57,
  SCULK = 58,
  SCAFFOLDING = 59
}

export interface BlockConfig {
  id: BlockType;
  name: string;
  color: string;
  transparent?: boolean;
  solid?: boolean;
  unbreakable?: boolean;
  emissive?: boolean;
  textures: {
    top: string;
    bottom: string;
    sides: string;
  };
}

export const BLOCK_CONFIGS: Record<BlockType, BlockConfig> = {
  [BlockType.AIR]: { id: BlockType.AIR, name: 'Air', color: 'transparent', solid: false, textures: { top: '', bottom: '', sides: '' } },
  [BlockType.GRASS]: { id: BlockType.GRASS, name: 'Grass Block', color: '#5b8c31', solid: true, textures: { top: '#5b8c31', bottom: '#6e4f34', sides: 'grass_side' } },
  [BlockType.DIRT]: { id: BlockType.DIRT, name: 'Dirt', color: '#6e4f34', solid: true, textures: { top: '#6e4f34', bottom: '#6e4f34', sides: '#6e4f34' } },
  [BlockType.STONE]: { id: BlockType.STONE, name: 'Stone', color: '#787878', solid: true, textures: { top: '#787878', bottom: '#787878', sides: '#787878' } },
  [BlockType.SAND]: { id: BlockType.SAND, name: 'Sand', color: '#d4be70', solid: true, textures: { top: '#d4be70', bottom: '#d4be70', sides: '#d4be70' } },
  [BlockType.WOOD]: { id: BlockType.WOOD, name: 'Oak Log', color: '#583e26', solid: true, textures: { top: '#82613d', bottom: '#82613d', sides: '#583e26' } },
  [BlockType.LEAVES]: { id: BlockType.LEAVES, name: 'Oak Leaves', color: '#316629', solid: true, transparent: true, textures: { top: '#316629', bottom: '#316629', sides: '#316629' } },
  [BlockType.PLANK]: { id: BlockType.PLANK, name: 'Wood Planks', color: '#a8814d', solid: true, textures: { top: '#a8814d', bottom: '#a8814d', sides: '#a8814d' } },
  [BlockType.BRICK]: { id: BlockType.BRICK, name: 'Bricks', color: '#9c4938', solid: true, textures: { top: '#9c4938', bottom: '#9c4938', sides: '#9c4938' } },
  [BlockType.GLASS]: { id: BlockType.GLASS, name: 'Glass Window', color: '#aaccff', solid: true, transparent: true, textures: { top: '#aaccff', bottom: '#aaccff', sides: '#aaccff' } },
  [BlockType.ORE_IRON]: { id: BlockType.ORE_IRON, name: 'Iron Ore', color: '#8a7868', solid: true, textures: { top: '#8a7868', bottom: '#8a7868', sides: '#8a7868' } },
  [BlockType.ORE_COAL]: { id: BlockType.ORE_COAL, name: 'Coal Ore', color: '#444444', solid: true, textures: { top: '#444444', bottom: '#444444', sides: '#444444' } },
  [BlockType.WATER]: { id: BlockType.WATER, name: 'Water', color: '#2b65ec', solid: false, transparent: true, textures: { top: '#2b65ec', bottom: '#2b65ec', sides: '#2b65ec' } },
  [BlockType.BEDROCK]: { id: BlockType.BEDROCK, name: 'Bedrock', color: '#222222', solid: true, unbreakable: true, textures: { top: '#222222', bottom: '#222222', sides: '#222222' } },
  [BlockType.SNOW]: { id: BlockType.SNOW, name: 'Snow', color: '#f0f4f8', solid: true, textures: { top: '#f0f4f8', bottom: '#6e4f34', sides: '#f0f4f8' } },
  [BlockType.COBBLESTONE]: { id: BlockType.COBBLESTONE, name: 'Cobblestone', color: '#5a5a5a', solid: true, textures: { top: '#5a5a5a', bottom: '#5a5a5a', sides: '#5a5a5a' } },
  [BlockType.POLISHED_STONE]: { id: BlockType.POLISHED_STONE, name: 'Polished Stone', color: '#8c8c8c', solid: true, textures: { top: '#8c8c8c', bottom: '#8c8c8c', sides: '#8c8c8c' } },
  [BlockType.ORE_GOLD]: { id: BlockType.ORE_GOLD, name: 'Gold Ore', color: '#d4af37', solid: true, textures: { top: '#d4af37', bottom: '#d4af37', sides: '#d4af37' } },
  [BlockType.ORE_DIAMOND]: { id: BlockType.ORE_DIAMOND, name: 'Diamond Ore', color: '#00e5ff', solid: true, textures: { top: '#00e5ff', bottom: '#00e5ff', sides: '#00e5ff' } },
  [BlockType.LAVA]: { id: BlockType.LAVA, name: 'Lava', color: '#ff4500', solid: false, emissive: true, transparent: false, textures: { top: '#ff4500', bottom: '#ff4500', sides: '#ff4500' } },
  [BlockType.BIRCH_LOG]: { id: BlockType.BIRCH_LOG, name: 'Birch Log', color: '#d0cfbe', solid: true, textures: { top: '#82613d', bottom: '#82613d', sides: '#d0cfbe' } },
  [BlockType.PINE_LOG]: { id: BlockType.PINE_LOG, name: 'Pine Log', color: '#3b2513', solid: true, textures: { top: '#50351d', bottom: '#50351d', sides: '#3b2513' } },
  [BlockType.BIRCH_LEAVES]: { id: BlockType.BIRCH_LEAVES, name: 'Birch Leaves', color: '#61a338', solid: true, transparent: true, textures: { top: '#61a338', bottom: '#61a338', sides: '#61a338' } },
  [BlockType.PINE_LEAVES]: { id: BlockType.PINE_LEAVES, name: 'Pine Needles', color: '#1c4d25', solid: true, transparent: true, textures: { top: '#1c4d25', bottom: '#1c4d25', sides: '#1c4d25' } },
  [BlockType.WOOL_WHITE]: { id: BlockType.WOOL_WHITE, name: 'White Wool', color: '#e8e8e8', solid: true, textures: { top: '#e8e8e8', bottom: '#e8e8e8', sides: '#e8e8e8' } },
  [BlockType.WOOL_RED]: { id: BlockType.WOOL_RED, name: 'Red Wool', color: '#b82e2e', solid: true, textures: { top: '#b82e2e', bottom: '#b82e2e', sides: '#b82e2e' } },
  [BlockType.WOOL_BLUE]: { id: BlockType.WOOL_BLUE, name: 'Blue Wool', color: '#2e5cb8', solid: true, textures: { top: '#2e5cb8', bottom: '#2e5cb8', sides: '#2e5cb8' } },
  [BlockType.WOOL_YELLOW]: { id: BlockType.WOOL_YELLOW, name: 'Yellow Wool', color: '#d8b82e', solid: true, textures: { top: '#d8b82e', bottom: '#d8b82e', sides: '#d8b82e' } },
  [BlockType.DOOR]: { id: BlockType.DOOR, name: 'Wooden Door', color: '#a8814d', solid: false, transparent: true, textures: { top: '#a8814d', bottom: '#a8814d', sides: '#a8814d' } },
  [BlockType.TORCH]: { id: BlockType.TORCH, name: 'Torch', color: '#ffb703', solid: false, emissive: true, transparent: true, textures: { top: '#ffb703', bottom: '#ffb703', sides: '#ffb703' } },
  [BlockType.CRAFTING_TABLE]: { id: BlockType.CRAFTING_TABLE, name: 'Crafting Table', color: '#8a5022', solid: true, textures: { top: '#b56d35', bottom: '#8a5022', sides: '#8a5022' } },
  [BlockType.FURNACE]: { id: BlockType.FURNACE, name: 'Furnace', color: '#686868', solid: true, textures: { top: '#686868', bottom: '#686868', sides: '#484848' } },
  [BlockType.CHEST]: { id: BlockType.CHEST, name: 'Chest', color: '#a67232', solid: true, textures: { top: '#a67232', bottom: '#a67232', sides: '#a67232' } },
  [BlockType.BED]: { id: BlockType.BED, name: 'Red Bed', color: '#c42828', solid: true, textures: { top: '#c42828', bottom: '#a8814d', sides: '#c42828' } },
  [BlockType.STAIRS]: { id: BlockType.STAIRS, name: 'Stone Stairs', color: '#787878', solid: true, transparent: true, textures: { top: '#787878', bottom: '#787878', sides: '#787878' } },
  [BlockType.SLAB]: { id: BlockType.SLAB, name: 'Stone Slab', color: '#787878', solid: true, transparent: true, textures: { top: '#787878', bottom: '#787878', sides: '#787878' } },
  [BlockType.FLOWER_RED]: { id: BlockType.FLOWER_RED, name: 'Poppy Flower', color: '#e63946', solid: false, transparent: true, textures: { top: '#e63946', bottom: '#e63946', sides: '#e63946' } },
  [BlockType.FLOWER_YELLOW]: { id: BlockType.FLOWER_YELLOW, name: 'Dandelion', color: '#ffb703', solid: false, transparent: true, textures: { top: '#ffb703', bottom: '#ffb703', sides: '#ffb703' } },
  [BlockType.FENCE]: { id: BlockType.FENCE, name: 'Wooden Fence', color: '#8a5022', solid: true, transparent: true, textures: { top: '#8a5022', bottom: '#8a5022', sides: '#8a5022' } },
  [BlockType.GATE]: { id: BlockType.GATE, name: 'Fence Gate', color: '#8a5022', solid: false, transparent: true, textures: { top: '#8a5022', bottom: '#8a5022', sides: '#8a5022' } },
  [BlockType.LEVER]: { id: BlockType.LEVER, name: 'Lever Switch', color: '#787878', solid: false, transparent: true, textures: { top: '#787878', bottom: '#787878', sides: '#787878' } },
  [BlockType.PRESSURE_PLATE]: { id: BlockType.PRESSURE_PLATE, name: 'Pressure Plate', color: '#a8814d', solid: false, transparent: true, textures: { top: '#a8814d', bottom: '#a8814d', sides: '#a8814d' } },
  [BlockType.LADDER]: { id: BlockType.LADDER, name: 'Wooden Ladder', color: '#a8814d', solid: false, transparent: true, textures: { top: '#a8814d', bottom: '#a8814d', sides: '#a8814d' } },
  [BlockType.OBSIDIAN]: { id: BlockType.OBSIDIAN, name: 'Obsidian', color: '#1a0e2e', solid: true, textures: { top: '#1a0e2e', bottom: '#1a0e2e', sides: '#1a0e2e' } },
  [BlockType.NETHERRACK]: { id: BlockType.NETHERRACK, name: 'Netherrack', color: '#682525', solid: true, textures: { top: '#682525', bottom: '#682525', sides: '#682525' } },
  [BlockType.END_STONE]: { id: BlockType.END_STONE, name: 'End Stone', color: '#dddba0', solid: true, textures: { top: '#dddba0', bottom: '#dddba0', sides: '#dddba0' } },
  [BlockType.ANVIL]: { id: BlockType.ANVIL, name: 'Anvil', color: '#383838', solid: true, transparent: true, textures: { top: '#4a4a4a', bottom: '#383838', sides: '#383838' } },
  [BlockType.ENCHANTING_TABLE]: { id: BlockType.ENCHANTING_TABLE, name: 'Enchanting Table', color: '#932230', solid: true, textures: { top: '#2b78a0', bottom: '#1a0e2e', sides: '#932230' } },
  [BlockType.SMITHING_TABLE]: { id: BlockType.SMITHING_TABLE, name: 'Smithing Table', color: '#3b434e', solid: true, textures: { top: '#5d6775', bottom: '#3b434e', sides: '#3b434e' } },
  [BlockType.BREWING_STAND]: { id: BlockType.BREWING_STAND, name: 'Brewing Stand', color: '#e69d00', solid: false, transparent: true, textures: { top: '#e69d00', bottom: '#e69d00', sides: '#e69d00' } },
  [BlockType.BEACON]: { id: BlockType.BEACON, name: 'Beacon', color: '#66e0ff', solid: true, emissive: true, transparent: true, textures: { top: '#66e0ff', bottom: '#1a0e2e', sides: '#66e0ff' } },
  [BlockType.COMMAND_BLOCK]: { id: BlockType.COMMAND_BLOCK, name: 'Command Block', color: '#c27d38', solid: true, textures: { top: '#c27d38', bottom: '#c27d38', sides: '#c27d38' } },
  [BlockType.NOTE_BLOCK]: { id: BlockType.NOTE_BLOCK, name: 'Note Block', color: '#57381d', solid: true, textures: { top: '#57381d', bottom: '#57381d', sides: '#57381d' } },
  [BlockType.JUKEBOX]: { id: BlockType.JUKEBOX, name: 'Jukebox', color: '#613b1f', solid: true, textures: { top: '#2a1a0e', bottom: '#613b1f', sides: '#613b1f' } },
  [BlockType.CAULDRON]: { id: BlockType.CAULDRON, name: 'Cauldron', color: '#4a4a4a', solid: true, transparent: true, textures: { top: '#4a4a4a', bottom: '#4a4a4a', sides: '#4a4a4a' } },
  [BlockType.PISTON]: { id: BlockType.PISTON, name: 'Piston', color: '#8a6842', solid: true, textures: { top: '#8a6842', bottom: '#5a5a5a', sides: '#5a5a5a' } },
  [BlockType.HOPPER]: { id: BlockType.HOPPER, name: 'Hopper', color: '#4a4a4a', solid: true, transparent: true, textures: { top: '#4a4a4a', bottom: '#4a4a4a', sides: '#4a4a4a' } },
  [BlockType.TNT]: { id: BlockType.TNT, name: 'TNT Explosive', color: '#db3b2a', solid: true, textures: { top: '#db3b2a', bottom: '#db3b2a', sides: '#db3b2a' } },
  [BlockType.SCULK]: { id: BlockType.SCULK, name: 'Sculk Block', color: '#092532', solid: true, emissive: true, textures: { top: '#092532', bottom: '#092532', sides: '#092532' } },
  [BlockType.SCAFFOLDING]: { id: BlockType.SCAFFOLDING, name: 'Scaffolding', color: '#bfa169', solid: false, transparent: true, textures: { top: '#bfa169', bottom: '#bfa169', sides: '#bfa169' } }
};

// 3D Perlin Noise generator for procedural terrain & 3D underground caves
export class Simplex3DNoise {
  private p: number[] = [];

  constructor(seed = 12345) {
    const permutation = [
      151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,
      190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,
      125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,
      105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,
      135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,
      82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,
      153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,
      251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,
      157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,
      78,66,215,61,156,180
    ];
    this.p = new Array(512);
    for (let i = 0; i < 256; i++) {
      this.p[i] = permutation[(i + seed) & 255];
      this.p[256 + i] = this.p[i];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  public noise2D(x: number, y: number): number {
    return this.noise3D(x, y, 0);
  }

  public noise3D(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);

    const u = this.fade(xf);
    const v = this.fade(yf);
    const w = this.fade(zf);

    const A = this.p[X] + Y;
    const AA = this.p[A] + Z;
    const AB = this.p[A + 1] + Z;
    const B = this.p[X + 1] + Y;
    const BA = this.p[B] + Z;
    const BB = this.p[B + 1] + Z;

    return this.lerp(
      w,
      this.lerp(
        v,
        this.lerp(u, this.grad(this.p[AA], xf, yf, zf), this.grad(this.p[BA], xf - 1, yf, zf)),
        this.lerp(u, this.grad(this.p[AB], xf, yf - 1, zf), this.grad(this.p[BB], xf - 1, yf - 1, zf))
      ),
      this.lerp(
        v,
        this.lerp(u, this.grad(this.p[AA + 1], xf, yf, zf - 1), this.grad(this.p[BA + 1], xf - 1, yf, zf - 1)),
        this.lerp(u, this.grad(this.p[AB + 1], xf, yf - 1, zf - 1), this.grad(this.p[BB + 1], xf - 1, yf - 1, zf - 1))
      )
    );
  }
}

// Generates procedural pixel textures for blocks
export function createPixelTexture(blockType: BlockType, faceType: 'top' | 'bottom' | 'sides'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;

  const config = BLOCK_CONFIGS[blockType];
  let baseColor = config?.color || '#888888';

  if (blockType === BlockType.GRASS) {
    if (faceType === 'top') baseColor = '#5b8c31';
    else if (faceType === 'bottom') baseColor = '#6e4f34';
    else baseColor = '#6e4f34';
  } else if (blockType === BlockType.SNOW) {
    if (faceType === 'top') baseColor = '#f0f4f8';
    else if (faceType === 'bottom') baseColor = '#6e4f34';
  } else if (blockType === BlockType.WOOD || blockType === BlockType.BIRCH_LOG || blockType === BlockType.PINE_LOG) {
    if (faceType === 'top' || faceType === 'bottom') baseColor = '#82613d';
  }

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 16, 16);

  // Pixel noise
  const imgData = ctx.getImageData(0, 0, 16, 16);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 16;
    data[i] = Math.min(255, Math.max(0, data[i] + noise));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
  }
  ctx.putImageData(imgData, 0, 0);

  // Special Overlays
  if (blockType === BlockType.GRASS && faceType === 'sides') {
    ctx.fillStyle = '#5b8c31';
    ctx.fillRect(0, 0, 16, 4);
    for (let x = 0; x < 16; x++) {
      if ((x * 3 + 1) % 5 === 0) ctx.fillRect(x, 4, 1, 2);
    }
  } else if (blockType === BlockType.SNOW && faceType === 'sides') {
    ctx.fillStyle = '#f0f4f8';
    ctx.fillRect(0, 0, 16, 5);
  } else if (blockType === BlockType.CRAFTING_TABLE && faceType === 'top') {
    ctx.fillStyle = '#613a1a';
    ctx.strokeRect(2, 2, 12, 12);
    ctx.fillRect(4, 4, 3, 3);
    ctx.fillRect(9, 9, 3, 3);
  } else if (blockType === BlockType.ORE_GOLD) {
    ctx.fillStyle = '#ffea00';
    ctx.fillRect(3, 4, 3, 2);
    ctx.fillRect(9, 10, 3, 3);
  } else if (blockType === BlockType.ORE_DIAMOND) {
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(4, 3, 3, 3);
    ctx.fillRect(10, 8, 3, 3);
  } else if (blockType === BlockType.TORCH) {
    ctx.fillStyle = '#ffb703';
    ctx.fillRect(6, 2, 4, 4);
    ctx.fillStyle = '#583e26';
    ctx.fillRect(7, 6, 2, 8);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

// Voxel Engine World Data Manager
export class VoxelEngine {
  public sizeX: number;
  public sizeY: number;
  public sizeZ: number;
  public seaLevel: number;
  public voxels: Uint8Array;
  private noise: Simplex3DNoise;

  constructor(sizeX = 96, sizeY = 40, sizeZ = 96, seaLevel = 10) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.seaLevel = seaLevel;
    this.voxels = new Uint8Array(sizeX * sizeY * sizeZ);
    this.noise = new Simplex3DNoise(Math.floor(Math.random() * 100000));
    this.generateTerrain();
  }

  private getIndex(x: number, y: number, z: number): number {
    return x + y * this.sizeX + z * this.sizeX * this.sizeY;
  }

  public getBlock(x: number, y: number, z: number): BlockType {
    if (x < 0 || x >= this.sizeX || y < 0 || y >= this.sizeY || z < 0 || z >= this.sizeZ) {
      return BlockType.AIR;
    }
    return this.voxels[this.getIndex(x, y, z)] as BlockType;
  }

  public setBlock(x: number, y: number, z: number, type: BlockType): boolean {
    if (x < 0 || x >= this.sizeX || y < 0 || y >= this.sizeY || z < 0 || z >= this.sizeZ) {
      return false;
    }
    // Prevent breaking Bedrock
    const currentBlock = this.getBlock(x, y, z);
    if (BLOCK_CONFIGS[currentBlock]?.unbreakable) {
      return false;
    }
    this.voxels[this.getIndex(x, y, z)] = type;
    return true;
  }

  public isSolid(x: number, y: number, z: number): boolean {
    const block = this.getBlock(x, y, z);
    return BLOCK_CONFIGS[block]?.solid ?? false;
  }

  public isTransparent(x: number, y: number, z: number): boolean {
    const block = this.getBlock(x, y, z);
    if (block === BlockType.AIR) return true;
    return BLOCK_CONFIGS[block]?.transparent ?? false;
  }

  // Procedural terrain generator with biomes, 3D caves, and trees
  public generateTerrain(): void {
    this.voxels.fill(BlockType.AIR);

    const treePositions: { x: number; z: number }[] = [];

    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        // Biome Noise
        const biomeVal = this.noise.noise2D(x * 0.015 + 100, z * 0.015 + 100);

        // Height Noise
        const n1 = this.noise.noise2D(x * 0.03, z * 0.03);
        const n2 = this.noise.noise2D(x * 0.08, z * 0.08) * 0.4;
        const mountainNoise = this.noise.noise2D(x * 0.01 + 200, z * 0.01 + 200);

        let height = Math.floor(12 + n1 * 12 + n2 * 5);

        if (mountainNoise > 0.25) {
          height += Math.floor((mountainNoise - 0.25) * 22);
        }

        height = Math.max(3, Math.min(this.sizeY - 4, height));

        // Determine Biome & Surface Block
        let surfaceBlock = BlockType.GRASS;
        let logType = BlockType.WOOD;
        let leafType = BlockType.LEAVES;

        if (biomeVal > 0.35) {
          // Snowy Tundra Biome
          surfaceBlock = BlockType.SNOW;
          logType = BlockType.PINE_LOG;
          leafType = BlockType.PINE_LEAVES;
        } else if (biomeVal < -0.3) {
          // Desert Biome
          surfaceBlock = BlockType.SAND;
        } else if (height <= this.seaLevel + 1) {
          // Beach / Shore
          surfaceBlock = BlockType.SAND;
        } else if (height > 26) {
          // Mountain Stone Peak
          surfaceBlock = BlockType.STONE;
        } else if (Math.sin(x * 0.1) > 0.5) {
          // Birch Forest variant
          logType = BlockType.BIRCH_LOG;
          leafType = BlockType.BIRCH_LEAVES;
        }

        // Fill Column
        for (let y = 0; y <= height; y++) {
          if (y === 0) {
            // Unbreakable Bedrock layer
            this.setBlock(x, y, z, BlockType.BEDROCK);
            continue;
          }

          // 3D Cave Noise Carving (underground tunnels)
          if (y > 1 && y < height - 2) {
            const caveVal = this.noise.noise3D(x * 0.07, y * 0.1, z * 0.07);
            if (caveVal > 0.42) {
              // Carve cave air tunnel
              continue;
            }
          }

          if (y === height) {
            this.setBlock(x, y, z, surfaceBlock);

            // Plant Flowers & Tall Grass on Grass Surface
            if (surfaceBlock === BlockType.GRASS && y > this.seaLevel + 1) {
              const plantRoll = Math.random();
              if (plantRoll < 0.02) {
                this.setBlock(x, y + 1, z, BlockType.FLOWER_RED);
              } else if (plantRoll < 0.04) {
                this.setBlock(x, y + 1, z, BlockType.FLOWER_YELLOW);
              }
            }
          } else if (y >= height - 3) {
            if (surfaceBlock === BlockType.SAND) {
              this.setBlock(x, y, z, BlockType.SAND);
            } else if (surfaceBlock === BlockType.SNOW) {
              this.setBlock(x, y, z, BlockType.DIRT);
            } else {
              this.setBlock(x, y, z, BlockType.DIRT);
            }
          } else {
            // Deep underground stone & rare ores
            if (y <= 3 && Math.random() < 0.15) {
              this.setBlock(x, y, z, BlockType.LAVA); // Lava pools near bedrock
            } else {
              const oreRoll = Math.random();
              if (y < 6 && oreRoll < 0.02) {
                this.setBlock(x, y, z, BlockType.ORE_DIAMOND);
              } else if (y < 12 && oreRoll < 0.035) {
                this.setBlock(x, y, z, BlockType.ORE_GOLD);
              } else if (y < 18 && oreRoll < 0.05) {
                this.setBlock(x, y, z, BlockType.ORE_IRON);
              } else if (y < 25 && oreRoll < 0.08) {
                this.setBlock(x, y, z, BlockType.ORE_COAL);
              } else {
                this.setBlock(x, y, z, BlockType.STONE);
              }
            }
          }
        }

        // Fill Water level
        if (height < this.seaLevel) {
          for (let y = height + 1; y <= this.seaLevel; y++) {
            this.setBlock(x, y, z, BlockType.WATER);
          }
        }

        // Tree Spawning
        if (
          (surfaceBlock === BlockType.GRASS || surfaceBlock === BlockType.SNOW) &&
          height > this.seaLevel + 1 &&
          x > 4 && x < this.sizeX - 4 && z > 4 && z < this.sizeZ - 4
        ) {
          if (Math.random() < 0.025) {
            const tooClose = treePositions.some(p => Math.abs(p.x - x) < 5 && Math.abs(p.z - z) < 5);
            if (!tooClose) {
              treePositions.push({ x, z });
              this.growTree(x, height + 1, z, logType, leafType);
            }
          }
        }
      }
    }
  }

  // Helper to grow a tree variety
  private growTree(x: number, trunkBaseY: number, z: number, logType: BlockType, leafType: BlockType): void {
    const trunkHeight = 4 + Math.floor(Math.random() * 3);

    for (let y = 0; y < trunkHeight; y++) {
      this.setBlock(x, trunkBaseY + y, z, logType);
    }

    const canopyTopY = trunkBaseY + trunkHeight;
    for (let lx = -2; lx <= 2; lx++) {
      for (let lz = -2; lz <= 2; lz++) {
        for (let ly = -2; ly <= 1; ly++) {
          if (Math.abs(lx) === 2 && Math.abs(lz) === 2 && ly >= 0) continue;
          const px = x + lx;
          const py = canopyTopY + ly;
          const pz = z + lz;

          if (this.getBlock(px, py, pz) === BlockType.AIR) {
            this.setBlock(px, py, pz, leafType);
          }
        }
      }
    }
  }

  // Generates optimized face-culled geometry
  public generateMesh(): THREE.Group {
    const group = new THREE.Group();
    const materialsCache: Record<string, THREE.MeshStandardMaterial> = {};

    const getMaterial = (blockType: BlockType, face: 'top' | 'bottom' | 'sides') => {
      const key = `${blockType}_${face}`;
      if (!materialsCache[key]) {
        const tex = createPixelTexture(blockType, face);
        const config = BLOCK_CONFIGS[blockType];

        materialsCache[key] = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.8,
          metalness: 0.1,
          transparent: config?.transparent || false,
          opacity: blockType === BlockType.WATER ? 0.65 : blockType === BlockType.GLASS ? 0.45 : 1.0,
          emissive: config?.emissive ? new THREE.Color(config.color) : new THREE.Color(0x000000),
          emissiveIntensity: config?.emissive ? 0.6 : 0,
          side: THREE.FrontSide
        });
      }
      return materialsCache[key];
    };

    const faces = [
      { dir: [1, 0, 0], face: 'sides', corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
      { dir: [-1, 0, 0], face: 'sides', corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
      { dir: [0, 1, 0], face: 'top', corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
      { dir: [0, -1, 0], face: 'bottom', corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
      { dir: [0, 0, 1], face: 'sides', corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
      { dir: [0, 0, -1], face: 'sides', corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] }
    ];

    type FaceKey = string;
    const faceBuffers: Record<FaceKey, { positions: number[]; normals: number[]; uvs: number[]; indices: number[]; count: number }> = {};

    for (let x = 0; x < this.sizeX; x++) {
      for (let y = 0; y < this.sizeY; y++) {
        for (let z = 0; z < this.sizeZ; z++) {
          const block = this.getBlock(x, y, z);
          if (block === BlockType.AIR) continue;

          for (const f of faces) {
            const nx = x + f.dir[0];
            const ny = y + f.dir[1];
            const nz = z + f.dir[2];

            let renderFace = false;
            if (nx < 0 || nx >= this.sizeX || ny < 0 || ny >= this.sizeY || nz < 0 || nz >= this.sizeZ) {
              renderFace = true;
            } else {
              const neighbor = this.getBlock(nx, ny, nz);
              if (neighbor === BlockType.AIR) {
                renderFace = true;
              } else if (BLOCK_CONFIGS[neighbor]?.transparent && neighbor !== block) {
                renderFace = true;
              }
            }

            if (renderFace) {
              const faceType = f.face as 'top' | 'bottom' | 'sides';
              const key = `${block}_${faceType}`;

              if (!faceBuffers[key]) {
                faceBuffers[key] = { positions: [], normals: [], uvs: [], indices: [], count: 0 };
              }

              const buf = faceBuffers[key];
              const baseIndex = buf.count * 4;

              for (const c of f.corners) {
                buf.positions.push(x + c[0], y + c[1], z + c[2]);
                buf.normals.push(f.dir[0], f.dir[1], f.dir[2]);
              }

              buf.uvs.push(0, 0,  1, 0,  1, 1,  0, 1);
              buf.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
              buf.count++;
            }
          }
        }
      }
    }

    for (const [key, buf] of Object.entries(faceBuffers)) {
      if (buf.count === 0) continue;

      const [blockTypeStr, faceTypeStr] = key.split('_');
      const blockType = parseInt(blockTypeStr, 10) as BlockType;
      const faceType = faceTypeStr as 'top' | 'bottom' | 'sides';

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
      geometry.setIndex(buf.indices);

      const material = getMaterial(blockType, faceType);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    return group;
  }
}
