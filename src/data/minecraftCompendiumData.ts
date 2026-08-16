export interface FeatureEntry {
  letter: string;
  title: string;
  category: 'Mechanics' | 'Mobs' | 'Dimensions' | 'Blocks' | 'Tools' | 'Redstone' | 'Survival' | 'Utility';
  description: string;
  itemId?: string;
}

export const MINECRAFT_A_TO_Z: FeatureEntry[] = [
  // A
  {
    letter: 'A',
    title: 'Achievements / Advancements',
    category: 'Mechanics',
    description: 'A progression system that tracks milestones (e.g. "mine wood," "defeat the Ender Dragon"). Completing them unlocks new tabs in a tree-like UI and sometimes grants rewards.'
  },
  {
    letter: 'A',
    title: 'Anvils',
    category: 'Utility',
    description: 'A crafted block used to repair damaged tools/armor by combining two items, rename items, or combine enchantments from one item onto another. Costs experience levels and durability to use.',
    itemId: 'anvil'
  },
  {
    letter: 'A',
    title: 'Armor',
    category: 'Tools',
    description: 'Wearable gear (helmet, chestplate, leggings, boots) made from leather, iron, gold, diamond, or netherite. Each piece reduces incoming damage; higher tiers give more protection and can be enchanted.',
    itemId: 'iron_chestplate'
  },
  {
    letter: 'A',
    title: 'Arrows & Bows',
    category: 'Tools',
    description: 'Ranged weapons. Bows are drawn and released to fire arrows; crossbows are loaded then fired instantly. Arrows can be crafted from feathers, sticks, and flint, or have special effects (tipped arrows).',
    itemId: 'bow'
  },
  {
    letter: 'A',
    title: 'Axolotls',
    category: 'Mobs',
    description: 'Passive aquatic mobs that can be bucketed and carried, then used to fight underwater enemies alongside the player.'
  },

  // B
  {
    letter: 'B',
    title: 'Beds',
    category: 'Utility',
    description: 'Placeable blocks that let the player skip the night (sleeping resets time to day) and set their personal respawn point. In the Nether/End, beds explode instead of working.',
    itemId: 'bed'
  },
  {
    letter: 'B',
    title: 'Bees & Beehives',
    category: 'Mobs',
    description: 'Passive mobs that live in hives/nests, pollinate crops (boosting growth), and produce honey that can be harvested with a bottle or by breaking the hive (angers bees unless smoked with a campfire).'
  },
  {
    letter: 'B',
    title: 'Biomes',
    category: 'Mechanics',
    description: 'Distinct environmental regions (forest, desert, jungle, taiga, swamp, ocean, tundra, etc.) each with unique terrain shape, vegetation, temperature, and mob spawn rules.'
  },
  {
    letter: 'B',
    title: 'Boats',
    category: 'Utility',
    description: 'Craftable vehicles that let the player travel across water; some variants include a chest for storage.',
    itemId: 'boat'
  },
  {
    letter: 'B',
    title: 'Bonemeal',
    category: 'Utility',
    description: 'An item made from bones that instantly grows crops, saplings, and grass when applied.',
    itemId: 'bonemeal'
  },
  {
    letter: 'B',
    title: 'Brewing Stands',
    category: 'Utility',
    description: 'A station for making potions by combining a base (water bottle) with ingredients (e.g. blaze powder as fuel, nether wart as a base modifier, plus specific ingredients for each effect).',
    itemId: 'brewing_stand'
  },
  {
    letter: 'B',
    title: 'Buckets',
    category: 'Tools',
    description: 'Tools for scooping up and placing liquids (water, lava) or capturing mobs (fish, axolotls) and milking cows.',
    itemId: 'bucket'
  },
  {
    letter: 'B',
    title: 'Buttons & Pressure Plates',
    category: 'Redstone',
    description: 'Simple redstone input devices. Buttons are manually triggered and momentary; pressure plates activate when a player, mob, or item steps on/lands on them.',
    itemId: 'pressure_plate'
  },

  // C
  {
    letter: 'C',
    title: 'Cacti',
    category: 'Blocks',
    description: 'Desert plants that damage any entity that touches them; useful as a natural or player-made barrier.'
  },
  {
    letter: 'C',
    title: 'Cauldrons',
    category: 'Utility',
    description: 'Blocks that hold water, lava, or potions, used for tasks like extinguishing fire, washing dye off armor, or storing potion charges.',
    itemId: 'cauldron'
  },
  {
    letter: 'C',
    title: 'Caves',
    category: 'Mechanics',
    description: 'Underground void spaces generated through the world, ranging from simple tunnels to specialized biomes like lush caves (vegetation-filled) and dripstone caves (stalactite/stalagmite formations).'
  },
  {
    letter: 'C',
    title: 'Chests',
    category: 'Utility',
    description: 'Storage blocks with a grid inventory. Variants include ender chests (personal storage accessible from any ender chest in the world) and trapped chests (trigger redstone signals when opened).',
    itemId: 'chest'
  },
  {
    letter: 'C',
    title: 'Chunks',
    category: 'Mechanics',
    description: 'The underlying 16x16 block columns the world is divided into for generation and loading purposes — mostly a technical/behind-the-scenes concept.'
  },
  {
    letter: 'C',
    title: 'Command Blocks',
    category: 'Redstone',
    description: 'Special blocks (usually only available via commands/creative mode) that execute game commands automatically, used for custom maps and automation.',
    itemId: 'command_block'
  },
  {
    letter: 'C',
    title: 'Compass',
    category: 'Tools',
    description: 'A navigational tool that points toward the world spawn point (or a set point in later versions).',
    itemId: 'compass'
  },
  {
    letter: 'C',
    title: 'Crafting Table',
    category: 'Utility',
    description: 'The core crafting station providing a 3x3 grid, required for most recipes beyond the very basic 2x2 inventory crafting.',
    itemId: 'crafting_table'
  },
  {
    letter: 'C',
    title: 'Creative Mode',
    category: 'Mechanics',
    description: 'A game mode with unlimited resources, flying, and no health/hunger loss — focused on building and exploring freely.'
  },
  {
    letter: 'C',
    title: 'Crops',
    category: 'Survival',
    description: 'Farmable plants (wheat, carrots, potatoes, beetroot, melons, pumpkins, etc.) that grow over time and are harvested for food or crafting materials.'
  },

  // D
  {
    letter: 'D',
    title: 'Day / Night Cycle',
    category: 'Mechanics',
    description: 'The in-game clock that cycles roughly every 20 real-world minutes, affecting lighting, mob spawning (hostile mobs spawn more in darkness), and certain mechanics like villager schedules.'
  },
  {
    letter: 'D',
    title: 'Diamonds',
    category: 'Blocks',
    description: 'A rare, deep-generating ore used to craft high-tier tools, armor, and enchantment tables.',
    itemId: 'diamond'
  },
  {
    letter: 'D',
    title: 'Doors & Trapdoors',
    category: 'Blocks',
    description: 'Interactive blocks that open/close to allow or block movement; trapdoors work on both vertical and horizontal placements (e.g. sealing a hole in the floor/ceiling).',
    itemId: 'door'
  },
  {
    letter: 'D',
    title: 'Dragon (Ender Dragon)',
    category: 'Mobs',
    description: 'The primary boss mob, found in the End dimension; defeating it is traditionally treated as "beating" the game and triggers the credits sequence.'
  },
  {
    letter: 'D',
    title: 'Dripstone',
    category: 'Blocks',
    description: 'Both a decorative and functional block (stalactites can fall and deal damage, and can be used to slowly fill cauldrons with liquid).'
  },

  // E
  {
    letter: 'E',
    title: 'Elytra',
    category: 'Tools',
    description: 'Wings found in End ships that let the player glide long distances through the air, often combined with firework rockets for propulsion.',
    itemId: 'elytra'
  },
  {
    letter: 'E',
    title: 'Enchanting Table',
    category: 'Utility',
    description: 'A crafted block that lets the player apply magical enchantments (better damage, protection, efficiency, etc.) to tools, weapons, and armor using experience levels and lapis lazuli.',
    itemId: 'enchanting_table'
  },
  {
    letter: 'E',
    title: 'End Dimension',
    category: 'Dimensions',
    description: 'A separate, alien dimension reached through an End portal, home to the Ender Dragon, End cities, and valuable loot like elytra and shulker shells.'
  },
  {
    letter: 'E',
    title: 'Ender Pearls',
    category: 'Tools',
    description: 'Throwable items that teleport the player to where they land, dealing minor fall-style damage; also used to craft eyes of ender.',
    itemId: 'ender_pearl'
  },
  {
    letter: 'E',
    title: 'Experience Points (XP)',
    category: 'Mechanics',
    description: 'Earned by mining certain ores, killing mobs, breeding animals, smelting, and more. Used for enchanting and repairing at anvils. Displayed as a level bar.'
  },
  {
    letter: 'E',
    title: 'Explosions',
    category: 'Mechanics',
    description: 'Caused by TNT, creepers, or other sources; can destroy terrain and blocks (with exceptions like obsidian), and deal significant damage.',
    itemId: 'tnt'
  },

  // F
  {
    letter: 'F',
    title: 'Farming',
    category: 'Survival',
    description: 'The broader system of growing crops and breeding animals for a renewable food/resource supply.'
  },
  {
    letter: 'F',
    title: 'Fences & Gates',
    category: 'Blocks',
    description: 'Barrier blocks that prevent most mob/player movement but allow the player to see and shoot through gaps; gates open/close on interaction like doors.',
    itemId: 'fence'
  },
  {
    letter: 'F',
    title: 'Fire',
    category: 'Mechanics',
    description: 'A damaging, spreading hazard that can ignite flammable blocks (wood, leaves) and burn down structures if unchecked.'
  },
  {
    letter: 'F',
    title: 'Fishing',
    category: 'Survival',
    description: 'Using a fishing rod to catch fish, junk items, or "treasure" items (enchanted books, saddles, etc.) from water.',
    itemId: 'fishing_rod'
  },
  {
    letter: 'F',
    title: 'Food & Hunger System',
    category: 'Survival',
    description: 'Player hunger depletes over time through activity; eating food restores it, and sufficiently high hunger allows passive health regeneration.',
    itemId: 'cooked_beef'
  },
  {
    letter: 'F',
    title: 'Furnaces',
    category: 'Utility',
    description: 'Blocks used to smelt ores into ingots, cook raw food into cooked food, and process other materials, using fuel (coal, wood, etc.).',
    itemId: 'furnace'
  },
  {
    letter: 'F',
    title: 'Fireworks',
    category: 'Utility',
    description: 'Craftable items used for celebration effects, as a damage-dealing crossbow projectile, or as propulsion while gliding with elytra.'
  },

  // G
  {
    letter: 'G',
    title: 'Ghast',
    category: 'Mobs',
    description: 'A large, floating hostile mob found in the Nether that shoots explosive fireballs from a distance.'
  },
  {
    letter: 'G',
    title: 'Glass',
    category: 'Blocks',
    description: 'A transparent building block; can be dyed into stained glass variants and crafted into panes for thinner window-style building.',
    itemId: 'glass'
  },
  {
    letter: 'G',
    title: 'Golems',
    category: 'Mobs',
    description: 'Player-craftable helper mobs: iron golems defend villages/players from hostile mobs, and snow golems throw snowballs at enemies (mostly harmless but distracting).'
  },
  {
    letter: 'G',
    title: 'Grass',
    category: 'Blocks',
    description: 'The base surface block of most overworld terrain; also a category term for decorative foliage like tall grass and ferns.',
    itemId: 'grass'
  },

  // H
  {
    letter: 'H',
    title: 'Hardcore Mode',
    category: 'Mechanics',
    description: 'A difficulty setting where death is permanent — the world becomes uneditable (spectator-only) once the player dies.'
  },
  {
    letter: 'H',
    title: 'Health / Hearts',
    category: 'Survival',
    description: "The player's life total, shown as heart icons; depleted by damage from mobs, falls, fire, drowning, etc., and restored by food, potions, or regeneration."
  },
  {
    letter: 'H',
    title: 'Hoes',
    category: 'Tools',
    description: 'A farming tool used to till dirt/grass into farmland for planting crops.',
    itemId: 'hoe'
  },
  {
    letter: 'H',
    title: 'Horses',
    category: 'Mobs',
    description: 'Rideable, breedable mobs with variable speed/jump/health stats; can be equipped with saddles and armor.',
    itemId: 'saddle'
  },
  {
    letter: 'H',
    title: 'Hoppers',
    category: 'Redstone',
    description: 'Redstone-related blocks that automatically move items between containers (chests, furnaces, etc.), commonly used in automated farms and sorting systems.',
    itemId: 'hopper'
  },

  // I
  {
    letter: 'I',
    title: 'Iron',
    category: 'Blocks',
    description: 'A common mid-tier ore used for tools, armor, and crafting iron golems, buckets, and more.',
    itemId: 'iron_ingot'
  },
  {
    letter: 'I',
    title: 'Inventory System',
    category: 'Mechanics',
    description: "The player's personal storage grid (plus hotbar) for carrying blocks, tools, and items."
  },
  {
    letter: 'I',
    title: 'Item Frames',
    category: 'Utility',
    description: 'Wall-mounted frames that display a single held item, often used decoratively or as a lock/puzzle indicator in builds.',
    itemId: 'item_frame'
  },

  // J
  {
    letter: 'J',
    title: 'Jukebox',
    category: 'Utility',
    description: 'A block that plays music discs, obtainable from specific mob drops or loot chests.',
    itemId: 'jukebox'
  },
  {
    letter: 'J',
    title: 'Jungle Biome & Temples',
    category: 'Mechanics',
    description: 'Dense, vine-covered biomes containing jungle temples — small dungeon structures with basic traps and loot chests.'
  },

  // K
  {
    letter: 'K',
    title: 'Lock / Security Redstone',
    category: 'Redstone',
    description: 'Minecraft locking and security systems built through keycard password mechanisms, piston doors, and redstone logic gates.'
  },

  // L
  {
    letter: 'L',
    title: 'Ladders',
    category: 'Blocks',
    description: 'Climbable blocks that let the player move vertically along walls.',
    itemId: 'ladder'
  },
  {
    letter: 'L',
    title: 'Lava',
    category: 'Mechanics',
    description: 'A dangerous, damaging liquid found underground and in the Nether; can also be used as a fuel source or defensive barrier.'
  },
  {
    letter: 'L',
    title: 'Leads',
    category: 'Tools',
    description: 'Rope-like items used to tether tamed or passive mobs to the player or to a fence post.'
  },
  {
    letter: 'L',
    title: 'Leaves',
    category: 'Blocks',
    description: 'Blocks generated as part of trees; decay over time if not attached to a log, and can be harvested with shears for decoration or to get saplings.',
    itemId: 'leaves'
  },
  {
    letter: 'L',
    title: 'Lighting Engine',
    category: 'Mechanics',
    description: 'The system governing how light spreads from sources (torches, sunlight, lava, etc.), which directly affects where hostile mobs are allowed to spawn.'
  },
  {
    letter: 'L',
    title: 'Llamas',
    category: 'Mobs',
    description: 'Pack animals that can carry inventory via a chest saddle-equivalent and can be led in a caravan.'
  },

  // M
  {
    letter: 'M',
    title: 'Maps',
    category: 'Tools',
    description: 'Craftable items that reveal the surrounding terrain as the player explores; can be expanded and locked in item frames for large-scale wall maps.',
    itemId: 'map'
  },
  {
    letter: 'M',
    title: 'Mending',
    category: 'Mechanics',
    description: "An enchantment that repairs a tool/armor's durability using absorbed experience orbs instead of anvil repairs."
  },
  {
    letter: 'M',
    title: 'Minecarts & Rails',
    category: 'Redstone',
    description: 'A transportation system: rails guide minecarts across the terrain, with variants for powered movement, detection, and braking.',
    itemId: 'rail'
  },
  {
    letter: 'M',
    title: 'Mobs',
    category: 'Mobs',
    description: 'All creatures in the game, split into passive (cows, pigs — non-threatening), neutral (wolves, bees — only attack if provoked), and hostile (zombies, skeletons, creepers — attack on sight).'
  },
  {
    letter: 'M',
    title: 'Multiplayer',
    category: 'Mechanics',
    description: 'Playing together on a shared server or local network, with shared or separate world permissions depending on settings.'
  },
  {
    letter: 'M',
    title: 'Mining Mechanics',
    category: 'Mechanics',
    description: "Breaking blocks takes different amounts of time depending on the block's hardness and the tool's material/efficiency; some blocks require a minimum tool tier to drop items."
  },
  {
    letter: 'M',
    title: 'Mushrooms',
    category: 'Survival',
    description: 'Small plants found in dark areas, usable in food recipes (mushroom stew) and found abundantly in mushroom island biomes alongside giant mushroom blocks.'
  },

  // N
  {
    letter: 'N',
    title: 'Nether Dimension',
    category: 'Dimensions',
    description: 'A hostile, lava-filled alternate dimension reached through a Nether portal; used for resource gathering (blaze rods, quartz, netherite) and faster long-distance overworld travel (1 Nether block ≈ 8 overworld blocks).'
  },
  {
    letter: 'N',
    title: 'Nether Portals',
    category: 'Dimensions',
    description: 'Frames built from obsidian and lit with flint and steel, used to travel between the Overworld and the Nether.',
    itemId: 'obsidian'
  },
  {
    letter: 'N',
    title: 'Netherite',
    category: 'Tools',
    description: 'The strongest standard crafting material, made by combining gold with ancient debris found in the Nether; used to upgrade diamond gear.',
    itemId: 'netherite_ingot'
  },
  {
    letter: 'N',
    title: 'Note Blocks',
    category: 'Redstone',
    description: 'Blocks that play a musical note when triggered (by hand or redstone), with pitch adjustable and tone changing based on the block placed beneath them — often used to build custom music machines.',
    itemId: 'note_block'
  },

  // O
  {
    letter: 'O',
    title: 'Ocean Monuments',
    category: 'Dimensions',
    description: 'Underwater structures guarded by hostile guardian mobs, containing valuable loot like sponges and gold.'
  },
  {
    letter: 'O',
    title: 'Ores',
    category: 'Blocks',
    description: 'Mineral-bearing blocks found underground, including coal, iron, gold, redstone, lapis lazuli, diamond, emerald, and copper, each with different rarity and depth ranges.',
    itemId: 'ore_diamond'
  },
  {
    letter: 'O',
    title: 'Overworld',
    category: 'Dimensions',
    description: 'The main, default dimension where players spawn and spend most of their time.'
  },

  // P
  {
    letter: 'P',
    title: 'Pandas',
    category: 'Mobs',
    description: 'Passive jungle mobs with several rare personality variants affecting their behavior.'
  },
  {
    letter: 'P',
    title: 'Parrots',
    category: 'Mobs',
    description: "Tameable jungle birds that can perch on the player's shoulder and mimic nearby mob sounds."
  },
  {
    letter: 'P',
    title: 'Pathfinding AI',
    category: 'Mechanics',
    description: 'The underlying system mobs use to navigate terrain, avoid obstacles, and chase or flee from the player.'
  },
  {
    letter: 'P',
    title: 'Pigs',
    category: 'Mobs',
    description: 'Passive mobs that can be ridden with a saddle (steered using a carrot on a stick).'
  },
  {
    letter: 'P',
    title: 'Pillager Outposts',
    category: 'Mobs',
    description: 'Hostile structures inhabited by pillagers (crossbow-wielding raiders), often marking the presence of nearby raid events.'
  },
  {
    letter: 'P',
    title: 'Pistons',
    category: 'Redstone',
    description: 'Redstone components that push (and, if sticky, pull) blocks when activated — a core building block of redstone contraptions.',
    itemId: 'piston'
  },
  {
    letter: 'P',
    title: 'Player Skins',
    category: 'Mechanics',
    description: "Customizable visual appearance for the player's character model."
  },
  {
    letter: 'P',
    title: 'Portals',
    category: 'Dimensions',
    description: 'General term for the Nether portal (Overworld ↔ Nether) and the End portal (Overworld ↔ End).'
  },
  {
    letter: 'P',
    title: 'Potions',
    category: 'Survival',
    description: 'Consumable brewed items granting temporary effects (speed, healing, poison, fire resistance, etc.), thrown or drunk.',
    itemId: 'potion_healing'
  },
  {
    letter: 'P',
    title: 'Pressure Plates',
    category: 'Redstone',
    description: 'See Buttons & Pressure Plates above.',
    itemId: 'pressure_plate'
  },

  // Q
  {
    letter: 'Q',
    title: 'Quartz',
    category: 'Blocks',
    description: 'A Nether-native mineral used for decorative white-toned building blocks and some redstone crafting recipes.',
    itemId: 'quartz'
  },

  // R
  {
    letter: 'R',
    title: 'Rails',
    category: 'Redstone',
    description: 'See Minecarts & Rails.',
    itemId: 'rail'
  },
  {
    letter: 'R',
    title: 'Rain / Weather',
    category: 'Mechanics',
    description: 'Periodic weather events (rain, thunderstorms, snow in cold biomes) that affect visibility, fire spread, and can trigger events like charged creepers (from lightning strikes).'
  },
  {
    letter: 'R',
    title: 'Redstone',
    category: 'Redstone',
    description: "Minecraft's in-game logic/circuitry system: redstone dust, repeaters, comparators, and components like pistons and dispensers combine to create switches, automated farms, doors, and complex machines.",
    itemId: 'redstone'
  },
  {
    letter: 'R',
    title: 'Respawn Mechanics',
    category: 'Mechanics',
    description: "Determines where the player reappears after death — either world spawn or a bed/respawn anchor point they've set."
  },

  // S
  {
    letter: 'S',
    title: 'Saddles',
    category: 'Tools',
    description: 'Items that allow riding certain mobs (pigs, horses, striders).',
    itemId: 'saddle'
  },
  {
    letter: 'S',
    title: 'Scaffolding',
    category: 'Utility',
    description: 'A quickly climbable, temporary building block useful for constructing tall structures safely.',
    itemId: 'scaffolding'
  },
  {
    letter: 'S',
    title: 'Sculk',
    category: 'Blocks',
    description: 'A dark-themed block set tied to the deep dark biome; sculk sensors detect vibrations (movement, sound) and can trigger redstone signals, often paired with the dangerous Warden mob.',
    itemId: 'sculk'
  },
  {
    letter: 'S',
    title: 'Seeds (World Generation)',
    category: 'Mechanics',
    description: "The number/string that determines a world's terrain layout, allowing the same world to be regenerated identically."
  },
  {
    letter: 'S',
    title: 'Shields',
    category: 'Tools',
    description: 'Held items that block/reduce incoming melee damage when raised.',
    itemId: 'shield'
  },
  {
    letter: 'S',
    title: 'Shulkers & Shulker Boxes',
    category: 'Utility',
    description: 'Hostile mobs found in End cities; their shells are used to craft portable storage boxes that keep their contents when picked up.',
    itemId: 'shulker_box'
  },
  {
    letter: 'S',
    title: 'Signs',
    category: 'Utility',
    description: 'Placeable blocks for writing custom text, useful for labeling builds or storage.'
  },
  {
    letter: 'S',
    title: 'Skeletons',
    category: 'Mobs',
    description: 'Ranged hostile mobs (plus variants: wither skeletons in the Nether, strays in cold biomes) that shoot arrows at the player.'
  },
  {
    letter: 'S',
    title: 'Sleep Mechanic',
    category: 'Mechanics',
    description: 'See Beds.'
  },
  {
    letter: 'S',
    title: 'Slimes',
    category: 'Mobs',
    description: 'Hostile mobs that split into smaller copies when damaged, found in specific swamp conditions or underground "slime chunks."'
  },
  {
    letter: 'S',
    title: 'Smithing Table',
    category: 'Utility',
    description: 'A block used to upgrade diamond gear to netherite, and in some versions for other gear customization.',
    itemId: 'smithing_table'
  },
  {
    letter: 'S',
    title: 'Spawners',
    category: 'Blocks',
    description: 'Blocks (usually found in dungeons/structures) that continuously generate a specific mob type nearby, often used by players for renewable mob farms.'
  },
  {
    letter: 'S',
    title: 'Stairs & Slabs',
    category: 'Blocks',
    description: 'Half/step-shaped building block variants that allow more detailed, less blocky architecture.',
    itemId: 'stairs'
  },
  {
    letter: 'S',
    title: 'Strongholds',
    category: 'Dimensions',
    description: 'Underground structures containing the End portal room, found using eyes of ender.'
  },
  {
    letter: 'S',
    title: 'Structures',
    category: 'Mechanics',
    description: 'Pre-generated buildings found across the world: villages, temples, mansions, fortresses, outposts, etc., each with unique loot and purpose.'
  },
  {
    letter: 'S',
    title: 'Survival Mode',
    category: 'Mechanics',
    description: 'The standard gameplay mode with resource gathering, health, hunger, and mob threats — as opposed to Creative mode.'
  },

  // T
  {
    letter: 'T',
    title: 'Tamed Animals',
    category: 'Mobs',
    description: 'Certain mobs (wolves, cats, horses, parrots) can be tamed to follow, fight alongside, or be ridden by the player.'
  },
  {
    letter: 'T',
    title: 'Temples',
    category: 'Mechanics',
    description: 'Structures like desert pyramids and jungle temples containing traps and loot.'
  },
  {
    letter: 'T',
    title: 'TNT',
    category: 'Redstone',
    description: 'An explosive block that can be manually or redstone-triggered to detonate, destroying terrain and dealing damage.',
    itemId: 'tnt'
  },
  {
    letter: 'T',
    title: 'Tools',
    category: 'Tools',
    description: 'The core item set (pickaxe, axe, shovel, hoe, sword) craftable in wood, stone, iron, gold, diamond, and netherite tiers, each suited to different tasks.',
    itemId: 'diamond_pickaxe'
  },
  {
    letter: 'T',
    title: 'Torches',
    category: 'Blocks',
    description: 'Simple light sources that also prevent hostile mob spawning in their radius.',
    itemId: 'torch'
  },
  {
    letter: 'T',
    title: 'Totems of Undying',
    category: 'Survival',
    description: 'A rare item that, when held, prevents death once by restoring the player to full health when they would otherwise die.',
    itemId: 'totem'
  },
  {
    letter: 'T',
    title: 'Trading',
    category: 'Survival',
    description: 'Interacting with villagers to exchange emeralds for items (or vice versa), with trades varying by villager profession.'
  },
  {
    letter: 'T',
    title: 'Trapdoors',
    category: 'Blocks',
    description: 'See Doors & Trapdoors.'
  },
  {
    letter: 'T',
    title: 'Trees',
    category: 'Blocks',
    description: 'Multiple wood types (oak, birch, spruce, jungle, acacia, dark oak, mangrove, cherry) each with distinct log/leaf appearance and growth shape.',
    itemId: 'wood'
  },
  {
    letter: 'T',
    title: 'Trident',
    category: 'Tools',
    description: 'A melee/throwable weapon obtained from drowned mobs, with optional enchantments like Riptide (propels the player during rain/water) and Channeling (calls lightning during storms).',
    itemId: 'trident'
  },

  // U
  {
    letter: 'U',
    title: 'Underwater Mechanics',
    category: 'Mechanics',
    description: 'Includes limited breath/oxygen while submerged, slower movement, and special gear (helmets with Respiration/Aqua Affinity enchantments) to make underwater activity easier.'
  },
  {
    letter: 'U',
    title: 'Utility Blocks',
    category: 'Utility',
    description: 'General term for functional crafting/processing blocks: crafting table, furnace, smoker, blast furnace, brewing stand, anvil, etc.'
  },

  // V
  {
    letter: 'V',
    title: 'Villages',
    category: 'Mechanics',
    description: 'Naturally generated settlements populated by villagers, with distinct building styles per biome.'
  },
  {
    letter: 'V',
    title: 'Villagers & Professions',
    category: 'Mobs',
    description: 'NPCs that take on jobs (farmer, librarian, blacksmith, etc.) based on nearby workstation blocks, each offering different trades.'
  },
  {
    letter: 'V',
    title: 'Vines',
    category: 'Blocks',
    description: 'Climbable, decorative plant blocks found mainly in jungle biomes (and cave vines in lush caves, which can bear glow berries).'
  },

  // W
  {
    letter: 'W',
    title: 'Water Mechanics',
    category: 'Mechanics',
    description: 'Governs flow, source blocks, swimming physics, and interactions like extinguishing fire or being used in redstone/farm contraptions.'
  },
  {
    letter: 'W',
    title: 'Weather',
    category: 'Mechanics',
    description: 'See Rain / Weather.'
  },
  {
    letter: 'W',
    title: 'Wither',
    category: 'Mobs',
    description: 'A craftable boss mob (built from soul sand/soul soil and wither skeleton skulls) that flies and attacks with explosive skulls; a challenging optional boss fight.'
  },
  {
    letter: 'W',
    title: 'Witches',
    category: 'Mobs',
    description: 'Hostile mobs that throw harmful potions at the player and drink potions to heal or buff themselves.'
  },
  {
    letter: 'W',
    title: 'Wolves',
    category: 'Mobs',
    description: 'Neutral mobs that can be tamed into loyal, fighting companion dogs.'
  },
  {
    letter: 'W',
    title: 'Wool & Dyes',
    category: 'Blocks',
    description: 'Wool is a soft building block obtainable from sheep, dyeable into 16 colors using plant- and mob-based dye sources.',
    itemId: 'wool_white'
  },
  {
    letter: 'W',
    title: 'World Generation',
    category: 'Mechanics',
    description: 'The seed-based procedural system that creates terrain, biomes, and structures uniquely for each new world.'
  },
  {
    letter: 'W',
    title: 'World Border',
    category: 'Mechanics',
    description: 'An invisible (or visually indicated) boundary limiting how far a player can travel from world spawn.'
  },

  // X
  {
    letter: 'X',
    title: 'XP (Experience) System',
    category: 'Mechanics',
    description: 'See Experience Points (XP).'
  },

  // Y
  {
    letter: 'Y',
    title: 'Yield Mechanics',
    category: 'Mechanics',
    description: 'General term for the output quantities from farming and animal breeding (e.g. how much wheat a crop yields, or how breeding produces offspring).'
  },

  // Z
  {
    letter: 'Z',
    title: 'Zombies',
    category: 'Mobs',
    description: 'Common hostile mobs that shamble toward and attack the player; variants include husks (desert, cause hunger on hit) and drowned (underwater, can carry tridents).'
  },
  {
    letter: 'Z',
    title: 'Zombie Villagers',
    category: 'Mobs',
    description: 'A zombie variant that can be "cured" back into a normal villager using a splash potion of weakness plus a golden apple, often used to get discounted trades.'
  }
];
