import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Play,
  Sun,
  Moon,
  Download,
  Boxes,
  Sparkles,
  Shield,
  Heart,
  Utensils,
  Backpack,
  Hammer,
  Volume2,
  VolumeX,
  Bed,
  CloudRain,
  Clock,
  Flame,
  BookOpen,
  Compass,
  Wrench,
  Terminal,
  MoreVertical,
  X
} from 'lucide-react';
import { VoxelEngine, BlockType, BLOCK_CONFIGS } from './engine/VoxelEngine';
import { generateSingleFileHtml } from './engine/SingleFileHtmlExporter';
import { MinecraftCompendiumModal } from './modals/MinecraftCompendiumModal';
import { DayNightClockWidget } from './ui/DayNightClockWidget';

interface SkyKeyframe {
  time: number;
  sky: string;
  fog: string;
  fogDensity: number;
  ambientColor: string;
  ambientIntensity: number;
  sunColor: string;
  sunIntensity: number;
  starsOpacity: number;
}

const SKY_KEYFRAMES: SkyKeyframe[] = [
  { time: 0.0,  sky: '#040714', fog: '#040714', fogDensity: 0.012, ambientColor: '#1a2238', ambientIntensity: 0.18, sunColor: '#3b4b6e', sunIntensity: 0.22, starsOpacity: 1.0 },
  { time: 4.5,  sky: '#080c20', fog: '#080c20', fogDensity: 0.012, ambientColor: '#1d2540', ambientIntensity: 0.20, sunColor: '#415278', sunIntensity: 0.25, starsOpacity: 0.95 },
  { time: 5.5,  sky: '#2e1c3b', fog: '#2e1c3b', fogDensity: 0.014, ambientColor: '#4a2c5a', ambientIntensity: 0.35, sunColor: '#ff7744', sunIntensity: 0.45, starsOpacity: 0.5 },
  { time: 6.2,  sky: '#f26419', fog: '#f28e2b', fogDensity: 0.014, ambientColor: '#e07a5f', ambientIntensity: 0.55, sunColor: '#ffb703', sunIntensity: 0.75, starsOpacity: 0.1 },
  { time: 7.2,  sky: '#f7ad19', fog: '#f8c26c', fogDensity: 0.013, ambientColor: '#f3c063', ambientIntensity: 0.65, sunColor: '#ffe169', sunIntensity: 0.90, starsOpacity: 0.0 },
  { time: 8.5,  sky: '#70d6ff', fog: '#90e0ef', fogDensity: 0.012, ambientColor: '#ffffff', ambientIntensity: 0.75, sunColor: '#fff5cc', sunIntensity: 0.98, starsOpacity: 0.0 },
  { time: 12.0, sky: '#3a86ff', fog: '#93c5fd', fogDensity: 0.011, ambientColor: '#ffffff', ambientIntensity: 0.85, sunColor: '#ffffff', sunIntensity: 1.10, starsOpacity: 0.0 },
  { time: 16.5, sky: '#48cae4', fog: '#ade8f4', fogDensity: 0.012, ambientColor: '#ffffff', ambientIntensity: 0.78, sunColor: '#fff2b2', sunIntensity: 1.00, starsOpacity: 0.0 },
  { time: 17.5, sky: '#f77f00', fog: '#fcbf49', fogDensity: 0.013, ambientColor: '#f4a261', ambientIntensity: 0.68, sunColor: '#f97316', sunIntensity: 0.92, starsOpacity: 0.0 },
  { time: 18.5, sky: '#b5179e', fog: '#7209b7', fogDensity: 0.015, ambientColor: '#4a154b', ambientIntensity: 0.45, sunColor: '#ff4d6d', sunIntensity: 0.55, starsOpacity: 0.3 },
  { time: 19.5, sky: '#1d1a3a', fog: '#1d1a3a', fogDensity: 0.014, ambientColor: '#2d2448', ambientIntensity: 0.28, sunColor: '#414068', sunIntensity: 0.32, starsOpacity: 0.75 },
  { time: 21.0, sky: '#0f172a', fog: '#0f172a', fogDensity: 0.013, ambientColor: '#1e293b', ambientIntensity: 0.22, sunColor: '#334155', sunIntensity: 0.26, starsOpacity: 0.90 },
  { time: 24.0, sky: '#040714', fog: '#040714', fogDensity: 0.012, ambientColor: '#1a2238', ambientIntensity: 0.18, sunColor: '#3b4b6e', sunIntensity: 0.22, starsOpacity: 1.0 }
];

export function getSkyParameters(
  time: number,
  dimension: 'overworld' | 'nether' | 'end',
  weather: 'clear' | 'rain' | 'thunder'
) {
  if (dimension === 'nether') {
    return {
      sky: '#280505',
      fog: '#3b0808',
      fogDensity: 0.035,
      ambientColor: '#ff3322',
      ambientIntensity: 0.5,
      sunColor: '#ff1100',
      sunIntensity: 0.35,
      starsOpacity: 0
    };
  }

  if (dimension === 'end') {
    return {
      sky: '#0b0612',
      fog: '#160a24',
      fogDensity: 0.022,
      ambientColor: '#a855f7',
      ambientIntensity: 0.45,
      sunColor: '#8b5cf6',
      sunIntensity: 0.35,
      starsOpacity: 0.8
    };
  }

  const normTime = ((time % 24) + 24) % 24;

  let kf1 = SKY_KEYFRAMES[0];
  let kf2 = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];

  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    if (normTime >= SKY_KEYFRAMES[i].time && normTime <= SKY_KEYFRAMES[i + 1].time) {
      kf1 = SKY_KEYFRAMES[i];
      kf2 = SKY_KEYFRAMES[i + 1];
      break;
    }
  }

  const duration = kf2.time - kf1.time;
  const t = duration > 0 ? (normTime - kf1.time) / duration : 0;

  const color1 = new THREE.Color();
  const color2 = new THREE.Color();

  const lerpColor = (c1Str: string, c2Str: string, factor: number) => {
    color1.set(c1Str);
    color2.set(c2Str);
    return color1.lerp(color2, factor);
  };

  const lerpNum = (v1: number, v2: number, factor: number) => v1 + (v2 - v1) * factor;

  const skyColor = lerpColor(kf1.sky, kf2.sky, t);
  const fogColor = lerpColor(kf1.fog, kf2.fog, t);
  const ambientColor = lerpColor(kf1.ambientColor, kf2.ambientColor, t);
  const sunColor = lerpColor(kf1.sunColor, kf2.sunColor, t);

  const params = {
    sky: '#' + skyColor.getHexString(),
    fog: '#' + fogColor.getHexString(),
    fogDensity: lerpNum(kf1.fogDensity, kf2.fogDensity, t),
    ambientColor: '#' + ambientColor.getHexString(),
    ambientIntensity: lerpNum(kf1.ambientIntensity, kf2.ambientIntensity, t),
    sunColor: '#' + sunColor.getHexString(),
    sunIntensity: lerpNum(kf1.sunIntensity, kf2.sunIntensity, t),
    starsOpacity: lerpNum(kf1.starsOpacity, kf2.starsOpacity, t)
  };

  if (weather === 'rain') {
    const skyC = new THREE.Color(params.sky).lerp(new THREE.Color('#1e293b'), 0.5);
    const fogC = new THREE.Color(params.fog).lerp(new THREE.Color('#334155'), 0.5);
    params.sky = '#' + skyC.getHexString();
    params.fog = '#' + fogC.getHexString();
    params.fogDensity += 0.006;
    params.ambientIntensity *= 0.7;
    params.sunIntensity *= 0.5;
  } else if (weather === 'thunder') {
    const skyC = new THREE.Color(params.sky).lerp(new THREE.Color('#0f172a'), 0.75);
    const fogC = new THREE.Color(params.fog).lerp(new THREE.Color('#1e293b'), 0.75);
    params.sky = '#' + skyC.getHexString();
    params.fog = '#' + fogC.getHexString();
    params.fogDensity += 0.01;
    params.ambientIntensity *= 0.5;
    params.sunIntensity *= 0.3;

    if (Math.random() < 0.018) {
      params.ambientIntensity = 2.4;
      params.ambientColor = '#e0f2fe';
    }
  }

  return params;
}

// Simple Web Audio Sound Effects Synthesizer
class SoundFx {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playFootstep() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110 + Math.random() * 30, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  playBreak() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.12);
  }

  playPlace() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }

  playHurt() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(180, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playEat() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playHit() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(250, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playJump() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(320, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playClick() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  playPickup() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(659.25, this.ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }

  playLevelUp() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.25);
  }
}

const sfx = new SoundFx();

// ITEM REGISTRY & TYPES
export interface ItemDef {
  id: string;
  name: string;
  color: string;
  category: 'block' | 'tool' | 'armor' | 'food' | 'material';
  tier?: number; // 0: hand, 1: wood, 2: stone, 3: iron, 4: diamond
  toolType?: 'pickaxe' | 'sword' | 'axe' | 'shovel';
  blockType?: BlockType;
  foodValue?: number;
  armorValue?: number;
  armorSlot?: 'helmet' | 'chestplate' | 'leggings' | 'boots';
}

export interface ItemStack {
  id: string;
  count: number;
}

