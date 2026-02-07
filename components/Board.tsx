import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  BOARD_WIDTH, 
  BOARD_HEIGHT, 
  PUCK_RADIUS, 
  COLORS, 
  GATE_WIDTH, 
  MAX_FLING_STRENGTH,
  AI_CONFIG
} from '../constants';
import { Puck, Vector, GameState, AIDifficulty } from '../types';
import { PhysicsEngine } from '../services/PhysicsEngine';
import { SlingAI } from '../services/SlingAI';
import { multiplayer } from '../services/MultiplayerService';

interface BoardProps {
  gameState: GameState;
  currentPlayerId: string;
  difficulty: AIDifficulty;
  onStateUpdate: (state: GameState) => void;
  onWin: (winnerId: string) => void;
  isSpectator?: boolean;
  matchId?: string;
}

const Board: React.FC<BoardProps> = ({ 
  gameState, 
  currentPlayerId, 
  difficulty,
  onStateUpdate, 
  onWin, 
  isSpectator = false,
  matchId
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  
  const [dragStart, setDragStart] = useState<Vector | null>(null);
  const [draggingPuckId, setDraggingPuckId] = useState<string | null>(null);
  const [isDraggingOpening, setIsDraggingOpening] = useState(false);
  const [currentDragPos, setCurrentDragPos] = useState<Vector | null>(null);

  const winTriggered = useRef(false);
  const stateRef = useRef(gameState);

  // Sync stateRef with props
  useEffect(() => {
    stateRef.current = gameState;
    if (!gameState.winnerId) {
      winTriggered.current = false;
    }
  }, [gameState]);

  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  const playPuckSound = useCallback((strength: number) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    const volume = Math.min(0.2, strength / 100);
    const freq = 150 + (strength * 10);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }, []);

  const getMousePos = (e: any): Vector => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const scaleX = BOARD_WIDTH / rect.width;
    const scaleY = BOARD_HEIGHT / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const handleStart = (e: any) => {
    initAudio();
    if (e.cancelable) e.preventDefault();
    if (isSpectator || gameState.winnerId) return;
    const pos = getMousePos(e);
    const isTopPlayer = currentPlayerId === gameState.player1Id;
    const middleY = BOARD_HEIGHT / 2;

    const isOpeningPhase = isTopPlayer ? gameState.isOpeningMove1 : gameState.isOpeningMove2;

    if (isOpeningPhase) {
      const bandY = isTopPlayer ? 30 : BOARD_HEIGHT - 30;
      if (Math.abs(pos.y - bandY) < 60) {
        setIsDraggingOpening(true);
        setDragStart(pos);
        setCurrentDragPos(pos);
      }
      return;
    }

    const puck = gameState.pucks.find(p => {
      const dist = Math.sqrt(Math.pow(p.pos.x - pos.x, 2) + Math.pow(p.pos.y - pos.y, 2));
      const onCorrectSide = isTopPlayer ? p.pos.y < middleY : p.pos.y > middleY;
      return dist < p.radius * 2.5 && onCorrectSide;
    });

    if (puck) {
      setDraggingPuckId(puck.id);
      setDragStart(pos);
      setCurrentDragPos(pos);
    }
  };

  const handleMove = (e: any) => {
    if (e.cancelable) e.preventDefault();
    if (!draggingPuckId && !isDraggingOpening) return;
    setCurrentDragPos(getMousePos(e));
  };

  const handleEnd = (e: any) => {
    if (isDraggingOpening && dragStart && currentDragPos) {
      const isTopPlayer = currentPlayerId === gameState.player1Id;
      const dy = currentDragPos.y - dragStart.y;
      const strength = Math.min(Math.abs(dy) / 3, MAX_FLING_STRENGTH);
      const sign = isTopPlayer ? 1 : -1;

      const newPucks = stateRef.current.pucks.map(p => {
        const middleY = BOARD_HEIGHT / 2;
        const onOurSide = isTopPlayer ? p.pos.y < middleY : p.pos.y > middleY;
        if (onOurSide) {
          return { ...p, vel: { x: (Math.random() - 0.5) * 2, y: sign * strength } };
        }
        return p;
      });

      onStateUpdate({ 
        ...stateRef.current, 
        pucks: newPucks, 
        isOpeningMove1: isTopPlayer ? false : stateRef.current.isOpeningMove1,
        isOpeningMove2: !isTopPlayer ? false : stateRef.current.isOpeningMove2
      });
      setIsDraggingOpening(false);
      setDragStart(null);
      setCurrentDragPos(null);
      return;
    }

    if (!draggingPuckId || !dragStart || !currentDragPos) {
      setDraggingPuckId(null);
      setIsDraggingOpening(false);
      setDragStart(null);
      return;
    }

    const dx = dragStart.x - currentDragPos.x;
    const dy = dragStart.y - currentDragPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    const strength = Math.min(dist / 5, MAX_FLING_STRENGTH);
    const angle = Math.atan2(dy, dx);

    const newPucks = stateRef.current.pucks.map(p => {
      if (p.id === draggingPuckId) {
        return {
          ...p,
          vel: {
            x: Math.cos(angle) * strength,
            y: Math.sin(angle) * strength
          }
        };
      }
      return p;
    });

    onStateUpdate({ ...stateRef.current, pucks: newPucks });
    setDraggingPuckId(null);
    setDragStart(null);
    setCurrentDragPos(null);
  };

  useEffect(() => {
    // Only the primary player or AI-controlling player computes physics
    // For simplicity, Player 1 acts as the "host" of the match state if they are human
    // If Player 1 is AI, Player 2 acts as host. If both human, Player 1.
    const isHost = !isSpectator && (currentPlayerId === gameState.player1Id || (gameState.player1Id.startsWith('ai_') && currentPlayerId === gameState.player2Id));

    if (!isHost && !isSpectator) return; // Non-host human players wait for host sync?
    // Actually, in Local Storage multiplayer, each client can compute its own physics 
    // BUT spectators need one definitive source.
    
    const interval = setInterval(() => {
      const current = stateRef.current;
      if (current.winnerId || winTriggered.current) return;
      if (isSpectator) return; // Spectators don't compute physics, they just render

      let updatedPucks = current.pucks.map(p => PhysicsEngine.updatePuck(p, playPuckSound));
      updatedPucks = PhysicsEngine.resolvePuckCollisions(updatedPucks, playPuckSound);

      const middleY = BOARD_HEIGHT / 2;
      const topPucksCount = updatedPucks.filter(p => p.pos.y < middleY).length;
      const bottomPucksCount = updatedPucks.filter(p => p.pos.y > middleY).length;

      const newState = { ...current, pucks: updatedPucks };

      if (topPucksCount === 0 && !winTriggered.current) {
        winTriggered.current = true;
        onWin(current.player1Id);
        newState.winnerId = current.player1Id;
      } else if (bottomPucksCount === 0 && !winTriggered.current) {
        winTriggered.current = true;
        onWin(current.player2Id);
        newState.winnerId = current.player2Id;
      }

      onStateUpdate(newState);
      
      // BROADCAST FOR SPECTATORS
      if (matchId) {
        multiplayer.broadcastMatchState(matchId, newState);
      }
    }, 1000 / 60);

    return () => clearInterval(interval);
  }, [onWin, onStateUpdate, playPuckSound, isSpectator, currentPlayerId, matchId]);

  useEffect(() => {
    if (!isSpectator) return;
    if (!matchId) return;

    // Spectators listen to the match stream
    const unsub = multiplayer.subscribeMatchState(matchId, (syncedState) => {
      onStateUpdate(syncedState);
    });
    return unsub;
  }, [isSpectator, matchId, onStateUpdate]);

  useEffect(() => {
    const isTopAI = stateRef.current.player1Id.startsWith('ai_');
    const isBottomAI = stateRef.current.player2Id.startsWith('ai_');
    if (!isTopAI && !isBottomAI) return;
    if (isSpectator) return;

    const config = AI_CONFIG[difficulty];

    const aiLoop = async () => {
      const current = stateRef.current;
      if (current.winnerId || winTriggered.current) return;

      if (isTopAI && current.isOpeningMove1) {
        const newPucks = current.pucks.map(p => p.pos.y < BOARD_HEIGHT / 2 ? { ...p, vel: { x: 0, y: 15 + Math.random() * 10 } } : p);
        onStateUpdate({ ...current, pucks: newPucks, isOpeningMove1: false });
        return;
      }
      if (isBottomAI && current.isOpeningMove2) {
        const newPucks = current.pucks.map(p => p.pos.y > BOARD_HEIGHT / 2 ? { ...p, vel: { x: 0, y: -(15 + Math.random() * 10) } } : p);
        onStateUpdate({ ...current, pucks: newPucks, isOpeningMove2: false });
        return;
      }

      const waitTime = config.delay[0] + Math.random() * (config.delay[1] - config.delay[0]);
      setTimeout(() => {
        const snap = stateRef.current;
        if (isTopAI) {
          const move = SlingAI.decideMove(snap.pucks, snap.player1Id, 'top', difficulty);
          if (move) {
            const finalPucks = snap.pucks.map(p => p.id === move.puckId ? { ...p, vel: move.force } : p);
            onStateUpdate({ ...snap, pucks: finalPucks });
          }
        }
        if (isBottomAI) {
          const move = SlingAI.decideMove(snap.pucks, snap.player2Id, 'bottom', difficulty);
          if (move) {
            const finalPucks = snap.pucks.map(p => p.id === move.puckId ? { ...p, vel: move.force } : p);
            onStateUpdate({ ...snap, pucks: finalPucks });
          }
        }
      }, waitTime);
    };

    const aiInterval = setInterval(aiLoop, 1500); 
    return () => clearInterval(aiInterval);
  }, [onStateUpdate, difficulty, isSpectator]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const current = stateRef.current;
      ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      ctx.fillStyle = COLORS.BOARD;
      ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      
      ctx.strokeStyle = COLORS.BOARD_BORDER;
      ctx.lineWidth = 14;
      ctx.strokeRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      
      ctx.fillStyle = COLORS.BOARD_BORDER;
      ctx.fillRect(0, BOARD_HEIGHT / 2 - 7, BOARD_WIDTH / 2 - GATE_WIDTH / 2, 14);
      ctx.fillRect(BOARD_WIDTH / 2 + GATE_WIDTH / 2, BOARD_HEIGHT / 2 - 7, BOARD_WIDTH / 2 - GATE_WIDTH / 2, 14);

      const isTopPlayer = currentPlayerId === current.player1Id;
      const showMyBand = !isSpectator && (isTopPlayer ? current.isOpeningMove1 : current.isOpeningMove2);
      
      if (showMyBand) {
        const bandY = isTopPlayer ? 30 : BOARD_HEIGHT - 30;
        ctx.beginPath();
        ctx.strokeStyle = COLORS.RUBBER;
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        
        if (isDraggingOpening && currentDragPos) {
          ctx.moveTo(10, bandY);
          ctx.quadraticCurveTo(currentDragPos.x, currentDragPos.y, BOARD_WIDTH - 10, bandY);
        } else {
          ctx.moveTo(10, bandY);
          ctx.lineTo(BOARD_WIDTH - 10, bandY);
        }
        ctx.stroke();
        ctx.closePath();

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText("PULL TO START", BOARD_WIDTH / 2, bandY + (isTopPlayer ? 40 : -40));
      }

      current.pucks.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2);
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.closePath();
      });

      if (draggingPuckId && dragStart && currentDragPos) {
        ctx.beginPath();
        ctx.moveTo(dragStart.x, dragStart.y);
        ctx.lineTo(currentDragPos.x, currentDragPos.y);
        ctx.strokeStyle = COLORS.ACCENT;
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.closePath();
      }
      requestAnimationFrame(render);
    };
    const animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [draggingPuckId, dragStart, currentDragPos, isDraggingOpening, currentPlayerId, isSpectator]);

  const isUserWinner = gameState.winnerId === currentPlayerId;

  return (
    <div className="flex flex-col items-center">
      <div className="relative bg-slate-900 p-3 rounded-[2.5rem] shadow-2xl border-[10px] border-slate-800 overflow-hidden">
        <canvas
          ref={canvasRef}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
          className="rounded-2xl cursor-crosshair max-w-full h-auto touch-none"
        />
        {gameState.winnerId && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 rounded-2xl backdrop-blur-md z-50 animate-in fade-in zoom-in-95 duration-500">
             <div className={`text-center p-10 rounded-[3rem] border-4 shadow-3xl ${isUserWinner ? 'bg-slate-800 border-amber-500' : 'bg-slate-900 border-red-500'}`}>
               <div className="text-7xl mb-4">{isUserWinner ? '🏆' : '👎'}</div>
               <h2 className={`text-6xl font-oswald font-black uppercase italic tracking-tighter leading-none ${isUserWinner ? 'text-amber-500' : 'text-red-500'}`}>
                 {isUserWinner ? 'VICTORY!' : 'DEFEATED!'}
               </h2>
               <p className="text-white/60 font-black uppercase text-xs tracking-[0.3em] mt-4">
                 {isUserWinner ? 'You conquered this round!' : 'The Bot outplayed you!'}
               </p>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Board;