import React, { useState } from 'react';
import { Sun, Moon, Play, Pause, FastForward, Sunrise, Sunset, BedDouble, ChevronDown, ChevronUp, Clock } from 'lucide-react';

interface DayNightClockWidgetProps {
  timeOfDay: number;
  timeSpeed: number;
  isTimePaused: boolean;
  onSetTimeOfDay: (time: number) => void;
  onSetTimeSpeed: (speed: number) => void;
  onTogglePause: () => void;
  onSleepInBed?: () => void;
}

export const DayNightClockWidget: React.FC<DayNightClockWidgetProps> = ({
  timeOfDay,
  timeSpeed,
  isTimePaused,
  onSetTimeOfDay,
  onSetTimeSpeed,
  onTogglePause,
  onSleepInBed
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Helper to format timeOfDay (0.0 - 24.0) into HH:MM AM/PM
  const formatTime = (time: number) => {
    const totalMinutes = Math.floor(time * 60);
    let hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    const padMin = minutes < 10 ? `0${minutes}` : `${minutes}`;
    const padHour = displayHours < 10 ? `0${displayHours}` : `${displayHours}`;
    return {
      digital24: `${hours < 10 ? '0' + hours : hours}:${padMin}`,
      digital12: `${padHour}:${padMin} ${ampm}`,
      hours,
      minutes
    };
  };

  const timeData = formatTime(timeOfDay);

  // Determine current day phase
  const getPhaseInfo = (time: number) => {
    if (time >= 5.0 && time < 6.5) return { name: 'Sunrise / Dawn', icon: <Sunrise className="w-4 h-4 text-orange-400" />, bg: 'from-amber-600/30 to-purple-900/30' };
    if (time >= 6.5 && time < 11.5) return { name: 'Morning', icon: <Sun className="w-4 h-4 text-amber-300" />, bg: 'from-sky-500/30 to-amber-500/20' };
    if (time >= 11.5 && time < 13.5) return { name: 'Midday Zenith', icon: <Sun className="w-4 h-4 text-yellow-300" />, bg: 'from-blue-500/30 to-sky-400/30' };
    if (time >= 13.5 && time < 17.0) return { name: 'Afternoon', icon: <Sun className="w-4 h-4 text-amber-400" />, bg: 'from-amber-500/20 to-sky-600/20' };
    if (time >= 17.0 && time < 18.5) return { name: 'Golden Hour', icon: <Sunset className="w-4 h-4 text-orange-400" />, bg: 'from-orange-600/30 to-amber-700/30' };
    if (time >= 18.5 && time < 20.0) return { name: 'Dusk / Twilight', icon: <Sunset className="w-4 h-4 text-purple-400" />, bg: 'from-purple-800/40 to-slate-900/40' };
    if (time >= 20.0 || time < 5.0) return { name: 'Night / Midnight', icon: <Moon className="w-4 h-4 text-indigo-300" />, bg: 'from-indigo-950/60 to-slate-950/80' };
    return { name: 'Daytime', icon: <Sun className="w-4 h-4 text-amber-400" />, bg: 'from-sky-500/30 to-blue-500/20' };
  };

  const phase = getPhaseInfo(timeOfDay);
  const isNight = timeOfDay < 5.5 || timeOfDay > 18.5;

  // Calculate Sun/Moon position on semi-circular Arc
  // Sun angle: 06:00 is left (0deg), 12:00 is top (90deg), 18:00 is right (180deg)
  const angleRad = ((timeOfDay - 6) / 24) * Math.PI * 2;
  const arcX = 50 + Math.cos(angleRad) * 38;
  const arcY = 45 - Math.sin(angleRad) * 32;

  return (
    <div className="flex flex-col items-start gap-1">
      {/* Compact Header Pill */}
      <div className="flex items-center gap-2 bg-slate-950/85 backdrop-blur-md border border-slate-800/80 p-1.5 px-3 rounded-2xl shadow-xl text-xs font-sans text-slate-200 select-none">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 hover:text-amber-300 transition-colors cursor-pointer group"
          title="Click to Expand/Collapse Dynamic Day-Night Controls"
        >
          <div className="p-1 rounded-lg bg-white/10 group-hover:bg-amber-500/20 transition-colors">
            {phase.icon}
          </div>
          <div className="flex flex-col items-start leading-none">
            <span className="font-bold text-amber-300 text-sm tracking-wide">{timeData.digital12}</span>
            <span className="text-[10px] text-gray-300 font-sans">{phase.name}</span>
          </div>
          <div className="ml-1 text-gray-400 group-hover:text-white">
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {/* Quick Pause/Play Toggle */}
        <button
          onClick={onTogglePause}
          className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
            isTimePaused
              ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
              : 'bg-white/10 border-white/15 text-gray-300 hover:text-white hover:bg-white/20'
          }`}
          title={isTimePaused ? 'Resume Day/Night Cycle' : 'Pause Time Progression'}
        >
          {isTimePaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expanded Control Box */}
      {isExpanded && (
        <div className={`mt-1 w-72 bg-slate-950/90 backdrop-blur-xl border border-white/20 rounded-2xl p-4 shadow-2xl space-y-3 text-white text-xs bg-gradient-to-br ${phase.bg} transition-all`}>
          {/* Header & Orbit Arc Diagram */}
          <div className="flex items-center justify-between border-b border-white/15 pb-2">
            <span className="font-bold text-amber-200 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400" /> Dynamic Day / Night Cycle
            </span>
            <span className="text-[11px] font-mono font-extrabold text-sky-300">{timeData.digital24}</span>
          </div>

          {/* SVG Celestial Orbit Display */}
          <div className="relative w-full h-20 bg-black/40 rounded-xl border border-white/10 flex items-center justify-center overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 100 50">
              {/* Horizon Line */}
              <line x1="5" y1="42" x2="95" y2="42" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="2,2" />
              {/* Orbit Arc */}
              <path d="M 12 42 A 38 30 0 0 1 88 42" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
              
              {/* Celestial Object Marker */}
              <circle
                cx={arcX}
                cy={arcY}
                r="4.5"
                fill={timeOfDay >= 6 && timeOfDay <= 18 ? '#fbbf24' : '#60a5fa'}
                stroke="#ffffff"
                strokeWidth="1.5"
                className="transition-all duration-150"
              />
            </svg>

            <div className="absolute bottom-1 left-3 text-[9px] font-mono text-amber-400">06:00 AM Dawn</div>
            <div className="absolute top-1 text-[10px] font-mono text-yellow-300 font-bold">12:00 PM Noon</div>
            <div className="absolute bottom-1 right-3 text-[9px] font-mono text-purple-400">06:00 PM Sunset</div>
          </div>

          {/* Time Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-gray-300 font-mono">
              <span>Time Scrub:</span>
              <span className="text-amber-300 font-bold">{timeData.digital12} ({timeOfDay.toFixed(1)}h)</span>
            </div>
            <input
              type="range"
              min="0"
              max="24"
              step="0.1"
              value={timeOfDay}
              onChange={(e) => onSetTimeOfDay(parseFloat(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
            />
          </div>

          {/* Preset Jump Buttons */}
          <div className="space-y-1">
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Quick Jump Presets:</span>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => onSetTimeOfDay(6.0)}
                className="py-1 px-1.5 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 text-amber-200 text-[10px] font-bold rounded-lg transition-all cursor-pointer flex flex-col items-center gap-0.5"
              >
                <Sunrise className="w-3 h-3 text-amber-400" />
                <span>Dawn</span>
              </button>
              <button
                onClick={() => onSetTimeOfDay(12.0)}
                className="py-1 px-1.5 bg-yellow-600/30 hover:bg-yellow-600/50 border border-yellow-500/40 text-yellow-200 text-[10px] font-bold rounded-lg transition-all cursor-pointer flex flex-col items-center gap-0.5"
              >
                <Sun className="w-3 h-3 text-yellow-300" />
                <span>Noon</span>
              </button>
              <button
                onClick={() => onSetTimeOfDay(18.0)}
                className="py-1 px-1.5 bg-orange-600/30 hover:bg-orange-600/50 border border-orange-500/40 text-orange-200 text-[10px] font-bold rounded-lg transition-all cursor-pointer flex flex-col items-center gap-0.5"
              >
                <Sunset className="w-3 h-3 text-orange-400" />
                <span>Sunset</span>
              </button>
              <button
                onClick={() => onSetTimeOfDay(22.0)}
                className="py-1 px-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-[10px] font-bold rounded-lg transition-all cursor-pointer flex flex-col items-center gap-0.5"
              >
                <Moon className="w-3 h-3 text-indigo-300" />
                <span>Night</span>
              </button>
            </div>
          </div>

          {/* Speed Controls */}
          <div className="space-y-1 pt-1 border-t border-white/10">
            <div className="flex justify-between items-center text-[10px] text-gray-400 font-bold uppercase">
              <span>Time Cycle Speed:</span>
              <span className="text-sky-300">{isTimePaused ? 'PAUSED' : `${(timeSpeed * 50).toFixed(0)}x`}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={onTogglePause}
                className={`flex-1 py-1 rounded-lg border text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                  isTimePaused ? 'bg-amber-500 text-black border-amber-400' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                }`}
              >
                {isTimePaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                <span>{isTimePaused ? 'Resume' : 'Pause'}</span>
              </button>
              {[0.02, 0.08, 0.25].map((speedVal) => (
                <button
                  key={speedVal}
                  onClick={() => {
                    onSetTimeSpeed(speedVal);
                    if (isTimePaused) onTogglePause();
                  }}
                  className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition-all cursor-pointer ${
                    !isTimePaused && Math.abs(timeSpeed - speedVal) < 0.01
                      ? 'bg-sky-500 border-sky-400 text-white shadow-sm'
                      : 'bg-white/5 border-white/15 text-gray-300 hover:text-white'
                  }`}
                >
                  {speedVal === 0.02 ? '1x' : speedVal === 0.08 ? '4x' : '12x'}
                </button>
              ))}
            </div>
          </div>

          {/* Sleep in Bed Action */}
          {isNight && onSleepInBed && (
            <button
              onClick={onSleepInBed}
              className="w-full py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 border border-indigo-400/50 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg animate-pulse"
            >
              <BedDouble className="w-4 h-4 text-amber-300" />
              <span>Sleep in Bed (Skip to Morning 06:00 AM)</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
