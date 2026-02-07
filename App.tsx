
import React, { useState, useEffect, useRef } from 'react';
// Added PlayerType to the imports from types.ts
import { Tournament, TournamentStatus, Player, Match, MatchStatus, GameState, Puck, PlayerStatus, AIDifficulty, PlayerType } from './types';
import { multiplayer } from './services/MultiplayerService';
import { BOARD_WIDTH, BOARD_HEIGHT, PUCK_RADIUS, COLORS, PUCKS_PER_PLAYER } from './constants';
import Board from './components/Board';
import { GoogleGenAI, Modality } from "@google/genai";

const playTournamentSound = (isWinner: boolean) => {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 44100});
  const playPop = (freq: number, duration: number, volume: number) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  };
  if (isWinner) {
    for (let i = 0; i < 20; i++) setTimeout(() => playPop(100 + Math.random() * 600, 0.8, 0.3 + Math.random() * 0.4), i * 250);
  } else {
    for (let i = 0; i < 3; i++) setTimeout(() => playPop(60, 2.0, 0.4), i * 1000);
  }
};

function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}

const createInitialGameState = (p1Id: string, p2Id: string): GameState => {
  const pucks: Puck[] = [];
  for (let i = 0; i < PUCKS_PER_PLAYER; i++) {
    pucks.push({
      id: `p1_${i}`, pos: { x: (BOARD_WIDTH / (PUCKS_PER_PLAYER + 1)) * (i + 1), y: 100 },
      vel: { x: 0, y: 0 }, radius: PUCK_RADIUS, ownerId: p1Id, color: COLORS.PLAYER1
    });
    pucks.push({
      id: `p2_${i}`, pos: { x: (BOARD_WIDTH / (PUCKS_PER_PLAYER + 1)) * (i + 1), y: BOARD_HEIGHT - 100 },
      vel: { x: 0, y: 0 }, radius: PUCK_RADIUS, ownerId: p2Id, color: COLORS.PLAYER2
    });
  }
  return { pucks, player1Id: p1Id, player2Id: p2Id, timer: 0, isPaused: false, isOpeningMove1: true, isOpeningMove2: true };
};

