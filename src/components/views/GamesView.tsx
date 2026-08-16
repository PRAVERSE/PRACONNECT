import React, { useState } from 'react';
import { VoxelGame } from '../voxel/VoxelGame';

export const GamesView: React.FC = () => {
  const [activeGame, setActiveGame] = useState<'voxel' | 'tictactoe'>('voxel');

  // Tic Tac Toe State
  const [board, setBoard] = useState<(string | null)[]>(Array(9).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [scores, setScores] = useState({ x: 3, o: 2, draws: 1 });

  const calculateWinner = (squares: (string | null)[]) => {
    const lines = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6]
    ];
    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i];
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return squares[a];
      }
    }
    return null;
  };

  const winner = calculateWinner(board);
  const isDraw = !winner && board.every((square) => square !== null);

  const handleClickSquare = (index: number) => {
    if (board[index] || winner) return;
    const newBoard = [...board];
    newBoard[index] = isXNext ? 'X' : 'O';
    setBoard(newBoard);
    setIsXNext(!isXNext);

    const win = calculateWinner(newBoard);
    if (win) {
      if (win === 'X') setScores((s) => ({ ...s, x: s.x + 1 }));
      else setScores((s) => ({ ...s, o: s.o + 1 }));
    } else if (newBoard.every((sq) => sq !== null)) {
      setScores((s) => ({ ...s, draws: s.draws + 1 }));
    }
  };

  const resetGame = () => {
    setBoard(Array(9).fill(null));
    setIsXNext(true);
  };

  return (
    <div className="w-full text-[#EDEDEF] font-['Inter',sans-serif] select-none animate-fade-in-up px-4 sm:px-6 py-6 md:py-10">
      {/* ─── PAGE HEADER ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-6 mb-8">
        <div>
          <h1 className="font-['Sora',sans-serif] text-3xl font-bold tracking-tight text-[#EDEDEF] mb-1.5">
            Party Games
          </h1>
          <p className="text-sm text-[#9A9AA2]">
            Play interactive 3D voxel sandbox and quick showdowns with your squad.
          </p>
        </div>
      </div>

      {/* ─── GAME MODE TABS (Text + Baby Pink Accent Underline) ─────────────────── */}
      <div className="flex items-center gap-7 border-b border-white/[0.07] mb-8 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveGame('voxel')}
          className={`pb-3 text-sm font-medium relative transition-colors whitespace-nowrap cursor-pointer ${
            activeGame === 'voxel' ? 'text-[#EDEDEF] font-semibold' : 'text-[#9A9AA2] hover:text-[#EDEDEF]'
          }`}
        >
          <span>3D Voxel Craft</span>
          {activeGame === 'voxel' && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#F6B8D0] shadow-[0_0_8px_#F6B8D0]" />
          )}
        </button>

        <button
          onClick={() => setActiveGame('tictactoe')}
          className={`pb-3 text-sm font-medium relative transition-colors whitespace-nowrap cursor-pointer ${
            activeGame === 'tictactoe' ? 'text-[#EDEDEF] font-semibold' : 'text-[#9A9AA2] hover:text-[#EDEDEF]'
          }`}
        >
          <span>Tic-Tac-Toe Showdown</span>
          {activeGame === 'tictactoe' && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#F6B8D0] shadow-[0_0_8px_#F6B8D0]" />
          )}
        </button>
      </div>

      {/* ─── GAME VIEW ──────────────────────────────────────────────────────────── */}
      {activeGame === 'voxel' ? (
        <VoxelGame />
      ) : (
        <div className="max-w-xl mx-auto py-6 space-y-6 text-center animate-fade-in">
          <div className="flex items-center justify-between border-b border-white/[0.07] pb-4">
            <div className="text-left">
              <h2 className="font-['Sora',sans-serif] text-base font-semibold text-[#EDEDEF]">Tic-Tac-Toe</h2>
              <p className="text-xs text-[#9A9AA2] mt-0.5">Local turn-based match</p>
            </div>

            <button
              onClick={resetGame}
              className="btn-secondary text-xs px-3.5 py-1.5"
            >
              Reset Board
            </button>
          </div>

          {/* Scores Row */}
          <div className="grid grid-cols-3 gap-4 text-center py-2">
            <div>
              <div className="text-[11px] font-semibold text-[#5C5C64] uppercase tracking-wider">Player X</div>
              <div className="text-lg font-bold text-[#EDEDEF] font-mono mt-0.5">{scores.x} Wins</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-[#5C5C64] uppercase tracking-wider">Draws</div>
              <div className="text-lg font-bold text-[#9A9AA2] font-mono mt-0.5">{scores.draws}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-[#5C5C64] uppercase tracking-wider">Player O</div>
              <div className="text-lg font-bold text-[#EDEDEF] font-mono mt-0.5">{scores.o} Wins</div>
            </div>
          </div>

          {/* Status Message */}
          <div className="text-xs font-medium text-[#9A9AA2]">
            {winner ? (
              <span className="text-[#F6B8D0] font-bold">Player {winner} Wins!</span>
            ) : isDraw ? (
              <span className="text-[#EDEDEF] font-bold">Match ended in a draw!</span>
            ) : (
              <span>Turn: <strong className="text-[#EDEDEF]">Player {isXNext ? 'X' : 'O'}</strong></span>
            )}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-3 gap-3 max-w-[260px] mx-auto pt-2">
            {board.map((square, idx) => (
              <button
                key={idx}
                onClick={() => handleClickSquare(idx)}
                className="w-20 h-20 rounded-[10px] bg-[#111113] hover:bg-[#17171A] border border-white/15 flex items-center justify-center text-2xl font-bold text-[#EDEDEF] font-mono transition-all cursor-pointer hover:border-white/30 active:scale-95"
              >
                {square}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