export const ITEM_REGISTRY: Record<string, ItemDef> = {
  // Blocks
  'grass': { id: 'grass', name: 'Grass Block', color: '#5b8c31', category: 'block', blockType: BlockType.GRASS },
  'dirt': { id: 'dirt', name: 'Dirt', color: '#6e4f34', category: 'block', blockType: BlockType.DIRT },
  'stone': { id: 'stone', name: 'Stone', color: '#787878', category: 'block', blockType: BlockType.STONE },
  'cobblestone': { id: 'cobblestone', name: 'Cobblestone', color: '#5a5a5a', category: 'block', blockType: BlockType.COBBLESTONE },
  'sand': { id: 'sand', name: 'Sand', color: '#d4be70', category: 'block', blockType: BlockType.SAND },
  'wood': { id: 'wood', name: 'Oak Wood', color: '#583e26', category: 'block', blockType: BlockType.WOOD },
  'plank': { id: 'plank', name: 'Wood Planks', color: '#a8814d', category: 'block', blockType: BlockType.PLANK },
  'leaves': { id: 'leaves', name: 'Leaves', color: '#316629', category: 'block', blockType: BlockType.LEAVES },
  'brick': { id: 'brick', name: 'Bricks', color: '#9c4938', category: 'block', blockType: BlockType.BRICK },
  'glass': { id: 'glass', name: 'Glass Window', color: '#aaccff', category: 'block', blockType: BlockType.GLASS },
  'ore_iron': { id: 'ore_iron', name: 'Iron Ore', color: '#8a7868', category: 'block', blockType: BlockType.ORE_IRON },
  'ore_coal': { id: 'ore_coal', name: 'Coal Ore', color: '#444444', category: 'block', blockType: BlockType.ORE_COAL },
  'ore_gold': { id: 'ore_gold', name: 'Gold Ore', color: '#d4af37', category: 'block', blockType: BlockType.ORE_GOLD },
  'ore_diamond': { id: 'ore_diamond', name: 'Diamond Ore', color: '#00e5ff', category: 'block', blockType: BlockType.ORE_DIAMOND },
  'crafting_table': { id: 'crafting_table', name: 'Crafting Table', color: '#8a5022', category: 'block', blockType: BlockType.CRAFTING_TABLE },
  'furnace': { id: 'furnace', name: 'Furnace', color: '#686868', category: 'block', blockType: BlockType.FURNACE },
  'chest': { id: 'chest', name: 'Chest', color: '#a67232', category: 'block', blockType: BlockType.CHEST },
  'torch': { id: 'torch', name: 'Torch', color: '#ffb703', category: 'block', blockType: BlockType.TORCH },
  'door': { id: 'door', name: 'Wooden Door', color: '#a8814d', category: 'block', blockType: BlockType.DOOR },
  'bed': { id: 'bed', name: 'Red Bed', color: '#c42828', category: 'block', blockType: BlockType.BED },
  'stairs': { id: 'stairs', name: 'Stone Stairs', color: '#787878', category: 'block', blockType: BlockType.STAIRS },
  'slab': { id: 'slab', name: 'Stone Slab', color: '#787878', category: 'block', blockType: BlockType.SLAB },
  'fence': { id: 'fence', name: 'Wooden Fence', color: '#8a5022', category: 'block', blockType: BlockType.FENCE },
  'gate': { id: 'gate', name: 'Fence Gate', color: '#8a5022', category: 'block', blockType: BlockType.GATE },
  'lever': { id: 'lever', name: 'Lever Switch', color: '#787878', category: 'block', blockType: BlockType.LEVER },
  'pressure_plate': { id: 'pressure_plate', name: 'Pressure Plate', color: '#a8814d', category: 'block', blockType: BlockType.PRESSURE_PLATE },
  'ladder': { id: 'ladder', name: 'Wooden Ladder', color: '#a8814d', category: 'block', blockType: BlockType.LADDER },
  'obsidian': { id: 'obsidian', name: 'Obsidian', color: '#1a0e2e', category: 'block', blockType: BlockType.OBSIDIAN },
  'netherrack': { id: 'netherrack', name: 'Netherrack', color: '#682525', category: 'block', blockType: BlockType.NETHERRACK },
  'end_stone': { id: 'end_stone', name: 'End Stone', color: '#dddba0', category: 'block', blockType: BlockType.END_STONE },
  'anvil': { id: 'anvil', name: 'Anvil', color: '#383838', category: 'block', blockType: BlockType.ANVIL },
  'enchanting_table': { id: 'enchanting_table', name: 'Enchanting Table', color: '#932230', category: 'block', blockType: BlockType.ENCHANTING_TABLE },
  'smithing_table': { id: 'smithing_table', name: 'Smithing Table', color: '#3b434e', category: 'block', blockType: BlockType.SMITHING_TABLE },
  'brewing_stand': { id: 'brewing_stand', name: 'Brewing Stand', color: '#e69d00', category: 'block', blockType: BlockType.BREWING_STAND },
  'beacon': { id: 'beacon', name: 'Beacon', color: '#66e0ff', category: 'block', blockType: BlockType.BEACON },
  'command_block': { id: 'command_block', name: 'Command Block', color: '#c27d38', category: 'block', blockType: BlockType.COMMAND_BLOCK },
  'note_block': { id: 'note_block', name: 'Note Block', color: '#57381d', category: 'block', blockType: BlockType.NOTE_BLOCK },
  'jukebox': { id: 'jukebox', name: 'Jukebox', color: '#613b1f', category: 'block', blockType: BlockType.JUKEBOX },
  'cauldron': { id: 'cauldron', name: 'Cauldron', color: '#4a4a4a', category: 'block', blockType: BlockType.CAULDRON },
  'piston': { id: 'piston', name: 'Piston', color: '#8a6842', category: 'block', blockType: BlockType.PISTON },
  'hopper': { id: 'hopper', name: 'Hopper', color: '#4a4a4a', category: 'block', blockType: BlockType.HOPPER },
  'tnt': { id: 'tnt', name: 'TNT Explosive', color: '#db3b2a', category: 'block', blockType: BlockType.TNT },
  'sculk': { id: 'sculk', name: 'Sculk Sensor', color: '#092532', category: 'block', blockType: BlockType.SCULK },
  'scaffolding': { id: 'scaffolding', name: 'Scaffolding', color: '#bfa169', category: 'block', blockType: BlockType.SCAFFOLDING },

  // Materials & Rare Drops
  'stick': { id: 'stick', name: 'Stick', color: '#82613d', category: 'material' },
  'coal': { id: 'coal', name: 'Coal', color: '#222222', category: 'material' },
  'raw_iron': { id: 'raw_iron', name: 'Raw Iron', color: '#8a7868', category: 'material' },
  'iron_ingot': { id: 'iron_ingot', name: 'Iron Ingot', color: '#e0e0e0', category: 'material' },
  'raw_gold': { id: 'raw_gold', name: 'Raw Gold', color: '#d4af37', category: 'material' },
  'gold_ingot': { id: 'gold_ingot', name: 'Gold Ingot', color: '#ffd700', category: 'material' },
  'diamond': { id: 'diamond', name: 'Diamond', color: '#00e5ff', category: 'material' },
  'netherite_ingot': { id: 'netherite_ingot', name: 'Netherite Ingot', color: '#4a3b32', category: 'material' },
  'emerald': { id: 'emerald', name: 'Emerald', color: '#10b981', category: 'material' },
  'lapis': { id: 'lapis', name: 'Lapis Lazuli', color: '#2563eb', category: 'material' },
  'book': { id: 'book', name: 'Book', color: '#9a3412', category: 'material' },
  'leather': { id: 'leather', name: 'Leather', color: '#8b5a2b', category: 'material' },
  'feather': { id: 'feather', name: 'Feather', color: '#f5f5f5', category: 'material' },
  'bone': { id: 'bone', name: 'Bone', color: '#e8e8e8', category: 'material' },
  'string': { id: 'string', name: 'String', color: '#ffffff', category: 'material' },
  'rotten_flesh': { id: 'rotten_flesh', name: 'Rotten Flesh', color: '#4d613c', category: 'material' },
  'ender_pearl': { id: 'ender_pearl', name: 'Ender Pearl', color: '#0f766e', category: 'material' },
  'bonemeal': { id: 'bonemeal', name: 'Bonemeal', color: '#f3f4f6', category: 'material' },

  // Tools & Unique Gear
  'wooden_pickaxe': { id: 'wooden_pickaxe', name: 'Wooden Pickaxe', color: '#a8814d', category: 'tool', tier: 1, toolType: 'pickaxe' },
  'stone_pickaxe': { id: 'stone_pickaxe', name: 'Stone Pickaxe', color: '#787878', category: 'tool', tier: 2, toolType: 'pickaxe' },
  'iron_pickaxe': { id: 'iron_pickaxe', name: 'Iron Pickaxe', color: '#e0e0e0', category: 'tool', tier: 3, toolType: 'pickaxe' },
  'diamond_pickaxe': { id: 'diamond_pickaxe', name: 'Diamond Pickaxe', color: '#00e5ff', category: 'tool', tier: 4, toolType: 'pickaxe' },
  'netherite_pickaxe': { id: 'netherite_pickaxe', name: 'Netherite Pickaxe', color: '#4a3b32', category: 'tool', tier: 5, toolType: 'pickaxe' },

  'wooden_sword': { id: 'wooden_sword', name: 'Wooden Sword', color: '#a8814d', category: 'tool', tier: 1, toolType: 'sword' },
  'stone_sword': { id: 'stone_sword', name: 'Stone Sword', color: '#787878', category: 'tool', tier: 2, toolType: 'sword' },
  'iron_sword': { id: 'iron_sword', name: 'Iron Sword', color: '#e0e0e0', category: 'tool', tier: 3, toolType: 'sword' },
  'diamond_sword': { id: 'diamond_sword', name: 'Diamond Sword', color: '#00e5ff', category: 'tool', tier: 4, toolType: 'sword' },
  'netherite_sword': { id: 'netherite_sword', name: 'Netherite Sword', color: '#4a3b32', category: 'tool', tier: 5, toolType: 'sword' },

  'bow': { id: 'bow', name: 'Bow', color: '#854d0e', category: 'tool', tier: 2 },
  'arrow': { id: 'arrow', name: 'Arrow', color: '#e5e7eb', category: 'material' },
  'fishing_rod': { id: 'fishing_rod', name: 'Fishing Rod', color: '#a8814d', category: 'tool' },
  'totem': { id: 'totem', name: 'Totem of Undying', color: '#eab308', category: 'material' },
  'shield': { id: 'shield', name: 'Wooden Shield', color: '#a8814d', category: 'tool' },
  'trident': { id: 'trident', name: 'Trident', color: '#06b6d4', category: 'tool', tier: 4 },
  'elytra': { id: 'elytra', name: 'Elytra Wings', color: '#a855f7', category: 'armor', armorSlot: 'chestplate', armorValue: 4 },

  // Potions
  'potion_healing': { id: 'potion_healing', name: 'Potion of Healing', color: '#ef4444', category: 'food', foodValue: 10 },
  'potion_speed': { id: 'potion_speed', name: 'Potion of Swiftness', color: '#3b82f6', category: 'food', foodValue: 4 },

  // Armor
  'iron_helmet': { id: 'iron_helmet', name: 'Iron Helmet', color: '#e0e0e0', category: 'armor', armorValue: 3, armorSlot: 'helmet' },
  'iron_chestplate': { id: 'iron_chestplate', name: 'Iron Chestplate', color: '#e0e0e0', category: 'armor', armorValue: 8, armorSlot: 'chestplate' },
  'iron_leggings': { id: 'iron_leggings', name: 'Iron Leggings', color: '#e0e0e0', category: 'armor', armorValue: 6, armorSlot: 'leggings' },
  'iron_boots': { id: 'iron_boots', name: 'Iron Boots', color: '#e0e0e0', category: 'armor', armorValue: 3, armorSlot: 'boots' },

  // Food
  'apple': { id: 'apple', name: 'Apple', color: '#ef4444', category: 'food', foodValue: 4 },
  'raw_beef': { id: 'raw_beef', name: 'Raw Beef', color: '#b91c1c', category: 'food', foodValue: 3 },
  'cooked_beef': { id: 'cooked_beef', name: 'Steak', color: '#78350f', category: 'food', foodValue: 8 },
  'raw_pork': { id: 'raw_pork', name: 'Raw Porkchop', color: '#f43f5e', category: 'food', foodValue: 3 },
  'cooked_pork': { id: 'cooked_pork', name: 'Cooked Porkchop', color: '#9a3412', category: 'food', foodValue: 8 },
  'raw_chicken': { id: 'raw_chicken', name: 'Raw Chicken', color: '#fca5a5', category: 'food', foodValue: 2 },
  'cooked_chicken': { id: 'cooked_chicken', name: 'Cooked Chicken', color: '#c2410c', category: 'food', foodValue: 6 }
};

// Map BlockType enum to Item ID string
export function blockTypeToItemId(type: BlockType): string {
  for (const item of Object.values(ITEM_REGISTRY)) {
    if (item.blockType === type) return item.id;
  }
  return 'dirt';
}