const App: React.FC = () => {
  const [view, setView] = useState<'HOME' | 'LOBBY' | 'MATCH' | 'TOURNAMENT_OVER'>('HOME');
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState<Match | null>(null);
  const [localGameState, setLocalGameState] = useState<GameState | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  
  const [tName, setTName] = useState('World Series');
  const [pCount, setPCount] = useState(8);
  const [userName, setUserName] = useState('Player_' + Math.floor(Math.random() * 1000));
  const [difficulty, setDifficulty] = useState<AIDifficulty>(AIDifficulty.MEDIUM);

  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const voiceSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const savedId = localStorage.getItem('sling_puck_player_id');
    const savedName = localStorage.getItem('sling_puck_player_name');
    if (savedId) setMyPlayerId(savedId);
    if (savedName) setUserName(savedName);

    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      const t = multiplayer.getTournamentByCode(room);
      if (t) {
        setTournament(t);
        const result = multiplayer.joinTournament(room, userName, savedId || undefined);
        if (result) {
          setMyPlayerId(result.playerId);
          localStorage.setItem('sling_puck_player_id', result.playerId);
          setView('LOBBY');
        }
      }
    }
  }, []);

  useEffect(() => {
    const unsubscribeT = multiplayer.subscribe((updatedT) => {
      if (tournament && updatedT.id === tournament.id) {
        setTournament(updatedT);
        if (activeMatch) {
          const freshMatch = updatedT.matches.find(m => m.id === activeMatch.id);
          if (freshMatch && freshMatch.status === MatchStatus.COMPLETED) {
            setTimeout(() => {
              setActiveMatch(null);
              setLocalGameState(null);
              if (updatedT.status === TournamentStatus.FINISHED) {
                const winnerId = updatedT.players.find(p => p.status === PlayerStatus.WINNER)?.id;
                playTournamentSound(winnerId === myPlayerId);
                setView('TOURNAMENT_OVER');
              } else {
                setView('LOBBY');
              }
            }, 1800);
          }
        }
      }
    });
    return unsubscribeT;
  }, [tournament, activeMatch, myPlayerId]);

  const handleCreateTournament = () => {
    const t = multiplayer.createTournament(tName, pCount, userName, difficulty);
    setTournament(t);
    setMyPlayerId(t.creatorId);
    localStorage.setItem('sling_puck_player_id', t.creatorId);
    setView('LOBBY');
    window.history.replaceState({}, '', `?room=${t.roomCode}`);
  };

  const handleJoinByCode = () => {
    if (!joinCodeInput) return;
    const result = multiplayer.joinTournament(joinCodeInput.toUpperCase(), userName, myPlayerId || undefined);
    if (result) {
      setTournament(result.tournament);
      setMyPlayerId(result.playerId);
      localStorage.setItem('sling_puck_player_id', result.playerId);
      setView('LOBBY');
      window.history.replaceState({}, '', `?room=${result.tournament.roomCode}`);
    } else {
      alert("Room not found or locked!");
    }
  };

  const handleJoinRandom = () => {
    const t = multiplayer.findRandomTournament();
    if (t) {
      const result = multiplayer.joinTournament(t.roomCode, userName, myPlayerId || undefined);
      if (result) {
        setTournament(result.tournament);
        setMyPlayerId(result.playerId);
        localStorage.setItem('sling_puck_player_id', result.playerId);
        setView('LOBBY');
        window.history.replaceState({}, '', `?room=${result.tournament.roomCode}`);
      }
    } else {
      alert("No public rooms available!");
    }
  };

  const handleToggleLock = () => {
    if (tournament) {
      const updated = multiplayer.toggleLock(tournament.roomCode);
      if (updated) setTournament(updated);
    }
  };

  const handleStartTournament = () => {
    if (tournament) multiplayer.startTournament(tournament.roomCode);
  };

  const handleStartMatch = (match: Match) => {
    setActiveMatch(match);
    setLocalGameState(createInitialGameState(match.players[0], match.players[1]));
    setView('MATCH');
  };

  const handleMatchWin = (winnerId: string) => {
    if (tournament && activeMatch) multiplayer.updateMatchResult(tournament.roomCode, activeMatch.id, winnerId);
  };

  const handleExitToHome = () => {
    window.history.replaceState({}, '', window.location.pathname);
    setTournament(null);
    setActiveMatch(null);
    setLocalGameState(null);
    setView('HOME');
  };

  const toggleVoice = async () => {
    if (isVoiceActive) {
      voiceSessionRef.current?.close();
      setIsVoiceActive(false);
      return;
    }
    try {
      const isCurrentlyPlaying = activeMatch?.players.includes(myPlayerId || '');
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      inputCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: async () => {
            if (isCurrentlyPlaying) {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              const source = inputCtxRef.current!.createMediaStreamSource(stream);
              const scriptProcessor = inputCtxRef.current!.createScriptProcessor(4096, 1, 1);
              scriptProcessor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const int16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
                sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
              };
              source.connect(scriptProcessor);
              scriptProcessor.connect(inputCtxRef.current!.destination);
            }
          },
          onmessage: async (msg) => {
            const b64 = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (b64) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtxRef.current!.currentTime);
              const buffer = await decodeAudioData(decode(b64), outputCtxRef.current!, 24000, 1);
              const source = outputCtxRef.current!.createBufferSource();
              source.buffer = buffer; source.connect(outputCtxRef.current!.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
            }
          },
          onerror: () => setIsVoiceActive(false),
          onclose: () => setIsVoiceActive(false)
        },
        config: { 
          responseModalities: [Modality.AUDIO], 
          systemInstruction: isCurrentlyPlaying 
            ? 'You are a hype commentator for this Sling Puck match. You hear the active players and repeat their energy while giving play-by-play commentary.' 
            : 'You are a radio broadcast of the match. You relay what the active players are saying to the spectators. Act as a commentator.'
        }
      });
      voiceSessionRef.current = await sessionPromise;
      setIsVoiceActive(true);
    } catch (e) { setIsVoiceActive(false); }
  };

  const renderHome = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 space-y-12 bg-slate-950 text-white">
      <div className="text-center animate-in fade-in zoom-in duration-700">
        <h1 className="text-8xl md:text-[11rem] font-oswald font-black italic leading-none drop-shadow-3xl text-amber-500">SLING PUCK</h1>
        <div className="h-2 w-48 bg-white mx-auto rounded-full mt-4 opacity-20" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-5xl">
        {/* JOIN BOX */}
        <div className="bg-slate-900/60 p-10 rounded-[3rem] border-2 border-slate-800 shadow-2xl flex flex-col">
          <h2 className="text-3xl font-oswald mb-8 italic uppercase tracking-wider text-slate-400">JOIN ARENA</h2>
          <div className="space-y-6">
            <input 
              value={joinCodeInput} 
              onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} 
              maxLength={6} 
              className="w-full bg-slate-950 border-2 border-slate-700 rounded-2xl px-5 py-6 text-center font-black text-5xl text-amber-500 outline-none focus:border-amber-500 transition-all" 
              placeholder="CODE" 
            />
            <button 
              onClick={handleJoinByCode} 
              className="w-full py-6 bg-amber-500 text-slate-950 font-black text-2xl rounded-2xl uppercase italic hover:bg-amber-600 active:scale-95 transition-all shadow-lg shadow-amber-500/20"
            >
              ENTER ROOM
            </button>
            <div className="flex items-center gap-4 py-2">
                <div className="h-px flex-1 bg-slate-800"></div>
                <span className="text-[10px] text-slate-600 font-black">OR</span>
                <div className="h-px flex-1 bg-slate-800"></div>
            </div>
            <button 
              onClick={handleJoinRandom} 
              className="w-full py-5 bg-blue-600 text-white font-black text-xl rounded-2xl uppercase hover:bg-blue-700 active:scale-95 transition-all shadow-lg shadow-blue-500/20"
            >
              FIND QUICK BATTLE
            </button>
          </div>
        </div>

        {/* CREATE BOX */}
        <div className="bg-slate-900/60 p-10 rounded-[3rem] border-2 border-slate-800 shadow-2xl flex flex-col">
          <h2 className="text-3xl font-oswald mb-8 italic uppercase tracking-wider text-slate-400">HOST ARENA</h2>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 ml-2 uppercase">Arena Name</label>
              <input 
                value={tName} 
                onChange={e => setTName(e.target.value)} 
                className="w-full bg-slate-950 border-2 border-slate-700 rounded-2xl px-6 py-4 font-bold outline-none focus:border-green-500 transition-all" 
                placeholder="World Series" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 ml-2 uppercase">Size</label>
              <div className="flex items-center gap-4 bg-slate-950 p-2 rounded-2xl border-2 border-slate-700">
                <button onClick={() => setPCount(Math.max(2, pCount - 2))} className="w-12 h-12 flex items-center justify-center bg-slate-800 rounded-xl font-black text-2xl">-</button>
                <div className="flex-1 text-center font-black text-3xl text-amber-500">{pCount}</div>
                <button onClick={() => setPCount(Math.min(32, pCount + 2))} className="w-12 h-12 flex items-center justify-center bg-slate-800 rounded-xl font-black text-2xl">+</button>
              </div>
            </div>
            <button 
              onClick={handleCreateTournament} 
              className="w-full py-6 bg-green-600 text-white font-black text-2xl rounded-2xl uppercase italic hover:bg-green-700 active:scale-95 transition-all shadow-lg shadow-green-500/20"
            >
              CREATE ROOM
            </button>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 px-10 py-5 rounded-full border-2 border-slate-800 flex items-center gap-8 shadow-2xl backdrop-blur-md">
        <span className="text-slate-500 font-black text-[10px] uppercase tracking-widest">YOUR ALIAS:</span>
        <input 
          value={userName} 
          onChange={e => { setUserName(e.target.value); localStorage.setItem('sling_puck_player_name', e.target.value); }} 
          className="bg-transparent text-amber-500 font-black text-3xl outline-none w-64 border-b-2 border-transparent focus:border-amber-500/30 transition-all text-center" 
        />
      </div>
    </div>
  );

  const renderLobby = () => {
    const sortedPlayers = [...(tournament?.players || [])].sort((a, b) => b.score - a.score);
    const isCreator = tournament?.creatorId === myPlayerId;
    const inviteLink = `${window.location.origin}${window.location.pathname}?room=${tournament?.roomCode}`;

    return (
      <div className="min-h-screen p-8 text-white max-w-7xl mx-auto space-y-8 bg-slate-950">
        <div className="flex flex-col md:flex-row justify-between items-center bg-slate-900/80 p-8 rounded-[3rem] border-2 border-slate-800 shadow-2xl gap-8">
          <button 
            onClick={handleExitToHome} 
            className="px-8 py-3 bg-slate-800 rounded-full text-slate-400 font-black text-xs uppercase hover:text-white hover:bg-red-900/40 transition-all border border-slate-700"
          >
            ← EXIT LOBBY
          </button>
          
          <div className="text-center flex-1">
            <h2 className="text-5xl font-oswald font-black text-amber-500 italic uppercase leading-none tracking-tighter">{tournament?.name}</h2>
            <div className="flex flex-col items-center gap-2 mt-4">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">ROOM CODE:</span>
                  <span className="text-3xl font-black text-white bg-slate-950 border border-slate-800 px-6 py-2 rounded-2xl tracking-[0.2em] shadow-inner">{tournament?.roomCode}</span>
                </div>
                {isCreator && (
                    <button onClick={handleToggleLock} className={`mt-2 px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all shadow-lg ${tournament?.isLocked ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
                        {tournament?.isLocked ? '🔒 ROOM LOCKED' : '🔓 ROOM PUBLIC'}
                    </button>
                )}
            </div>
          </div>

          <div className="flex flex-col gap-3 w-full md:w-auto">
            <button 
              onClick={() => { 
                navigator.clipboard.writeText(inviteLink); 
                alert(`Invite Link Copied: ${inviteLink}`); 
              }} 
              className="bg-amber-500 text-slate-950 px-10 py-5 rounded-2xl text-sm font-black uppercase shadow-lg shadow-amber-500/20 hover:scale-105 active:scale-95 transition-all italic"
            >
              COPY INVITE LINK
            </button>
            <button 
              onClick={() => { 
                navigator.clipboard.writeText(tournament?.roomCode || ''); 
                alert(`Code ${tournament?.roomCode} copied to clipboard!`); 
              }} 
              className="bg-slate-800 text-white px-10 py-5 rounded-2xl text-sm font-black uppercase shadow-lg border border-slate-700 hover:bg-slate-700 active:scale-95 transition-all"
            >
              COPY CODE ONLY
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* RANKINGS */}
          <div className="lg:col-span-3 bg-slate-900/40 p-10 rounded-[3rem] border-2 border-slate-800 h-fit backdrop-blur-sm">
            <h3 className="text-xs font-black text-slate-600 uppercase mb-8 border-b border-slate-800 pb-3 tracking-widest">LEADERBOARD</h3>
            <div className="space-y-4">
              {sortedPlayers.map((p, idx) => (
                <div key={p.id} className={`flex items-center justify-between p-5 rounded-2xl border-2 transition-all ${p.id === myPlayerId ? 'bg-amber-500/10 border-amber-500 shadow-lg shadow-amber-500/10' : 'bg-slate-950 border-slate-900/50'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black ${idx < 3 ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                      {idx + 1}
                    </span>
                    <span className="text-sm font-bold truncate text-slate-200">{p.name}</span>
                  </div>
                  <span className="text-amber-500 font-black text-xs">{p.score}pts</span>
                </div>
              ))}
            </div>
          </div>

          {/* PROGRESSION */}
          <div className="lg:col-span-9 space-y-8">
            <div className="flex justify-between items-center px-4">
               <h3 className="text-xs font-black text-slate-600 uppercase tracking-widest">BRACKETS (ROUND {tournament?.currentRound})</h3>
               {isCreator && tournament?.status === TournamentStatus.LOBBY && (
                 <button 
                   onClick={handleStartTournament} 
                   className="px-12 py-5 bg-green-600 text-white font-black rounded-3xl text-2xl uppercase italic shadow-2xl shadow-green-500/20 hover:bg-green-700 hover:scale-105 active:scale-95 transition-all"
                 >
                   START ARENA ➔
                 </button>
               )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {tournament?.matches.filter(m => m.round === (tournament.currentRound || 1)).map(m => {
                const p1 = tournament.players.find(p => p.id === m.players[0]);
                const p2 = tournament.players.find(p => p.id === m.players[1]);
                const isPart = m.players.includes(myPlayerId || '');
                return (
                  <div key={m.id} className={`p-10 rounded-[3.5rem] border-2 transition-all shadow-xl ${isPart ? 'bg-amber-500/10 border-amber-500 ring-4 ring-amber-500/20' : 'bg-slate-900 border-slate-800'}`}>
                    <div className="flex items-center justify-between gap-8 mb-10 text-center">
                      <div className="flex flex-col flex-1 items-center">
                        <span className={`text-2xl font-oswald font-black uppercase truncate w-full ${m.winnerId === p1?.id ? 'text-green-500' : 'text-white'}`}>{p1?.name}</span>
                        {/* PlayerType is now properly imported */}
                        <span className="text-[10px] font-black text-slate-600 uppercase mt-1">{p1?.type === PlayerType.AI ? 'BOT' : 'PLAYER'}</span>
                      </div>
                      <div className="text-slate-700 font-black italic text-3xl opacity-50">VS</div>
                      <div className="flex flex-col flex-1 items-center">
                        <span className={`text-2xl font-oswald font-black uppercase truncate w-full ${m.winnerId === p2?.id ? 'text-green-500' : 'text-white'}`}>{p2?.name}</span>
                        {/* PlayerType is now properly imported */}
                        <span className="text-[10px] font-black text-slate-600 uppercase mt-1">{p2?.type === PlayerType.AI ? 'BOT' : 'PLAYER'}</span>
                      </div>
                    </div>
                    {m.status === MatchStatus.PENDING ? (
                      <button 
                        onClick={() => handleStartMatch(m)} 
                        className={`w-full py-6 rounded-[2rem] font-black text-2xl uppercase italic transition-all shadow-lg ${isPart ? 'bg-amber-500 text-slate-950 hover:bg-amber-600' : 'bg-slate-800 text-white hover:bg-slate-700'}`}
                      >
                        {isPart ? 'BATTLE NOW' : 'SPECTATE'}
                      </button>
                    ) : (
                      <div className="text-center font-black uppercase text-green-500 bg-green-950/20 py-5 rounded-[2rem] border border-green-900/50">
                        {tournament.players.find(p => p.id === m.winnerId)?.name} WON
                      </div>
                    )}
                  </div>
                );
              })}
              {tournament?.status === TournamentStatus.LOBBY && (
                <div className="p-10 rounded-[3.5rem] border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-600 space-y-4 min-h-[250px]">
                  <span className="text-5xl">⏳</span>
                  <div className="text-center">
                    <div className="font-black uppercase text-xs tracking-widest">WAITING FOR PLAYERS</div>
                    <div className="text-[10px] mt-1">({tournament.players.length} / {tournament.maxPlayers})</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const isSpectating = activeMatch && !activeMatch.players.includes(myPlayerId || '');

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-hidden">
      {view === 'HOME' && renderHome()}
      {view === 'LOBBY' && renderLobby()}
      {view === 'MATCH' && (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-950">
          <div className="w-full max-w-lg relative mb-10">
            {isSpectating && (
              <div className="absolute -top-14 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-red-600 px-6 py-2 rounded-full animate-pulse shadow-xl border-2 border-red-500/50">
                <div className="w-2.5 h-2.5 bg-white rounded-full" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">LIVE SPECTATING</span>
              </div>
            )}
            <div className="flex justify-between items-center px-10 py-6 bg-slate-900/90 rounded-[2.5rem] border-2 border-slate-800 shadow-3xl backdrop-blur-xl">
              <div className="flex flex-col items-start max-w-[140px]">
                <span className="text-xs font-black text-slate-500 uppercase mb-1">TEAM RED</span>
                <span className="text-3xl font-oswald font-black text-red-500 italic uppercase truncate w-full">{tournament?.players.find(p => p.id === activeMatch?.players[0])?.name}</span>
              </div>
              <div className="h-16 w-16 bg-slate-800 rounded-full flex items-center justify-center border-2 border-slate-700 text-slate-500 font-black italic text-2xl shadow-inner">VS</div>
              <div className="flex flex-col items-end max-w-[140px]">
                <span className="text-xs font-black text-slate-500 uppercase mb-1">TEAM BLUE</span>
                <span className="text-3xl font-oswald font-black text-blue-500 italic uppercase truncate w-full text-right">{tournament?.players.find(p => p.id === activeMatch?.players[1])?.name}</span>
              </div>
            </div>
          </div>
          
          {localGameState && (
            <Board 
              gameState={localGameState} 
              currentPlayerId={myPlayerId || ''} 
              difficulty={tournament?.difficulty || AIDifficulty.MEDIUM} 
              onStateUpdate={setLocalGameState} 
              onWin={handleMatchWin} 
              isSpectator={isSpectating} 
              matchId={activeMatch?.id} 
            />
          )}

          <div className="flex items-center gap-8 mt-12 bg-slate-900/50 p-4 rounded-full border border-slate-800/50 backdrop-blur-md">
            <button 
              onClick={toggleVoice} 
              className={`p-6 rounded-full border-4 transition-all hover:scale-110 active:scale-95 shadow-2xl ${isVoiceActive ? 'bg-red-500 text-white border-red-400 shadow-red-500/40' : 'bg-slate-800 text-slate-400 border-slate-700 shadow-black'}`}
            >
              <span className="text-4xl">{isVoiceActive ? '🎙️' : '🎤'}</span>
            </button>
            <button 
              onClick={() => setView('LOBBY')} 
              className="px-12 py-6 bg-slate-800 text-slate-400 font-black uppercase tracking-widest text-xs border-2 border-slate-700 rounded-full hover:bg-slate-700 hover:text-white transition-all shadow-xl"
            >
              EXIT TO BRACKETS
            </button>
          </div>
        </div>
      )}
      {view === 'TOURNAMENT_OVER' && (
        <div className="min-h-screen flex flex-col items-center justify-center p-12 text-center bg-slate-950 text-white relative">
          <div className="absolute inset-0 bg-gradient-to-t from-amber-500/20 to-transparent pointer-events-none" />
          <h1 className="text-[15rem] leading-none mb-12 animate-bounce drop-shadow-3xl">🏆</h1>
          <h2 className="text-8xl md:text-[10rem] font-oswald uppercase italic font-black text-amber-500 leading-none tracking-tighter drop-shadow-3xl">
            ARENA<br/>CHAMPION
          </h2>
          <div className="mt-16 relative z-10">
              <button 
                onClick={handleExitToHome} 
                className="px-24 py-10 bg-amber-500 text-slate-950 font-black rounded-[3rem] text-3xl uppercase tracking-widest italic shadow-3xl shadow-amber-500/30 hover:bg-amber-600 hover:scale-110 active:scale-95 transition-all"
              >
                RETURN HOME
              </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
