import React, { useState, useMemo } from 'react';
import { Search, BookOpen, Sparkles, X, Compass, Box, Shield, Zap, Heart, Wrench } from 'lucide-react';
import { MINECRAFT_A_TO_Z } from '../../../data/minecraftCompendiumData';

interface MinecraftCompendiumModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGiveItem?: (itemId: string) => void;
}

const CATEGORIES = [
  { id: 'All', label: 'All Features', icon: Sparkles },
  { id: 'Mechanics', label: 'Mechanics', icon: Compass },
  { id: 'Mobs', label: 'Mobs & Entities', icon: Heart },
  { id: 'Dimensions', label: 'Dimensions', icon: Sparkles },
  { id: 'Blocks', label: 'Blocks', icon: Box },
  { id: 'Tools', label: 'Tools & Gear', icon: Shield },
  { id: 'Redstone', label: 'Redstone & Automation', icon: Zap },
  { id: 'Survival', label: 'Survival & Farming', icon: Heart },
  { id: 'Utility', label: 'Utility Workstations', icon: Wrench },
] as const;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const MinecraftCompendiumModal: React.FC<MinecraftCompendiumModalProps> = ({
  isOpen,
  onClose,
  onGiveItem,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const filteredFeatures = useMemo(() => {
    return MINECRAFT_A_TO_Z.filter((entry) => {
      const matchesSearch =
        entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.description.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesLetter = selectedLetter ? entry.letter === selectedLetter : true;
      const matchesCategory = selectedCategory === 'All' ? true : entry.category === selectedCategory;

      return matchesSearch && matchesLetter && matchesCategory;
    });
  }, [searchTerm, selectedLetter, selectedCategory]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[var(--text-primary)]">
        {/* Header */}
        <div className="p-4 md:p-5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-2)] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-2">
                Minecraft A to Z Compendium
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-medium">
                  {MINECRAFT_A_TO_Z.length} Ref Entries
                </span>
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Complete A–Z reference guide covering every core Minecraft block, mob, mechanic, and dimension.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-3)] transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters & Controls */}
        <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="text"
              placeholder="Search features (e.g. Elytra, Nether Portal, Axolotls, Redstone, Enchanting)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500 transition-all placeholder:[var(--text-tertiary)]"
            />
          </div>

          {/* Alphabet Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setSelectedLetter(null)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                selectedLetter === null
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              All A–Z
            </button>
            {ALPHABET.map((char) => {
              const count = MINECRAFT_A_TO_Z.filter((f) => f.letter === char).length;
              return (
                <button
                  key={char}
                  onClick={() => setSelectedLetter(selectedLetter === char ? null : char)}
                  disabled={count === 0}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap min-w-[28px] text-center ${
                    selectedLetter === char
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : count > 0
                      ? 'bg-[var(--bg-surface-2)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-3)]'
                      : 'opacity-30 cursor-not-allowed bg-transparent text-[var(--text-tertiary)]'
                  }`}
                >
                  {char}
                </button>
              );
            })}
          </div>

          {/* Category Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    selectedCategory === cat.id
                      ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-300'
                      : 'bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Feature List */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredFeatures.length === 0 ? (
            <div className="col-span-full py-12 text-center text-[var(--text-secondary)] space-y-2">
              <BookOpen className="w-8 h-8 mx-auto text-[var(--text-tertiary)]" />
              <p className="text-sm font-semibold">No matching Minecraft features found</p>
              <p className="text-xs text-[var(--text-tertiary)]">Try adjusting your search terms or clearing filters.</p>
            </div>
          ) : (
            filteredFeatures.map((feature, idx) => (
              <div
                key={`${feature.title}_${idx}`}
                className="bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-xl p-4 flex flex-col justify-between hover:border-emerald-500/40 transition-all shadow-sm group"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-extrabold text-xs flex items-center justify-center">
                        {feature.letter}
                      </span>
                      <h3 className="font-bold text-sm text-[var(--text-primary)] group-hover:text-emerald-300 transition-colors">
                        {feature.title}
                      </h3>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[var(--bg-surface-3)] border border-[var(--border-subtle)] text-[var(--text-secondary)] font-medium">
                      {feature.category}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {feature.description}
                  </p>
                </div>

                {feature.itemId && onGiveItem && (
                  <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
                    <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                      Item ID: {feature.itemId}
                    </span>
                    <button
                      onClick={() => onGiveItem(feature.itemId!)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500 hover:text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Spawn Item</span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 md:p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-2)] flex items-center justify-between text-xs text-[var(--text-tertiary)]">
          <span>Showing {filteredFeatures.length} of {MINECRAFT_A_TO_Z.length} Minecraft features</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 transition-all cursor-pointer shadow-sm"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