export const VoxelGame: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Game Settings & State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSurvival, setIsSurvival] = useState(true);
  const [fps, setFps] = useState(60);
  const [playerPosition, setPlayerPosition] = useState({ x: 48, y: 25, z: 48 });
  const [isFlying, setIsFlying] = useState(false);
  const [isCrouching, setIsCrouching] = useState(false);
  const [isSprinting, setIsSprinting] = useState(false);
  const [isAutoWalk, setIsAutoWalk] = useState(false);
  const [showTouchDpad, setShowTouchDpad] = useState(false);
  const [isInWater, setIsInWater] = useState(false);
  const [blockCount, setBlockCount] = useState(0);

  // Survival Stats & Progression
  const [health, setHealth] = useState(20); // 10 Hearts = 20 HP
  const [hunger, setHunger] = useState(20); // 10 Drumsticks = 20 Hunger
  const [xp, setXp] = useState(140);
  const [xpLevel, setXpLevel] = useState(7);

  // Dimension & Weather Environment
  const [dimension, setDimension] = useState<'overworld' | 'nether' | 'end'>('overworld');
  const [weather, setWeather] = useState<'clear' | 'rain' | 'thunder'>('clear');

  // Day / Night Cycle
  const [timeOfDay, setTimeOfDay] = useState(12); // 0 to 24 hours
  const [timeSpeed, setTimeSpeed] = useState(0.02); // hours per second
  const [isTimePaused, setIsTimePaused] = useState(false);

  // Sound FX toggle
  const [audioEnabled, setAudioEnabled] = useState(true);

  // Pointer Lock & Camera control state
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  // Debug & PraConnect Room Integration UI States
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; x: number; sender: string }[]>([]);

  const triggerReaction = (emoji: string) => {
    const id = Math.random().toString();
    const x = 60 + Math.random() * 25;
    setReactions((prev) => [...prev, { id, emoji, x, sender: 'You' }]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2800);
  };

  // UI Modals & Compendium
  const [activeModal, setActiveModal] = useState<
    'none' | 'inventory' | 'crafting_table' | 'furnace' | 'chest' | 'death' | 'enchanting' | 'anvil' | 'smithing' | 'brewing' | 'trading'
  >('none');
  const [isCompendiumOpen, setIsCompendiumOpen] = useState(false);
  const [containerCoord, setContainerCoord] = useState<string | null>(null);
  const [targetedBlockInfo, setTargetedBlockInfo] = useState<string | null>(null);

  // Hotbar & Main Inventory Storage Grids
  const [hotbar, setHotbar] = useState<(ItemStack | null)[]>([
    { id: 'wooden_pickaxe', count: 1 },
    { id: 'wooden_sword', count: 1 },
    { id: 'wood', count: 16 },
    { id: 'cobblestone', count: 32 },
    { id: 'torch', count: 16 },
    { id: 'crafting_table', count: 1 },
    { id: 'furnace', count: 1 },
    { id: 'chest', count: 1 },
    { id: 'cooked_beef', count: 8 }
  ]);
  const [activeSlot, setActiveSlot] = useState(0);

  const [inventorySlots, setInventorySlots] = useState<(ItemStack | null)[]>(
    Array(27).fill(null)
  );

  // Armor Equipment Slots
  const [armorSlots, setArmorSlots] = useState<{
    helmet: ItemStack | null;
    chestplate: ItemStack | null;
    leggings: ItemStack | null;
    boots: ItemStack | null;
  }>({ helmet: null, chestplate: null, leggings: null, boots: null });

  // Crafting Grids
  const [craft2x2, setCraft2x2] = useState<(ItemStack | null)[]>(Array(4).fill(null));
  const [craft3x3, setCraft3x3] = useState<(ItemStack | null)[]>(Array(9).fill(null));

  // Containers State: Chests & Furnaces
  const [chestsData, setChestsData] = useState<Record<string, (ItemStack | null)[]>>({});
  const [furnacesData, setFurnacesData] = useState<Record<string, {
    input: ItemStack | null;
    fuel: ItemStack | null;
    output: ItemStack | null;
    cookProgress: number;
    burnTime: number;
  }>>({});

  // Mouse Cursor Dragging Stack
  const [cursorStack, setCursorStack] = useState<ItemStack | null>(null);

  // World Generation Settings
  const [worldSize] = useState<96 | 64>(96);
  const [seaLevel] = useState(10);

  // Engine Refs
  const engineRef = useRef<VoxelEngine | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const worldGroupRef = useRef<THREE.Group | null>(null);
  const wireframeRef = useRef<THREE.LineSegments | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);

  // Mob entities group
  const mobsGroupRef = useRef<THREE.Group | null>(null);
  const mobsDataRef = useRef<{
    mesh: THREE.Group;
    type: 'cow' | 'pig' | 'chicken' | 'zombie' | 'skeleton';
    isHostile: boolean;
    hp: number;
    vel: THREE.Vector3;
  }[]>([]);

  // Player physics state
  const playerRef = useRef({
    pos: new THREE.Vector3(48, 25, 48),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    isGrounded: false,
    isFlying: false,
    isSneaking: false,
    lastGroundY: 25
  });

  const keysRef = useRef<Record<string, boolean>>({});
  const activeSlotRef = useRef(activeSlot);
  activeSlotRef.current = activeSlot;

  const hotbarRef = useRef(hotbar);
  hotbarRef.current = hotbar;

  const timeOfDayRef = useRef(timeOfDay);
  timeOfDayRef.current = timeOfDay;

  const timeSpeedRef = useRef(timeSpeed);
  timeSpeedRef.current = timeSpeed;

  const isTimePausedRef = useRef(isTimePaused);
  isTimePausedRef.current = isTimePaused;

  const dimensionRef = useRef(dimension);
  dimensionRef.current = dimension;

  const weatherRef = useRef(weather);
  weatherRef.current = weather;

  const isAutoWalkRef = useRef(isAutoWalk);
  isAutoWalkRef.current = isAutoWalk;

  const touchMoveRef = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sprint: false
  });

  const walkTimerRef = useRef(0);
  const stepTriggeredRef = useRef(false);

  sfx.enabled = audioEnabled;

  // Add Item to Inventory or Hotbar
  const addItemToInventory = (itemId: string, count = 1) => {
    // 1. Try stacking into existing hotbar / inventory
    let remaining = count;

    setHotbar((prev) => {
      const next = [...prev];
      for (let i = 0; i < next.length; i++) {
        if (next[i] && next[i]!.id === itemId) {
          next[i] = { id: itemId, count: next[i]!.count + remaining };
          remaining = 0;
          break;
        }
      }
      if (remaining > 0) {
        for (let i = 0; i < next.length; i++) {
          if (!next[i]) {
            next[i] = { id: itemId, count: remaining };
            remaining = 0;
            break;
          }
        }
      }
      return next;
    });

    if (remaining > 0) {
      setInventorySlots((prev) => {
        const next = [...prev];
        for (let i = 0; i < next.length; i++) {
          if (next[i] && next[i]!.id === itemId) {
            next[i] = { id: itemId, count: next[i]!.count + remaining };
            remaining = 0;
            break;
          }
        }
        if (remaining > 0) {
          for (let i = 0; i < next.length; i++) {
            if (!next[i]) {
              next[i] = { id: itemId, count: remaining };
              remaining = 0;
              break;
            }
          }
        }
        return next;
      });
    }
  };

  // Calculate Total Armor Rating
  const getTotalArmor = () => {
    let total = 0;
    if (armorSlots.helmet) total += ITEM_REGISTRY[armorSlots.helmet.id]?.armorValue || 0;
    if (armorSlots.chestplate) total += ITEM_REGISTRY[armorSlots.chestplate.id]?.armorValue || 0;
    if (armorSlots.leggings) total += ITEM_REGISTRY[armorSlots.leggings.id]?.armorValue || 0;
    if (armorSlots.boots) total += ITEM_REGISTRY[armorSlots.boots.id]?.armorValue || 0;
    return total;
  };

  // Initialize Three.js Engine & Voxel World
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#87ceeb');
    scene.fog = new THREE.FogExp2('#87ceeb', 0.015);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 600);
    camera.rotation.order = 'YXZ';
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 0.95);
    sunLight.position.set(50, 100, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    const starsGeom = new THREE.BufferGeometry();
    const starCoords: number[] = [];
    for (let i = 0; i < 400; i++) {
      starCoords.push(
        (Math.random() - 0.5) * 600,
        Math.random() * 200 + 50,
        (Math.random() - 0.5) * 600
      );
    }
    starsGeom.setAttribute('position', new THREE.Float32BufferAttribute(starCoords, 3));
    const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, transparent: true, opacity: 0 });
    const starField = new THREE.Points(starsGeom, starsMat);
    scene.add(starField);

    // 3D Voxel Celestial Bodies (Sun & Moon)
    const celestialGroup = new THREE.Group();

    // Voxel Sun
    const sunBoxGeom = new THREE.BoxGeometry(18, 18, 18);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffea00 });
    const sunMesh = new THREE.Mesh(sunBoxGeom, sunMat);
    const sunGlowGeom = new THREE.BoxGeometry(24, 24, 24);
    const sunGlowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.35 });
    const sunGlowMesh = new THREE.Mesh(sunGlowGeom, sunGlowMat);
    const sunGroup = new THREE.Group();
    sunGroup.add(sunMesh);
    sunGroup.add(sunGlowMesh);
    celestialGroup.add(sunGroup);

    // Voxel Moon
    const moonBoxGeom = new THREE.BoxGeometry(16, 16, 16);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    const moonMesh = new THREE.Mesh(moonBoxGeom, moonMat);
    const moonGlowGeom = new THREE.BoxGeometry(20, 20, 20);
    const moonGlowMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.25 });
    const moonGlowMesh = new THREE.Mesh(moonGlowGeom, moonGlowMat);
    const moonGroup = new THREE.Group();
    moonGroup.add(moonMesh);
    moonGroup.add(moonGlowMesh);
    celestialGroup.add(moonGroup);

    scene.add(celestialGroup);

    const wireframeGeom = new THREE.BoxGeometry(1.01, 1.01, 1.01);
    const wireframeMat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
    const wireframeBox = new THREE.LineSegments(new THREE.EdgesGeometry(wireframeGeom), wireframeMat);
    wireframeBox.visible = false;
    scene.add(wireframeBox);
    wireframeRef.current = wireframeBox;

    const engine = new VoxelEngine(worldSize, 40, worldSize, seaLevel);
    engineRef.current = engine;

    const worldMesh = engine.generateMesh();
    scene.add(worldMesh);
    worldGroupRef.current = worldMesh;

    let count = 0;
    for (let i = 0; i < engine.voxels.length; i++) {
      if (engine.voxels[i] !== BlockType.AIR) count++;
    }
    setBlockCount(count);

    const mobsGroup = new THREE.Group();
    scene.add(mobsGroup);
    mobsGroupRef.current = mobsGroup;
    spawnMobs(mobsGroup, worldSize, seaLevel);

    // Safely spawn player on top of highest surface block at center
    const spawnX = Math.floor(worldSize / 2);
    const spawnZ = Math.floor(worldSize / 2);
    let topY = 12;
    for (let y = engine.sizeY - 1; y >= 0; y--) {
      if (engine.isSolid(spawnX, y, spawnZ) || engine.getBlock(spawnX, y, spawnZ) !== BlockType.AIR) {
        topY = y;
        break;
      }
    }
    const spawnY = topY + 2.62;
    playerRef.current.pos.set(spawnX + 0.5, spawnY, spawnZ + 0.5);
    playerRef.current.vel.set(0, 0, 0);
    camera.position.copy(playerRef.current.pos);

    // Pointer Lock change listener
    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === canvasRef.current;
      setIsPointerLocked(locked);
    };
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    // Controls
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;

      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        setActiveSlot(num - 1);
      }

      if (e.code === 'KeyF') {
        playerRef.current.isFlying = !playerRef.current.isFlying;
        setIsFlying(playerRef.current.isFlying);
      }

      if (e.code === 'KeyE') {
        setActiveModal((prev) => (prev === 'none' ? 'inventory' : 'none'));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) setActiveSlot((prev) => (prev + 1) % 9);
      else setActiveSlot((prev) => (prev + 8) % 9);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvasRef.current) return;
      const sensitivity = 0.0022;
      playerRef.current.yaw -= e.movementX * sensitivity;
      playerRef.current.pitch -= e.movementY * sensitivity;
      const maxPitch = (89 * Math.PI) / 180;
      playerRef.current.pitch = Math.max(-maxPitch, Math.min(maxPitch, playerRef.current.pitch));
    };

    const raycaster = new THREE.Raycaster();

    const handleMouseDown = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvasRef.current || !engineRef.current || !sceneRef.current) return;

      // First check if clicking a Mob
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      if (mobsGroupRef.current) {
        const mobHits = raycaster.intersectObjects(mobsGroupRef.current.children, true);
        if (mobHits.length > 0 && mobHits[0].distance < 4.5) {
          const hitObj = mobHits[0].object;
          let parentGroup: THREE.Object3D | null = hitObj;
          while (parentGroup && !mobsDataRef.current.some(m => m.mesh === parentGroup)) {
            parentGroup = parentGroup.parent;
          }
          if (parentGroup) {
            const mobIndex = mobsDataRef.current.findIndex(m => m.mesh === parentGroup);
            if (mobIndex !== -1) {
              const mob = mobsDataRef.current[mobIndex];
              const heldStack = hotbarRef.current[activeSlotRef.current];
              const heldItem = heldStack ? ITEM_REGISTRY[heldStack.id] : null;

              let hitDamage = 2; // Hand base
              if (heldItem?.toolType === 'sword') hitDamage = (heldItem.tier || 1) * 3 + 3;
              else if (heldItem?.toolType === 'pickaxe') hitDamage = (heldItem.tier || 1) * 2 + 1;

              mob.hp -= hitDamage;
              sfx.playHit();

              // Knockback
              const kbDir = mob.mesh.position.clone().sub(playerRef.current.pos).setY(0).normalize();
              mob.mesh.position.addScaledVector(kbDir, 0.6);

              if (mob.hp <= 0) {
                // Mob Death & Drops
                mobsGroupRef.current.remove(mob.mesh);
                mobsDataRef.current.splice(mobIndex, 1);

                if (mob.type === 'cow') {
                  addItemToInventory('raw_beef', 2);
                  addItemToInventory('leather', 1);
                } else if (mob.type === 'pig') {
                  addItemToInventory('raw_pork', 2);
                } else if (mob.type === 'chicken') {
                  addItemToInventory('raw_chicken', 1);
                  addItemToInventory('feather', 1);
                } else if (mob.type === 'zombie') {
                  addItemToInventory('rotten_flesh', 1);
                  if (Math.random() < 0.2) addItemToInventory('iron_ingot', 1);
                } else if (mob.type === 'skeleton') {
                  addItemToInventory('bone', 1);
                  addItemToInventory('string', 1);
                }
              }
              return;
            }
          }
        }
      }

      // Check Block Placement / Breaking
      if (!worldGroupRef.current) return;
      const intersects = raycaster.intersectObjects(worldGroupRef.current.children);

      if (intersects.length > 0 && intersects[0].distance < 7.5) {
        const hit = intersects[0];
        const normal = hit.face?.normal || new THREE.Vector3(0, 1, 0);

        const p = hit.point.clone().addScaledVector(normal, -0.01);
        const bx = Math.floor(p.x);
        const by = Math.floor(p.y);
        const bz = Math.floor(p.z);

        if (e.button === 0) {
          // Break Block with Tool Tier Mining Rules
          const brokenBlockType = engineRef.current.getBlock(bx, by, bz);
          const heldStack = hotbarRef.current[activeSlotRef.current];
          const heldItem = heldStack ? ITEM_REGISTRY[heldStack.id] : null;
          const toolTier = heldItem?.toolType === 'pickaxe' ? (heldItem.tier || 0) : 0;

          let canHarvest = true;
          if (brokenBlockType === BlockType.ORE_IRON && toolTier < 2) canHarvest = false; // Req Stone Pick+
          if (brokenBlockType === BlockType.ORE_GOLD && toolTier < 3) canHarvest = false; // Req Iron Pick+
          if (brokenBlockType === BlockType.ORE_DIAMOND && toolTier < 3) canHarvest = false; // Req Iron Pick+

          if (engineRef.current.setBlock(bx, by, bz, BlockType.AIR)) {
            sfx.playBreak();
            rebuildWorldMesh();

            if (canHarvest) {
              if (brokenBlockType === BlockType.STONE) addItemToInventory('cobblestone', 1);
              else if (brokenBlockType === BlockType.ORE_COAL) addItemToInventory('coal', 1);
              else if (brokenBlockType === BlockType.ORE_IRON) addItemToInventory('raw_iron', 1);
              else if (brokenBlockType === BlockType.ORE_GOLD) addItemToInventory('raw_gold', 1);
              else if (brokenBlockType === BlockType.ORE_DIAMOND) addItemToInventory('diamond', 1);
              else if (brokenBlockType === BlockType.LEAVES) {
                if (Math.random() < 0.25) addItemToInventory('apple', 1);
              } else {
                const dropId = blockTypeToItemId(brokenBlockType);
                addItemToInventory(dropId, 1);
              }
            }
          }
        } else if (e.button === 2) {
          // Right-click Block Interaction or Placement
          const targetType = engineRef.current.getBlock(bx, by, bz);
          const heldStack = hotbarRef.current[activeSlotRef.current];
          const heldItem = heldStack ? ITEM_REGISTRY[heldStack.id] : null;

          // Check if holding Food -> Eat Food
          if (heldItem?.category === 'food') {
            setHunger((prev) => Math.min(20, prev + (heldItem.foodValue || 4)));
            setHealth((prev) => Math.min(20, prev + 2));
            sfx.playEat();

            // Consume 1 item
            setHotbar((prev) => {
              const next = [...prev];
              if (next[activeSlotRef.current]) {
                const count = next[activeSlotRef.current]!.count - 1;
                if (count <= 0) next[activeSlotRef.current] = null;
                else next[activeSlotRef.current]!.count = count;
              }
              return next;
            });
            return;
          }

          // Container Interactions
          const coordKey = `${bx}_${by}_${bz}`;

          if (targetType === BlockType.CRAFTING_TABLE) {
            setActiveModal('crafting_table');
            sfx.playClick();
            return;
          }

          if (targetType === BlockType.FURNACE) {
            setContainerCoord(coordKey);
            setActiveModal('furnace');
            sfx.playClick();
            return;
          }

          if (targetType === BlockType.CHEST) {
            setContainerCoord(coordKey);
            if (!chestsData[coordKey]) {
              setChestsData((prev) => ({ ...prev, [coordKey]: Array(27).fill(null) }));
            }
            setActiveModal('chest');
            sfx.playClick();
            return;
          }

          if (targetType === BlockType.ANVIL) {
            setActiveModal('anvil');
            sfx.playClick();
            return;
          }

          if (targetType === BlockType.ENCHANTING_TABLE) {
            setActiveModal('enchanting');
            sfx.playClick();
            return;
          }

          if (targetType === BlockType.SMITHING_TABLE) {
            setActiveModal('smithing');
            sfx.playClick();
            return;
          }

          if (targetType === BlockType.BREWING_STAND) {
            setActiveModal('brewing');
            sfx.playClick();
            return;
          }

          if (targetType === BlockType.NOTE_BLOCK || targetType === BlockType.JUKEBOX) {
            sfx.playClick();
            setXp((prev) => prev + 5);
            return;
          }

          if (targetType === BlockType.DOOR || targetType === BlockType.GATE) {
            engineRef.current.setBlock(bx, by, bz, BlockType.AIR);
            rebuildWorldMesh();
            sfx.playClick();
            return;
          }

          if (targetType === BlockType.LEVER) {
            // Toggle Lever & Adjacent Doors
            sfx.playClick();
            for (let dx = -2; dx <= 2; dx++) {
              for (let dy = -2; dy <= 2; dy++) {
                for (let dz = -2; dz <= 2; dz++) {
                  const nb = engineRef.current.getBlock(bx + dx, by + dy, bz + dz);
                  if (nb === BlockType.DOOR || nb === BlockType.GATE) {
                    engineRef.current.setBlock(bx + dx, by + dy, bz + dz, BlockType.AIR);
                  }
                }
              }
            }
            rebuildWorldMesh();
            return;
          }

          if (targetType === BlockType.BED) {
            setTimeOfDay(6.0);
            sfx.playClick();
            return;
          }

          // Place Block
          if (heldItem && heldItem.blockType !== undefined) {
            const nx = bx + Math.round(normal.x);
            const ny = by + Math.round(normal.y);
            const nz = bz + Math.round(normal.z);

            const playerPos = playerRef.current.pos;
            const playerBox = new THREE.Box3(
              new THREE.Vector3(playerPos.x - 0.35, playerPos.y - 1.6, playerPos.z - 0.35),
              new THREE.Vector3(playerPos.x + 0.35, playerPos.y + 0.3, playerPos.z + 0.35)
            );
            const blockBox = new THREE.Box3(
              new THREE.Vector3(nx, ny, nz),
              new THREE.Vector3(nx + 1, ny + 1, nz + 1)
            );

            if (!playerBox.intersectsBox(blockBox)) {
              if (engineRef.current.setBlock(nx, ny, nz, heldItem.blockType)) {
                sfx.playPlace();
                rebuildWorldMesh();

                // Consume 1 item from hotbar
                setHotbar((prev) => {
                  const next = [...prev];
                  if (next[activeSlotRef.current]) {
                    const count = next[activeSlotRef.current]!.count - 1;
                    if (count <= 0) next[activeSlotRef.current] = null;
                    else next[activeSlotRef.current]!.count = count;
                  }
                  return next;
                });
              }
            }
          }
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWheel);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('contextmenu', handleContextMenu);

    const torchGroupRef = { current: null as THREE.Group | null };

    const rebuildWorldMesh = () => {
      if (!engineRef.current || !sceneRef.current) return;
      if (worldGroupRef.current) sceneRef.current.remove(worldGroupRef.current);
      if (torchGroupRef.current) sceneRef.current.remove(torchGroupRef.current);

      const newMesh = engineRef.current.generateMesh();
      sceneRef.current.add(newMesh);
      worldGroupRef.current = newMesh;

      const torchGroup = new THREE.Group();
      const eng = engineRef.current;
      for (let x = 0; x < eng.sizeX; x++) {
        for (let y = 0; y < eng.sizeY; y++) {
          for (let z = 0; z < eng.sizeZ; z++) {
            if (eng.getBlock(x, y, z) === BlockType.TORCH) {
              const torchLight = new THREE.PointLight(0xffaa22, 2.0, 12);
              torchLight.position.set(x + 0.5, y + 0.8, z + 0.5);
              torchGroup.add(torchLight);
            }
          }
        }
      }
      sceneRef.current.add(torchGroup);
      torchGroupRef.current = torchGroup;

      let c = 0;
      for (let i = 0; i < engineRef.current.voxels.length; i++) {
        if (engineRef.current.voxels[i] !== BlockType.AIR) c++;
      }
      setBlockCount(c);
    };

    // Main Game Loop
    let lastTime = performance.now();
    let frameCounter = 0;
    let fpsTimer = performance.now();
    let animId: number;
    let currTimeOfDay = timeOfDay;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.08);
      lastTime = now;

      frameCounter++;
      if (now - fpsTimer > 1000) {
        setFps(frameCounter);
        frameCounter = 0;
        fpsTimer = now;
      }

      if (!isTimePausedRef.current) {
        timeOfDayRef.current = (timeOfDayRef.current + timeSpeedRef.current * dt) % 24;
        if (timeOfDayRef.current < 0) timeOfDayRef.current += 24;
        setTimeOfDay(timeOfDayRef.current);
      } else {
        timeOfDayRef.current = timeOfDay;
      }

      const currTime = timeOfDayRef.current;
      const sunAngle = ((currTime - 6) / 24) * Math.PI * 2;
      const orbitRadius = 240;
      const centerX = worldSize / 2;
      const centerZ = worldSize / 2;

      const sunX = centerX + Math.cos(sunAngle) * orbitRadius;
      const sunY = 15 + Math.sin(sunAngle) * orbitRadius;
      const sunZ = centerZ + Math.sin(sunAngle * 0.2) * 40;
      sunGroup.position.set(sunX, sunY, sunZ);

      const moonAngle = sunAngle + Math.PI;
      const moonX = centerX + Math.cos(moonAngle) * orbitRadius;
      const moonY = 15 + Math.sin(moonAngle) * orbitRadius;
      const moonZ = centerZ + Math.sin(moonAngle * 0.2) * 40;
      moonGroup.position.set(moonX, moonY, moonZ);

      if (sunLightRef.current) {
        if (sunY > -10) {
          sunLightRef.current.position.set(sunX, Math.max(sunY, 15), sunZ);
        } else {
          sunLightRef.current.position.set(moonX, Math.max(moonY, 15), moonZ);
        }
      }

      const env = getSkyParameters(currTime, dimensionRef.current, weatherRef.current);

      if (sceneRef.current) {
        sceneRef.current.background = new THREE.Color(env.sky);
        if (sceneRef.current.fog) {
          sceneRef.current.fog.color = new THREE.Color(env.fog);
          if ('density' in sceneRef.current.fog) {
            (sceneRef.current.fog as THREE.FogExp2).density = env.fogDensity;
          }
        }
      }

      if (ambientLightRef.current) {
        ambientLightRef.current.color = new THREE.Color(env.ambientColor);
        ambientLightRef.current.intensity = env.ambientIntensity;
      }

      if (sunLightRef.current) {
        sunLightRef.current.color = new THREE.Color(env.sunColor);
        sunLightRef.current.intensity = env.sunIntensity;
      }

      if (starsMat) {
        starsMat.opacity = env.starsOpacity;
      }

      const keys = keysRef.current;
      const player = playerRef.current;

      const isCrouchingKey = keys['ShiftLeft'] || keys['ShiftRight'] || keys['KeyC'];
      const isSprintKey = (keys['ControlLeft'] || keys['ControlRight'] || keys['KeyR'] || touchMoveRef.current.sprint) && !isCrouchingKey;
      const isForwardInput = keys['KeyW'] || keys['ArrowUp'] || touchMoveRef.current.forward || isAutoWalkRef.current;
      const isBackwardInput = keys['KeyS'] || keys['ArrowDown'] || touchMoveRef.current.backward;
      const isLeftInput = keys['KeyA'] || keys['ArrowLeft'] || touchMoveRef.current.left;
      const isRightInput = keys['KeyD'] || keys['ArrowRight'] || touchMoveRef.current.right;
      const isJumpInput = keys['Space'] || touchMoveRef.current.jump;

      setIsCrouching(isCrouchingKey);
      setIsSprinting(isSprintKey && isForwardInput);

      // Camera facing vectors on horizontal plane (XZ)
      const forwardX = -Math.sin(player.yaw);
      const forwardZ = -Math.cos(player.yaw);
      const rightX = Math.cos(player.yaw);
      const rightZ = -Math.sin(player.yaw);

      let dirX = 0;
      let dirZ = 0;
      if (isForwardInput) { dirX += forwardX; dirZ += forwardZ; }
      if (isBackwardInput) { dirX -= forwardX; dirZ -= forwardZ; }
      if (isRightInput) { dirX += rightX; dirZ += rightZ; }
      if (isLeftInput) { dirX -= rightX; dirZ -= rightZ; }

      const inputLen = Math.hypot(dirX, dirZ);
      if (inputLen > 0.0001) {
        dirX /= inputLen;
        dirZ /= inputLen;
      }

      let speed = 5.5; // Walking speed (5.5 m/s)
      if (isSprintKey) speed = 8.5; // Sprinting speed (8.5 m/s)
      if (isCrouchingKey) speed = 2.5; // Sneaking speed (2.5 m/s)

      const targetVelX = dirX * speed;
      const targetVelZ = dirZ * speed;

      // Smooth acceleration/deceleration
      const accel = player.isGrounded ? 16.0 : 6.0;
      player.vel.x += (targetVelX - player.vel.x) * Math.min(1, accel * dt);
      player.vel.z += (targetVelZ - player.vel.z) * Math.min(1, accel * dt);

      const engine = engineRef.current;
      const eyeHeight = isCrouchingKey ? 1.4 : 1.62;
      const px = Math.floor(player.pos.x);
      const py = Math.floor(player.pos.y - eyeHeight);
      const pz = Math.floor(player.pos.z);

      const playerInWater = engine ? engine.getBlock(px, py, pz) === BlockType.WATER : false;
      const playerOnLadder = engine ? engine.getBlock(px, py, pz) === BlockType.LADDER : false;
      setIsInWater(playerInWater);

      if (player.isFlying) {
        player.vel.x = targetVelX;
        player.vel.z = targetVelZ;
        player.vel.y = 0;
        if (isJumpInput) player.vel.y = speed;
        if (keys['ShiftLeft'] || keys['ShiftRight']) player.vel.y = -speed;
      } else if (playerOnLadder) {
        player.vel.x = targetVelX * 0.5;
        player.vel.z = targetVelZ * 0.5;
        player.vel.y = 0;
        if (isForwardInput || isJumpInput) player.vel.y = 4.0;
        if (isBackwardInput) player.vel.y = -4.0;
      } else if (playerInWater) {
        player.vel.x = targetVelX * 0.6;
        player.vel.z = targetVelZ * 0.6;
        player.vel.y = -1.5;
        if (isJumpInput) player.vel.y = 4.0;
      } else {
        player.vel.y -= 24.0 * dt; // Realistic gravity

        if (isJumpInput && player.isGrounded) {
          player.vel.y = 8.5;
          player.isGrounded = false;
          sfx.playJump();
        }
      }

      // Pressure Plate Trigger Logic
      if (engine) {
        const footBlock = engine.getBlock(px, py, pz);
        if (footBlock === BlockType.PRESSURE_PLATE) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              const nb = engine.getBlock(px + dx, py, pz + dz);
              if (nb === BlockType.DOOR || nb === BlockType.GATE) {
                engine.setBlock(px + dx, py, pz + dz, BlockType.AIR);
              }
            }
          }
        }
      }

      // Decoupled Voxel AABB 3D Collision Resolution
      const r = 0.3; // Player collision radius
      const headHeight = 0.18;

      if (engine && !player.isFlying) {
        // 1. Resolve Vertical (Y) Collision
        const dy = player.vel.y * dt;
        let nextY = player.pos.y + dy;

        if (dy < 0) {
          const feetY = nextY - eyeHeight;
          const minX = Math.floor(player.pos.x - r);
          const maxX = Math.floor(player.pos.x + r);
          const minZ = Math.floor(player.pos.z - r);
          const maxZ = Math.floor(player.pos.z + r);
          const targetBlockY = Math.floor(feetY);

          let hitFloor = false;
          for (let bx = minX; bx <= maxX; bx++) {
            for (let bz = minZ; bz <= maxZ; bz++) {
              if (engine.isSolid(bx, targetBlockY, bz)) {
                hitFloor = true;
                break;
              }
            }
            if (hitFloor) break;
          }

          if (hitFloor) {
            nextY = targetBlockY + 1 + eyeHeight;
            if (!player.isGrounded && isSurvival) {
              const fallDist = player.lastGroundY - nextY;
              if (fallDist > 4.0) {
                const rawDamage = Math.floor((fallDist - 3) * 3);
                const armor = getTotalArmor();
                const finalDamage = Math.max(1, Math.floor(rawDamage * (1 - armor / 25)));

                setHealth((h) => {
                  const nh = Math.max(0, h - finalDamage);
                  if (finalDamage > 0) sfx.playHurt();
                  if (nh <= 0) setActiveModal('death');
                  return nh;
                });
              }
            }

            player.vel.y = 0;
            player.isGrounded = true;
            player.lastGroundY = nextY;
          } else {
            player.isGrounded = false;
          }
        } else if (dy > 0) {
          const topY = nextY + headHeight;
          const minX = Math.floor(player.pos.x - r);
          const maxX = Math.floor(player.pos.x + r);
          const minZ = Math.floor(player.pos.z - r);
          const maxZ = Math.floor(player.pos.z + r);
          const targetBlockY = Math.floor(topY);

          let hitCeiling = false;
          for (let bx = minX; bx <= maxX; bx++) {
            for (let bz = minZ; bz <= maxZ; bz++) {
              if (engine.isSolid(bx, targetBlockY, bz)) {
                hitCeiling = true;
                break;
              }
            }
            if (hitCeiling) break;
          }

          if (hitCeiling) {
            nextY = targetBlockY - headHeight - 0.01;
            player.vel.y = 0;
          }
          player.isGrounded = false;
        }
        player.pos.y = nextY;

        // 2. Auto-Step Up logic (1-block height)
        const dx = player.vel.x * dt;
        const dz = player.vel.z * dt;
        if (player.isGrounded && (Math.abs(dx) > 0.0001 || Math.abs(dz) > 0.0001)) {
          const checkX = Math.floor(player.pos.x + (dx > 0 ? r + 0.05 : -r - 0.05));
          const checkZ = Math.floor(player.pos.z + (dz > 0 ? r + 0.05 : -r - 0.05));
          const currFeetBlockY = Math.floor(player.pos.y - eyeHeight);

          const stepBlockSolid = engine.isSolid(checkX, currFeetBlockY, checkZ);
          const spaceAbove1Clear = !engine.isSolid(checkX, currFeetBlockY + 1, checkZ);
          const spaceAbove2Clear = !engine.isSolid(checkX, currFeetBlockY + 2, checkZ);

          if (stepBlockSolid && spaceAbove1Clear && spaceAbove2Clear) {
            player.pos.y = currFeetBlockY + 1 + 1.0 + eyeHeight;
          }
        }

        // 3. Resolve Horizontal Movement (X axis)
        if (Math.abs(dx) > 0.0001) {
          let nextX = player.pos.x + dx;
          const checkX = dx > 0 ? Math.floor(nextX + r) : Math.floor(nextX - r);
          const minFootY = Math.floor(player.pos.y - eyeHeight + 0.1);
          const maxHeadY = Math.floor(player.pos.y + headHeight - 0.05);
          const minZ = Math.floor(player.pos.z - r);
          const maxZ = Math.floor(player.pos.z + r);

          let hitWallX = false;
          for (let by = minFootY; by <= maxHeadY; by++) {
            for (let bz = minZ; bz <= maxZ; bz++) {
              if (engine.isSolid(checkX, by, bz)) {
                hitWallX = true;
                break;
              }
            }
            if (hitWallX) break;
          }

          if (hitWallX) {
            player.vel.x = 0;
            nextX = dx > 0 ? checkX - r - 0.001 : checkX + 1 + r + 0.001;
          }
          player.pos.x = nextX;
        }

        // 4. Resolve Horizontal Movement (Z axis)
        if (Math.abs(dz) > 0.0001) {
          let nextZ = player.pos.z + dz;
          const checkZ = dz > 0 ? Math.floor(nextZ + r) : Math.floor(nextZ - r);
          const minFootY = Math.floor(player.pos.y - eyeHeight + 0.1);
          const maxHeadY = Math.floor(player.pos.y + headHeight - 0.05);
          const minX = Math.floor(player.pos.x - r);
          const maxX = Math.floor(player.pos.x + r);

          let hitWallZ = false;
          for (let by = minFootY; by <= maxHeadY; by++) {
            for (let bx = minX; bx <= maxX; bx++) {
              if (engine.isSolid(bx, by, checkZ)) {
                hitWallZ = true;
                break;
              }
            }
            if (hitWallZ) break;
          }

          if (hitWallZ) {
            player.vel.z = 0;
            nextZ = dz > 0 ? checkZ - r - 0.001 : checkZ + 1 + r + 0.001;
          }
          player.pos.z = nextZ;
        }
      } else {
        player.pos.addScaledVector(player.vel, dt);
      }

      // Walk camera head bobbing & footstep audio effect
      let headBobOffset = 0;
      if ((Math.abs(player.vel.x) > 0.1 || Math.abs(player.vel.z) > 0.1) && player.isGrounded && !player.isFlying) {
        walkTimerRef.current += dt * (isSprintKey ? 13 : isCrouchingKey ? 6 : 9);
        headBobOffset = Math.sin(walkTimerRef.current) * (isSprintKey ? 0.08 : 0.04);

        if (Math.sin(walkTimerRef.current) < -0.85) {
          if (!stepTriggeredRef.current) {
            sfx.playFootstep();
            stepTriggeredRef.current = true;
          }
        } else {
          stepTriggeredRef.current = false;
        }
      }

      camera.position.copy(player.pos);
      camera.position.y += headBobOffset;
      camera.rotation.set(0, 0, 0);
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;

      if (engineRef.current && worldGroupRef.current) {
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const intersects = raycaster.intersectObjects(worldGroupRef.current.children);

        if (intersects.length > 0 && intersects[0].distance < 7.5) {
          const hit = intersects[0];
          const normal = hit.face?.normal || new THREE.Vector3(0, 1, 0);
          const p = hit.point.clone().addScaledVector(normal, -0.01);
          const bx = Math.floor(p.x);
          const by = Math.floor(p.y);
          const bz = Math.floor(p.z);

          const blockType = engineRef.current.getBlock(bx, by, bz);
          const config = BLOCK_CONFIGS[blockType];

          if (wireframeRef.current) {
            wireframeRef.current.position.set(bx + 0.5, by + 0.5, bz + 0.5);
            wireframeRef.current.visible = true;
          }
          setTargetedBlockInfo(`${config?.name || 'Block'} (${bx}, ${by}, ${bz})`);
        } else {
          if (wireframeRef.current) wireframeRef.current.visible = false;
          setTargetedBlockInfo(null);
        }
      }

      const isNightTime = currTime < 5.5 || currTime > 18.5;
      updateMobsAI(player.pos, isNightTime);

      setPlayerPosition({
        x: Math.floor(player.pos.x),
        y: Math.floor(player.pos.y),
        z: Math.floor(player.pos.z)
      });

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth || window.innerWidth;
      const h = containerRef.current.clientHeight || window.innerHeight;
      if (w > 0 && h > 0) {
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(w, h, false);
      }
    };

    // Call resize once immediately on load
    handleResize();

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(animId);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('contextmenu', handleContextMenu);
      resizeObserver.disconnect();
      renderer.dispose();
    };
  }, [worldSize, seaLevel, isSurvival]);

  // Spawn Mobs (Cow, Pig, Chicken, Zombie, Skeleton)
  const spawnMobs = (mobsGroup: THREE.Group, size: number, sea: number) => {
    mobsGroup.clear();
    mobsDataRef.current = [];

    const mobTypes: ('cow' | 'pig' | 'chicken' | 'zombie' | 'skeleton')[] = [
      'cow', 'cow', 'pig', 'pig', 'chicken', 'chicken', 'zombie', 'zombie', 'skeleton'
    ];

    mobTypes.forEach((t) => {
      const g = new THREE.Group();
      let isHostile = false;
      let hp = 10;

      if (t === 'cow') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.6), new THREE.MeshStandardMaterial({ color: 0x5a3d28 }));
        body.position.y = 0.8;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x3a2518 }));
        head.position.set(0, 1.2, 0.8);
        g.add(body, head);
        hp = 10;
      } else if (t === 'pig') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 1.4), new THREE.MeshStandardMaterial({ color: 0xf43f5e }));
        body.position.y = 0.7;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xfca5a5 }));
        head.position.set(0, 1.0, 0.7);
        g.add(body, head);
        hp = 8;
      } else if (t === 'chicken') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        body.position.y = 0.5;
        g.add(body);
        hp = 4;
      } else if (t === 'zombie') {
        isHostile = true;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x2b6e3f }));
        body.position.y = 1.0;
        g.add(body);
        hp = 20;
      } else if (t === 'skeleton') {
        isHostile = true;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.4), new THREE.MeshStandardMaterial({ color: 0xe0e0e0 }));
        body.position.y = 1.0;
        g.add(body);
        hp = 12;
      }

      const rx = 10 + Math.random() * (size - 20);
      const rz = 10 + Math.random() * (size - 20);
      g.position.set(rx, sea + 2, rz);
      mobsGroup.add(g);

      mobsDataRef.current.push({ mesh: g, type: t, isHostile, hp, vel: new THREE.Vector3() });
    });
  };

  // Mob AI Logic
  const updateMobsAI = (playerPos: THREE.Vector3, isNight: boolean) => {
    mobsDataRef.current.forEach((mob) => {
      mob.mesh.visible = mob.isHostile ? isNight : true;
      if (!mob.mesh.visible) return;

      const dist = mob.mesh.position.distanceTo(playerPos);

      if (mob.isHostile && dist < 14) {
        const dir = playerPos.clone().sub(mob.mesh.position).setY(0).normalize();
        mob.mesh.position.addScaledVector(dir, mob.type === 'skeleton' ? 0.05 : 0.035);
        mob.mesh.lookAt(playerPos.x, mob.mesh.position.y, playerPos.z);

        if (dist < 1.4 && isSurvival) {
          const armor = getTotalArmor();
          const mobDmg = mob.type === 'zombie' ? 4 : 3;
          const finalDmg = Math.max(1, Math.floor(mobDmg * (1 - armor / 25)));

          setHealth((h) => {
            const nh = Math.max(0, h - finalDmg * 0.05);
            if (Math.random() < 0.05) sfx.playHurt();
            if (nh <= 0) setActiveModal('death');
            return nh;
          });
        }
      } else {
        if (Math.random() < 0.02) {
          mob.vel.set((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.03);
        }
        mob.mesh.position.add(mob.vel);
      }
    });
  };

  const handleStartGame = () => {
    if (canvasRef.current) canvasRef.current.requestPointerLock();
  };

  useEffect(() => {
    const handlePointerLockChange = () => {
      if (document.pointerLockElement === canvasRef.current) setIsPlaying(true);
      else setIsPlaying(false);
    };
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => document.removeEventListener('pointerlockchange', handlePointerLockChange);
  }, []);

  const handleExportHtml = () => {
    const htmlContent = generateSingleFileHtml();
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voxel-sandbox-3d.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Item Slot Component with Click Transfer
  const renderItemSlot = (
    stack: ItemStack | null,
    onSlotClick: () => void,
    label?: string,
    isActive = false,
    key?: string | number
  ) => {
    const itemDef = stack ? ITEM_REGISTRY[stack.id] : null;

    return (
      <button
        key={key}
        onClick={onSlotClick}
        className={`relative w-11 h-11 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer group ${
          isActive
            ? 'border-amber-400 bg-amber-500/15 scale-105 shadow-[0_0_12px_rgba(245,158,11,0.25)] ring-1 ring-amber-400/50'
            : 'border-slate-800/80 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-800/60'
        }`}
      >
        {label && <span className="absolute top-1 left-1.5 text-[9px] font-sans font-bold text-slate-500">{label}</span>}
        {itemDef ? (
          <>
            <div className="w-5 h-5 rounded-md shadow-md border border-white/20" style={{ backgroundColor: itemDef.color }} />
            {stack && stack.count > 1 && (
              <span className="absolute bottom-1 right-1.5 text-[10px] font-sans font-extrabold text-amber-300 drop-shadow">
                {stack.count}
              </span>
            )}
            <span className="absolute left-1/2 -translate-x-1/2 -top-8 px-2.5 py-1 bg-slate-950/95 border border-slate-700 rounded-lg text-[11px] font-sans font-semibold text-slate-100 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl">
              {itemDef.name}
            </span>
          </>
        ) : (
          <div className="w-1.5 h-1.5 rounded-full bg-slate-800" />
        )}
      </button>
    );
  };

  const requestPointerLock = () => {
    if (canvasRef.current && document.pointerLockElement !== canvasRef.current) {
      canvasRef.current.requestPointerLock();
    }
  };

  return (
    <div className="relative w-full h-[calc(100vh-100px)] bg-slate-950 rounded-2xl overflow-hidden border border-slate-800/80 shadow-2xl shadow-black/80 select-none font-sans">
      <div ref={containerRef} className="w-full h-full relative" onClick={requestPointerLock}>
        <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair" />

        {/* Pointer Lock "Click to Look Around" Prompt Overlay */}
        {!isPointerLocked && activeModal === 'none' && !isCompendiumOpen && (
          <div className="absolute inset-0 z-30 bg-slate-950/60 backdrop-blur-sm flex flex-col items-center justify-center cursor-pointer group transition-all">
            <div className="bg-slate-900/95 border border-amber-500/40 p-6 rounded-2xl shadow-2xl shadow-amber-500/10 flex flex-col items-center gap-3 text-center transform group-hover:scale-105 transition-all max-w-sm mx-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/60 flex items-center justify-center text-amber-400 text-2xl font-bold animate-bounce shadow-lg shadow-amber-500/20">
                🖱️
              </div>
              <h3 className="text-slate-100 text-lg font-bold font-sans">Click to Look Around</h3>
              <p className="text-slate-300 text-xs leading-relaxed font-sans">
                Click anywhere to engage mouse look. Use <span className="text-amber-300 font-semibold">WASD</span> to walk, <span className="text-amber-300 font-semibold">Space</span> to jump, <span className="text-amber-300 font-semibold">Shift</span> to sneak, and <span className="text-amber-300 font-semibold">ESC</span> to release cursor.
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  requestPointerLock();
                }}
                className="mt-1 px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs rounded-xl shadow-lg shadow-amber-500/20 active:scale-95 transition-all font-sans cursor-pointer"
              >
                Click Viewport to Play
              </button>
            </div>
          </div>
        )}

        {/* Center Crosshair */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 flex items-center justify-center">
          <div className="w-4 h-0.5 bg-white/80 shadow-md" />
          <div className="absolute h-4 w-0.5 bg-white/80 shadow-md" />
        </div>

        {/* HUD Top-Left */}
        <div className="absolute top-4 left-4 z-10 flex flex-col items-start gap-2">
          {/* Shared Room Session Strip */}
          <div className="flex items-center gap-2.5 bg-slate-950/85 backdrop-blur-md border border-slate-800/80 p-1.5 px-3 rounded-2xl shadow-xl text-xs text-slate-200 select-none">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="font-sans font-bold text-slate-200 text-xs">Room Session</span>
            </div>

            {/* Active Session Indicator */}
            <div className="flex items-center gap-1.5 ml-1">
              <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-bold text-emerald-400 font-mono">
                Solo / Room Ready
              </span>
            </div>
          </div>

          {/* Collapsible Debug Panel (OFF by default) */}
          {showDebugOverlay && (
            <div className="bg-slate-950/90 backdrop-blur-md border border-slate-800/80 rounded-2xl p-3.5 text-slate-200 text-xs font-mono space-y-2 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between gap-4">
                <span className="text-emerald-400 font-bold">FPS: {fps}</span>
                <span className="text-sky-300 font-bold">{isSurvival ? (isFlying ? 'FLY MODE' : 'SURVIVAL') : 'CREATIVE'}</span>
              </div>

              <div className="text-slate-300">XYZ: {playerPosition.x}, {playerPosition.y}, {playerPosition.z}</div>
              <div className="text-slate-400">Blocks: {blockCount.toLocaleString()}</div>
              <div className="text-indigo-300">Armor: {getTotalArmor()} / 20</div>
              <div className="text-emerald-300 font-bold border-t border-slate-800 pt-1 flex items-center justify-between">
                <span>Movement:</span>
                <span className="text-amber-400 font-extrabold">
                  {isFlying ? '🪽 Flying' : isSprinting ? '🏃 Sprinting (8.5m/s)' : isCrouching ? '🧘 Sneaking' : isAutoWalk ? '🚶‍♂️ Auto-Walk' : '🚶 Walking (5.5m/s)'}
                </span>
              </div>

              {targetedBlockInfo && (
                <div className="text-amber-400 pt-1 border-t border-slate-800 truncate max-w-[210px]">
                  Target: {targetedBlockInfo}
                </div>
              )}
            </div>
          )}

          {/* Dynamic Day/Night Clock Widget */}
          <DayNightClockWidget
            timeOfDay={timeOfDay}
            timeSpeed={timeSpeed}
            isTimePaused={isTimePaused}
            onSetTimeOfDay={(t) => setTimeOfDay(t)}
            onSetTimeSpeed={(s) => setTimeSpeed(s)}
            onTogglePause={() => setIsTimePaused(!isTimePaused)}
            onSleepInBed={() => {
              setTimeOfDay(6.0);
              sfx.playLevelUp();
            }}
          />
        </div>

        {/* Top-Right Toolbar & Controls */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          {/* Dimension Selector Tabs */}
          <div className="flex items-center gap-1 bg-slate-950/85 backdrop-blur-md border border-slate-800/80 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setDimension('overworld')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer font-sans ${
                dimension === 'overworld' ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
              title="Overworld Dimension"
            >
              Overworld
            </button>
            <button
              onClick={() => setDimension('nether')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer font-sans ${
                dimension === 'nether' ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
              title="Nether Dimension"
            >
              Nether
            </button>
            <button
              onClick={() => setDimension('end')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer font-sans ${
                dimension === 'end' ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
              title="End Dimension"
            >
              The End
            </button>
          </div>

          {/* Auto-Walk Toggle */}
          <button
            onClick={() => setIsAutoWalk(!isAutoWalk)}
            className={`h-8 px-3 rounded-xl border text-xs font-semibold font-sans flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95 ${
              isAutoWalk
                ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                : 'bg-slate-900/80 hover:bg-slate-800/90 border-slate-800 text-slate-300 hover:text-white'
            }`}
            title="Toggle Hands-Free Continuous Auto-Walk Mode"
          >
            <Compass className={`w-3.5 h-3.5 ${isAutoWalk ? 'text-amber-400 animate-spin' : 'text-slate-400'}`} />
            <span>Auto-Walk</span>
          </button>

          {/* Touch D-Pad Controls Toggle */}
          <button
            onClick={() => setShowTouchDpad(!showTouchDpad)}
            className={`h-8 px-3 rounded-xl border text-xs font-semibold font-sans flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95 ${
              showTouchDpad
                ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                : 'bg-slate-900/80 hover:bg-slate-800/90 border-slate-800 text-slate-300 hover:text-white'
            }`}
            title="Toggle On-Screen Touch / D-Pad Walk Controls"
          >
            <Wrench className="w-3.5 h-3.5 text-slate-400" />
            <span>Controls</span>
          </button>

          {/* Inventory */}
          <button
            onClick={() => setActiveModal(activeModal === 'none' ? 'inventory' : 'none')}
            className="h-8 px-3 bg-slate-900/80 hover:bg-slate-800/90 backdrop-blur-md border border-slate-800 text-slate-200 text-xs font-semibold font-sans rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
          >
            <Backpack className="w-3.5 h-3.5 text-amber-400" />
            <span>Inventory (E)</span>
          </button>

          {/* Sound FX Toggle */}
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            className="h-8 w-8 bg-slate-900/80 hover:bg-slate-800/90 backdrop-blur-md border border-slate-800 text-slate-300 rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-sm active:scale-95"
            title="Toggle Sound Effects"
          >
            {audioEnabled ? <Volume2 className="w-3.5 h-3.5 text-amber-400" /> : <VolumeX className="w-3.5 h-3.5 text-slate-500" />}
          </button>

          {/* Overflow / More Options Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowOverflowMenu(!showOverflowMenu)}
              className={`h-8 w-8 rounded-xl border flex items-center justify-center transition-all cursor-pointer shadow-sm active:scale-95 ${
                showOverflowMenu || showDebugOverlay
                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                  : 'bg-slate-900/80 hover:bg-slate-800/90 border-slate-800 text-slate-300 hover:text-white'
              }`}
              title="More Options & Debug Settings"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {/* Overflow Dropdown Popover */}
            {showOverflowMenu && (
              <div className="absolute right-0 top-10 z-50 w-56 bg-slate-950/95 backdrop-blur-xl border border-slate-800 rounded-2xl p-2 shadow-2xl flex flex-col gap-1 font-sans text-xs animate-in fade-in zoom-in-95 duration-150">
                <button
                  onClick={() => {
                    setShowDebugOverlay(!showDebugOverlay);
                    setShowOverflowMenu(false);
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left font-medium text-slate-200 hover:bg-slate-800/80 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Terminal className="w-4 h-4 text-amber-400" />
                  <span>{showDebugOverlay ? 'Hide Debug Overlay' : 'Show Debug Overlay'}</span>
                </button>

                <button
                  onClick={() => {
                    setIsCompendiumOpen(true);
                    setShowOverflowMenu(false);
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left font-medium text-slate-200 hover:bg-slate-800/80 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <BookOpen className="w-4 h-4 text-sky-400" />
                  <span>A–Z Field Compendium</span>
                </button>

                <button
                  onClick={() => {
                    setWeather((prev) => (prev === 'clear' ? 'rain' : prev === 'rain' ? 'thunder' : 'clear'));
                    setShowOverflowMenu(false);
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left font-medium text-slate-200 hover:bg-slate-800/80 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <CloudRain className="w-4 h-4 text-indigo-400" />
                  <span className="capitalize">Weather: {weather}</span>
                </button>

                <div className="border-t border-slate-800/80 my-1" />

                {/* De-emphasized Export HTML */}
                <button
                  onClick={() => {
                    handleExportHtml();
                    setShowOverflowMenu(false);
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 text-slate-500" />
                  <span>Export Standalone Game</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Floating Reactions Render Layer */}
        <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
          {reactions.map((r) => (
            <div
              key={r.id}
              className="absolute bottom-20 flex flex-col items-center pointer-events-none"
              style={{
                left: `${r.x}%`,
                animation: 'floatUp 2.8s cubic-bezier(0.1, 0.8, 0.3, 1) forwards'
              }}
            >
              <span className="text-3xl drop-shadow-xl">{r.emoji}</span>
              <span className="text-[10px] font-sans font-bold text-slate-200 bg-slate-900/90 px-2 py-0.5 rounded-full border border-slate-700/80 backdrop-blur-sm shadow-md">
                {r.sender}
              </span>
            </div>
          ))}
        </div>

        <style>{`
          @keyframes floatUp {
            0% { transform: translateY(0) scale(0.6); opacity: 0; }
            15% { opacity: 1; transform: translateY(-20px) scale(1.1); }
            85% { opacity: 0.9; }
            100% { transform: translateY(-180px) scale(1); opacity: 0; }
          }
        `}</style>

        {/* Quick Room Floating Reactions Toolbar */}
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-xl border border-slate-800/80 p-1.5 rounded-2xl shadow-2xl">
          {['❤️', '🔥', '🎉', '👏', '😮', '😂'].map((emoji) => (
            <button
              key={emoji}
              onClick={() => triggerReaction(emoji)}
              className="w-8 h-8 rounded-xl hover:bg-slate-800/80 active:scale-90 flex items-center justify-center text-sm transition-all cursor-pointer"
              title={`Send ${emoji} Reaction`}
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* On-Screen Touch Walk D-Pad & Quick Action Buttons */}
        {showTouchDpad && (
          <div className="absolute bottom-6 left-6 z-20 flex items-center gap-4 pointer-events-auto">
            {/* D-Pad Grid */}
            <div className="bg-slate-950/90 backdrop-blur-xl border border-slate-800/80 p-2.5 rounded-3xl shadow-2xl flex flex-col items-center gap-1 select-none">
              <button
                onMouseDown={() => (touchMoveRef.current.forward = true)}
                onMouseUp={() => (touchMoveRef.current.forward = false)}
                onTouchStart={() => (touchMoveRef.current.forward = true)}
                onTouchEnd={() => (touchMoveRef.current.forward = false)}
                className="w-11 h-11 bg-slate-900 hover:bg-slate-800 active:bg-amber-500/20 border border-slate-800 rounded-2xl flex items-center justify-center text-slate-200 text-base font-black transition-all cursor-pointer shadow-sm active:scale-95"
                title="Walk Forward (W / Up Arrow)"
              >
                ▲
              </button>

              <div className="flex items-center gap-1">
                <button
                  onMouseDown={() => (touchMoveRef.current.left = true)}
                  onMouseUp={() => (touchMoveRef.current.left = false)}
                  onTouchStart={() => (touchMoveRef.current.left = true)}
                  onTouchEnd={() => (touchMoveRef.current.left = false)}
                  className="w-11 h-11 bg-slate-900 hover:bg-slate-800 active:bg-amber-500/20 border border-slate-800 rounded-2xl flex items-center justify-center text-slate-200 text-base font-black transition-all cursor-pointer shadow-sm active:scale-95"
                  title="Walk Left (A / Left Arrow)"
                >
                  ◀
                </button>
                <button
                  onClick={() => setIsAutoWalk(!isAutoWalk)}
                  className={`w-11 h-11 border rounded-2xl flex items-center justify-center text-[10px] font-extrabold transition-all cursor-pointer shadow-sm ${
                    isAutoWalk ? 'bg-amber-500 border-amber-400 text-slate-950 font-bold animate-pulse' : 'bg-slate-900 border-slate-800 text-slate-300'
                  }`}
                  title="Toggle Hands-Free Auto-Walk"
                >
                  AUTO
                </button>
                <button
                  onMouseDown={() => (touchMoveRef.current.right = true)}
                  onMouseUp={() => (touchMoveRef.current.right = false)}
                  onTouchStart={() => (touchMoveRef.current.right = true)}
                  onTouchEnd={() => (touchMoveRef.current.right = false)}
                  className="w-11 h-11 bg-slate-900 hover:bg-slate-800 active:bg-amber-500/20 border border-slate-800 rounded-2xl flex items-center justify-center text-slate-200 text-base font-black transition-all cursor-pointer shadow-sm active:scale-95"
                  title="Walk Right (D / Right Arrow)"
                >
                  ▶
                </button>
              </div>

              <button
                onMouseDown={() => (touchMoveRef.current.backward = true)}
                onMouseUp={() => (touchMoveRef.current.backward = false)}
                onTouchStart={() => (touchMoveRef.current.backward = true)}
                onTouchEnd={() => (touchMoveRef.current.backward = false)}
                className="w-11 h-11 bg-slate-900 hover:bg-slate-800 active:bg-amber-500/20 border border-slate-800 rounded-2xl flex items-center justify-center text-slate-200 text-base font-black transition-all cursor-pointer shadow-sm active:scale-95"
                title="Walk Backward (S / Down Arrow)"
              >
                ▼
              </button>
            </div>

            {/* Jump & Sprint Action Buttons */}
            <div className="flex flex-col gap-2">
              <button
                onMouseDown={() => (touchMoveRef.current.jump = true)}
                onMouseUp={() => (touchMoveRef.current.jump = false)}
                onTouchStart={() => (touchMoveRef.current.jump = true)}
                onTouchEnd={() => (touchMoveRef.current.jump = false)}
                className="w-12 h-12 bg-amber-500 hover:bg-amber-400 border border-amber-400 rounded-2xl flex flex-col items-center justify-center text-slate-950 text-xs font-black shadow-xl transition-all cursor-pointer select-none active:scale-95"
                title="Jump (Space)"
              >
                <span>🦘</span>
                <span className="text-[9px]">JUMP</span>
              </button>

              <button
                onClick={() => {
                  touchMoveRef.current.sprint = !touchMoveRef.current.sprint;
                  setIsSprinting(touchMoveRef.current.sprint);
                }}
                className={`w-12 h-12 border rounded-2xl flex flex-col items-center justify-center text-xs font-black shadow-xl transition-all cursor-pointer select-none active:scale-95 ${
                  touchMoveRef.current.sprint
                    ? 'bg-amber-500 border-amber-400 text-slate-950'
                    : 'bg-slate-900 border-slate-800 text-slate-200'
                }`}
                title="Toggle Sprinting Speed (8.5 m/s)"
              >
                <span>🏃</span>
                <span className="text-[9px]">SPRINT</span>
              </button>
            </div>
          </div>
        )}

        {/* Health, Hunger & XP Level Bars */}
        {isSurvival && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5 bg-slate-950/85 backdrop-blur-xl px-5 py-2 border border-slate-800/80 rounded-2xl shadow-2xl shadow-black/80 font-sans">
            <div className="flex items-center gap-5">
              {/* Health Bar (Amber Primary) */}
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                <div className="w-28 h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800/80">
                  <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${(health / 20) * 100}%` }} />
                </div>
              </div>

              {/* Hunger Bar (Muted Secondary) */}
              <div className="flex items-center gap-2">
                <Utensils className="w-4 h-4 text-slate-400" />
                <div className="w-28 h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800/80">
                  <div className="h-full bg-slate-500 transition-all duration-300" style={{ width: `${(hunger / 20) * 100}%` }} />
                </div>
              </div>
            </div>

            {/* XP Level Bar */}
            <div className="flex items-center gap-2.5 w-full border-t border-slate-800/60 pt-1">
              <span className="w-4 h-4 rounded-full bg-amber-500 text-slate-950 text-[10px] font-extrabold flex items-center justify-center font-sans shadow-sm">
                {xpLevel}
              </span>
              <div className="flex-1 h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800/80">
                <div className="h-full bg-sky-400 transition-all duration-300" style={{ width: `${(xp % 100)}%` }} />
              </div>
              <span className="text-[10px] text-slate-400 font-sans font-medium">XP {xp}</span>
            </div>
          </div>
        )}

        {/* Hotbar Bottom */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-slate-950/85 backdrop-blur-xl border border-slate-800/80 p-1.5 rounded-2xl flex items-center gap-1.5 shadow-2xl shadow-black/80">
          {hotbar.map((stack, idx) =>
            renderItemSlot(stack, () => setActiveSlot(idx), `${idx + 1}`, idx === activeSlot, `bottom_hotbar_${idx}`)
          )}
        </div>

        {/* Modal Overlays: Inventory / Crafting Table / Furnace / Chest */}
        {activeModal !== 'none' && activeModal !== 'death' && (
          <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 text-white">
            <div className="bg-black/90 border border-white/20 rounded-3xl p-6 max-w-2xl w-full space-y-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <Backpack className="w-5 h-5 text-amber-400" />
                  <h3 className="text-base font-bold text-white capitalize">{activeModal.replace('_', ' ')}</h3>
                </div>
                <button onClick={() => setActiveModal('none')} className="text-gray-400 hover:text-white text-sm font-bold cursor-pointer">✕</button>
              </div>

              {/* Player Inventory Grid */}
              <div>
                <h4 className="text-xs font-bold text-sky-400 mb-2">Inventory Storage:</h4>
                <div className="grid grid-cols-9 gap-1.5 bg-white/5 p-3 rounded-2xl border border-white/10">
                  {inventorySlots.map((stack, idx) =>
                    renderItemSlot(
                      stack,
                      () => {
                        // Swap with cursor stack
                        const temp = inventorySlots[idx];
                        const newInv = [...inventorySlots];
                        newInv[idx] = cursorStack;
                        setInventorySlots(newInv);
                        setCursorStack(temp);
                      },
                      undefined,
                      false,
                      `inv_slot_${idx}`
                    )
                  )}
                </div>
              </div>

              {/* Hotbar Grid */}
              <div>
                <h4 className="text-xs font-bold text-amber-400 mb-2">Hotbar Slots:</h4>
                <div className="grid grid-cols-9 gap-1.5 bg-white/5 p-3 rounded-2xl border border-white/10">
                  {hotbar.map((stack, idx) =>
                    renderItemSlot(
                      stack,
                      () => {
                        const temp = hotbar[idx];
                        const newHotbar = [...hotbar];
                        newHotbar[idx] = cursorStack;
                        setHotbar(newHotbar);
                        setCursorStack(temp);
                      },
                      `${idx + 1}`,
                      false,
                      `modal_hotbar_${idx}`
                    )
                  )}
                </div>
              </div>

              {/* Workstation Interactive Special Section */}
              {activeModal === 'enchanting' && (
                <div className="bg-purple-950/40 p-4 rounded-2xl border border-purple-500/30 space-y-3">
                  <h4 className="text-xs font-bold text-purple-300 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400" /> Enchanting Altar (XP Cost: 3)
                  </h4>
                  <div className="flex items-center justify-between text-xs text-purple-200">
                    <span>Imbue your weapons and tools with mystical powers (Efficiency V, Sharpness V, Unbreaking III).</span>
                    <button
                      onClick={() => {
                        if (xp >= 30) {
                          setXp((prev) => prev - 30);
                          sfx.playLevelUp();
                          addItemToInventory('diamond_sword', 1);
                        }
                      }}
                      className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl cursor-pointer"
                    >
                      Enchant Diamond Tool
                    </button>
                  </div>
                </div>
              )}

              {activeModal === 'anvil' && (
                <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-600/40 space-y-3">
                  <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <Hammer className="w-4 h-4 text-amber-400" /> Anvil Repair & Rename
                  </h4>
                  <div className="flex items-center justify-between text-xs text-gray-300">
                    <span>Combine damaged items, repair tools, or apply enchanted books.</span>
                    <button
                      onClick={() => {
                        sfx.playClick();
                        addItemToInventory('iron_pickaxe', 1);
                      }}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl cursor-pointer"
                    >
                      Repair Equipment
                    </button>
                  </div>
                </div>
              )}

              {activeModal === 'smithing' && (
                <div className="bg-stone-900/80 p-4 rounded-2xl border border-amber-600/30 space-y-3">
                  <h4 className="text-xs font-bold text-amber-300 flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-amber-400" /> Netherite Smithing Bench
                  </h4>
                  <div className="flex items-center justify-between text-xs text-amber-100">
                    <span>Upgrade Diamond gear with Netherite Ingots into fireproof Netherite gear!</span>
                    <button
                      onClick={() => {
                        sfx.playLevelUp();
                        addItemToInventory('netherite_pickaxe', 1);
                      }}
                      className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white font-bold rounded-xl cursor-pointer"
                    >
                      Forge Netherite Pickaxe
                    </button>
                  </div>
                </div>
              )}

              {activeModal === 'brewing' && (
                <div className="bg-amber-950/40 p-4 rounded-2xl border border-amber-500/30 space-y-3">
                  <h4 className="text-xs font-bold text-amber-300 flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-400" /> Alchemical Brewing Stand
                  </h4>
                  <div className="flex items-center justify-between text-xs text-amber-100">
                    <span>Brew Potions of Swiftness, Healing, Regeneration, and Strength using Nether Wart.</span>
                    <button
                      onClick={() => {
                        sfx.playClick();
                        addItemToInventory('potion_healing', 1);
                        addItemToInventory('potion_speed', 1);
                      }}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl cursor-pointer"
                    >
                      Brew Potions
                    </button>
                  </div>
                </div>
              )}

              {/* Quick Material Generator */}
              <div className="border-t border-white/10 pt-3 flex items-center justify-between">
                <span className="text-xs text-gray-400">Collect resources or craft tools!</span>
                <button
                  onClick={() => {
                    addItemToInventory('wood', 16);
                    addItemToInventory('cobblestone', 16);
                    addItemToInventory('raw_iron', 8);
                    addItemToInventory('coal', 16);
                    addItemToInventory('emerald', 8);
                    addItemToInventory('netherite_ingot', 2);
                  }}
                  className="px-3 py-1.5 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  + Add Starter Resources
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Death Overlay */}
        {activeModal === 'death' && (
          <div className="absolute inset-0 z-40 bg-rose-950/90 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 text-white space-y-6">
            <h1 className="text-4xl font-black text-rose-500 tracking-tight">YOU DIED!</h1>
            <p className="text-sm text-gray-300 max-w-sm">You were overwhelmed in the sandbox world. Respawn back at your spawn point!</p>
            <button
              onClick={() => {
                setHealth(20);
                setHunger(20);
                playerRef.current.pos.set(worldSize / 2, 28, worldSize / 2);
                setActiveModal('none');
              }}
              className="px-8 py-3 bg-rose-600 hover:bg-rose-500 font-bold text-white rounded-2xl shadow-2xl transition-all cursor-pointer"
            >
              RESPAWN
            </button>
          </div>
        )}

        {/* Start / Controls Overlay */}
        {!isPlaying && activeModal === 'none' && (
          <div onClick={handleStartGame} className="absolute inset-0 z-30 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center text-white cursor-pointer">
            <div className="max-w-md bg-white/10 border border-white/20 rounded-3xl p-8 space-y-6 shadow-2xl">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-sky-500 mx-auto flex items-center justify-center text-white shadow-lg">
                <Boxes className="w-8 h-8" />
              </div>

              <div>
                <h2 className="text-2xl font-black tracking-tight text-white font-heading">VOXEL SANDBOX 3D</h2>
                <p className="text-xs text-gray-300 mt-1">Inventory, 3x3 Crafting, Smelting, Chests, Mobs, Tool Tiers & Survival</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-left text-xs bg-black/40 p-4 rounded-2xl border border-white/10 font-mono text-gray-300">
                <div><strong className="text-sky-300">WASD</strong> : Move</div>
                <div><strong className="text-sky-300">Mouse</strong> : Look</div>
                <div><strong className="text-sky-300">Space</strong> : Jump / Ladder</div>
                <div><strong className="text-sky-300">Shift</strong> : Sneak</div>
                <div><strong className="text-emerald-400">Left Click</strong> : Break / Attack</div>
                <div><strong className="text-emerald-400">Right Click</strong> : Place / Interact / Eat</div>
                <div><strong className="text-amber-300">E Key</strong> : Open Inventory</div>
                <div><strong className="text-amber-300">F Key</strong> : Toggle Fly</div>
              </div>

              <button className="w-full h-11 bg-gradient-to-r from-emerald-500 to-sky-500 hover:from-emerald-600 hover:to-sky-600 text-white font-bold text-sm rounded-xl transition-all cursor-pointer shadow-xl flex items-center justify-center gap-2">
                <Play className="w-4 h-4 fill-current" />
                <span>Click to Lock Pointer & Play</span>
              </button>
            </div>
          </div>
        )}
        {/* Minecraft A-Z Compendium Modal */}
        <MinecraftCompendiumModal
          isOpen={isCompendiumOpen}
          onClose={() => setIsCompendiumOpen(false)}
          onGiveItem={(itemId) => {
            addItemToInventory(itemId, ITEM_REGISTRY[itemId]?.category === 'block' ? 16 : 1);
            sfx.playPickup();
          }}
        />
      </div>
    </div>
  );
};
