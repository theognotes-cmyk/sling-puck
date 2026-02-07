import React, { useState, useEffect, useRef } from 'react';
import { Tournament, TournamentStatus, Player, Match, MatchStatus, GameState, Puck, PlayerStatus, AIDifficulty } from './types';
import { multiplayer, ChatMessage } from './services/MultiplayerService';
import { BOARD_WIDTH, BOARD_HEIGHT, PUCK_RADIUS, COLORS, PUCKS_PER_PLAYER } from './constants';
import Board from './components/Board';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

// Firework and Atmosphere Sound Generator
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
    for (let i = 0; i < 20; i++) {
      setTimeout(() => {
        const volume = 0.3 + Math.random() * 0.4;
        const freq = 100 + Math.random() * 600;
        playPop(freq, 0.8, volume);
      }, i * 250 + Math.random() * 200);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        playPop(60, 2.0, 0.4);
      }, i * 1000);
    }
  }
};

// Audio Decoding Helpers
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
      id: `p1_${i}`,
      pos: { x: (BOARD_WIDTH / (PUCKS_PER_PLAYER + 1)) * (i + 1), y: 100 },
      vel: { x: 0, y: 0 },
      radius: PUCK_RADIUS,
      ownerId: p1Id,
      color: COLORS.PLAYER1
    });
    pucks.push({
      id: `p2_${i}`,
      pos: { x: (BOARD_WIDTH / (PUCKS_PER_PLAYER + 1)) * (i + 1), y: BOARD_HEIGHT - 100 },
      vel: { x: 0, y: 0 },
      radius: PUCK_RADIUS,
      ownerId: p2Id,
      color: COLORS.PLAYER2
    });
  }
  return { 
    pucks, 
    player1Id: p1Id, 
    player2Id: p2Id, 
    timer: 0, 
    isPaused: false,
    isOpeningMove1: true,
    isOpeningMove2: true
  };
};

const PartySlices = ({ count = 80 }) => (
  <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
    {[...Array(count)].map((_, i) => {
      const size = Math.random() * 20 + 10;
      const color = ['#fbbf24', '#ef4444', '#3b82f6', '#10b981', '#f472b6', '#a855f7'][Math.floor(Math.random() * 6)];
      return (
        <div key={i} className="absolute animate-slice-fall"
          style={{
            width: `${size}px`, height: `${size * 1.5}px`, backgroundColor: color,
            left: `${Math.random() * 100}%`, top: '-50px', opacity: 0.8,
            animationDelay: `${Math.random() * 5}s`, animationDuration: `${Math.random() * 2 + 2}s`,
            transform: `rotate(${Math.random() * 360}deg)`
          }}
        />
      );
    })}
    <style>{`
      @keyframes slice-fall {
        0% { transform: translateY(0) rotate(0deg); opacity: 0; }
        10% { opacity: 1; }
        100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
      }
      .animate-slice-fall { animation: slice-fall linear infinite; }
    `}</style>
  </div>
);

const App: React.FC = () => {
  const [view, setView] = useState<'HOME' | 'LOBBY' | 'MATCH' | 'TOURNAMENT_OVER'>('HOME');
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState<Match | null>(null);
  const [localGameState, setLocalGameState] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  const [tName, setTName] = useState('Ultimate Arena');
  const [pCount, setPCount] = useState(4);
  const [userName, setUserName] = useState('User_' + Math.floor(Math.random() * 1000));
  const [difficulty, setDifficulty] = useState<AIDifficulty>(AIDifficulty.MEDIUM);

  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const voiceSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    const savedId = localStorage.getItem('sling_puck_player_id');
    const savedName = localStorage.getItem('sling_puck_player_name');
    if (savedId) setMyPlayerId(savedId);
    if (savedName) setUserName(savedName);

    const hash = window.location.hash.replace('#', '');
    if (hash && hash.startsWith('join_')) {
      const tId = hash.split('_')[1];
      const found = multiplayer.getTournament(tId);
      if (found) {
        setTournament(found);
        setView('LOBBY');
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
    const unsubscribeChat = multiplayer.subscribeChat((msg) => setMessages(prev => [...prev.slice(-20), msg]));
    return () => { unsubscribeT(); unsubscribeChat(); };
  }, [tournament, activeMatch, myPlayerId]);

  const handleCreateTournament = () => {
    let finalCount = pCount;
    if (finalCount % 2 !== 0) finalCount += 1;
    if (finalCount < 2) finalCount = 2;

    const t = multiplayer.createTournament(tName, finalCount, userName, difficulty);
    setTournament(t);
    setMyPlayerId(t.creatorId);
    localStorage.setItem('sling_puck_player_id', t.creatorId);
    localStorage.setItem('sling_puck_player_name', userName);
    setView('LOBBY');
    window.location.hash = `join_${t.id}`;
  };

  const handleJoin = () => {
    if (!tournament) return;
    const result = multiplayer.joinTournament(tournament.id, userName);
    if (result) {
      setTournament(result.tournament);
      setMyPlayerId(result.playerId);
      localStorage.setItem('sling_puck_player_id', result.playerId);
      localStorage.setItem('sling_puck_player_name', userName);
    }
  };

  const handleStartTournament = () => {
    if (tournament) {
      multiplayer.startTournament(tournament.id, true);
    }
  };

  const startQuickMatch = (vsAI: boolean) => {
    const t = multiplayer.createTournament(vsAI ? 'Practice' : 'Duel', 2, userName, difficulty);
    setTournament(t);
    setMyPlayerId(t.creatorId);
    localStorage.setItem('sling_puck_player_id', t.creatorId);
    localStorage.setItem('sling_puck_player_name', userName);
    if (vsAI) {
      multiplayer.startTournament(t.id, true);
      const startedT = multiplayer.getTournament(t.id);
      if (startedT && startedT.matches.length > 0) {
        setTournament(startedT);
        handleStartMatch(startedT.matches[0]);
      }
    } else {
      setView('LOBBY');
      window.location.hash = `join_${t.id}`;
    }
  };

  const handleStartMatch = (match: Match) => {
    setActiveMatch(match);
    setLocalGameState(createInitialGameState(match.players[0], match.players[1]));
    setView('MATCH');
  };

  const handleMatchWin = (winnerId: string) => {
    if (tournament && activeMatch) multiplayer.updateMatchResult(tournament.id, activeMatch.id, winnerId);
  };

  const handleBackToHome = () => {
    if (voiceSessionRef.current) {
        try { voiceSessionRef.current.close(); } catch (e) {}
    }
    setTournament(null);
    setActiveMatch(null);
    setLocalGameState(null);
    setMessages([]);
    window.location.hash = '';
    setView('HOME');
  };

  const toggleVoice = async () => {
    if (isVoiceActive) {
      if (voiceSessionRef.current) {
          try { voiceSessionRef.current.close(); } catch(e) {}
      }
      setIsVoiceActive(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (msg) => {
            const b64 = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (b64) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              const buffer = await decodeAudioData(decode(b64), outputCtx, 24000, 1);
              const source = outputCtx.createBufferSource();
              source.buffer = buffer; 
              source.connect(outputCtx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              audioSourcesRef.current.add(source);
            }
          },
          onerror: (e) => setIsVoiceActive(false),
          onclose: () => setIsVoiceActive(false)
        },
        config: { 
            responseModalities: [Modality.AUDIO], 
            systemInstruction: 'You are an energetic and funny commentator for a Sling Puck game. React to high-speed moves and goals!' 
        }
      });
      
      voiceSessionRef.current = await sessionPromise;
      setIsVoiceActive(true);
    } catch (e: any) { 
      setIsVoiceActive(false);
    }
  };

  const renderHome = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 space-y-12">
      <div className="text-center animate-in fade-in zoom-in duration-700">
        <h1 className="text-8xl md:text-[11rem] font-oswald font-black italic text-white leading-none drop-shadow-3xl">SLING PUCK</h1>
        <div className="h-2 w-48 bg-amber-500 mx-auto rounded-full mt-4" />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
        <div className="bg-slate-800/40 p-10 rounded-[3rem] border-2 border-slate-700 shadow-2xl flex flex-col justify-between">
          <div>
            <h2 className="text-3xl font-oswald mb-6 italic text-white">INSTANT BATTLE</h2>
            <div className="space-y-4">
              <button onClick={() => startQuickMatch(true)} className="w-full py-5 bg-amber-500 text-slate-900 font-black text-2xl rounded-2xl uppercase italic hover:bg-amber-600 transition-all">PLAYER VS BOT</button>
              <button onClick={() => startQuickMatch(false)} className="w-full py-5 bg-slate-700 text-white font-black text-2xl rounded-2xl uppercase hover:bg-slate-600 transition-all">PLAYER VS PLAYER</button>
            </div>
          </div>
          <div className="mt-8">
            <h3 className="text-xs font-black text-slate-500 uppercase mb-4 tracking-widest">Bot Difficulty</h3>
            <div className="grid grid-cols-3 gap-2">
              {[AIDifficulty.EASY, AIDifficulty.MEDIUM, AIDifficulty.HARD].map(d => (
                <button 
                  key={d} 
                  onClick={() => setDifficulty(d)}
                  className={`py-2 rounded-xl text-xs font-black transition-all border-2 ${difficulty === d ? 'bg-amber-500 border-amber-400 text-slate-900' : 'bg-slate-900 border-slate-800 text-slate-500'}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="bg-slate-800/40 p-10 rounded-[3rem] border-2 border-slate-700 shadow-2xl">
          <h2 className="text-3xl font-oswald mb-6 italic text-white">TOURNAMENT</h2>
          <div className="space-y-4">
            <input value={tName} onChange={e => setTName(e.target.value)} className="w-full bg-slate-950/80 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-bold focus:border-amber-500 outline-none" placeholder="Arena Name" />
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-4 bg-slate-950/60 p-3 rounded-2xl">
                    <span className="text-xs font-black text-slate-500 uppercase">Players (Even):</span>
                    <input 
                        type="number" step="2" min="2" max="32" value={pCount} 
                        onChange={e => setPCount(parseInt(e.target.value) || 2)} 
                        className="bg-transparent text-amber-500 font-black text-2xl outline-none w-full" 
                    />
                </div>
            </div>
            <button onClick={handleCreateTournament} className="w-full py-5 bg-blue-600 text-white font-black text-2xl rounded-2xl uppercase hover:bg-blue-700 transition-all shadow-lg">CREATE ROOM</button>
          </div>
        </div>
      </div>
      <div className="bg-slate-900 px-10 py-5 rounded-full border-2 border-slate-800 flex items-center gap-8 shadow-2xl">
        <span className="text-slate-500 font-black text-xs">ALIAS:</span>
        <input value={userName} onChange={e => { setUserName(e.target.value); localStorage.setItem('sling_puck_player_name', e.target.value); }} className="bg-transparent text-amber-500 font-black text-3xl outline-none w-52" />
      </div>
    </div>
  );

  const renderLobby = () => {
    // Sort players by score for the rankings
    const sortedPlayers = [...(tournament?.players || [])].sort((a, b) => b.score - a.score);

    return (
      <div className="min-h-screen p-8 text-white max-w-7xl mx-auto space-y-12">
        <div className="flex justify-between items-center bg-slate-900/60 p-6 rounded-[2.5rem] border-2 border-slate-800 shadow-2xl">
          <button onClick={handleBackToHome} className="text-slate-500 font-black text-xs uppercase hover:text-white transition-colors">← QUIT</button>
          <h2 className="text-4xl font-oswald font-black text-amber-500 italic uppercase truncate max-w-[400px]">{tournament?.name}</h2>
          <div className="flex items-center gap-4">
              <span className="text-[10px] font-black bg-slate-800 px-3 py-1 rounded-full text-slate-400 uppercase tracking-widest">{tournament?.difficulty} MODE</span>
              <button onClick={() => { navigator.clipboard.writeText(window.location.href); alert('Link Copied!'); }} className="bg-slate-800 px-6 py-3 rounded-2xl text-xs font-black uppercase border border-slate-700 hover:bg-slate-700">INVITE</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Rankings Scoreboard */}
          <div className="lg:col-span-3 bg-slate-900/40 p-8 rounded-[2.5rem] border-2 border-slate-800 h-fit">
            <h3 className="text-xs font-black text-slate-600 uppercase mb-8 border-b border-slate-800 pb-3 tracking-widest">ARENA RANKINGS</h3>
            <div className="space-y-3">
              {sortedPlayers.map((p, idx) => (
                <div key={p.id} className={`flex items-center justify-between p-4 rounded-2xl transition-all ${p.id === myPlayerId ? 'bg-amber-500/20 border border-amber-500/50' : 'bg-slate-950/40 border border-slate-900'}`}>
                  <div className="flex items-center gap-4 overflow-hidden">
                    <span className="text-sm font-black text-slate-600 w-4">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </span>
                    <span className={`text-sm font-bold truncate ${p.status === PlayerStatus.ELIMINATED ? 'text-slate-700' : 'text-slate-200'}`}>{p.name}</span>
                  </div>
                  <span className="text-amber-500 font-black text-xs ml-2">{p.score}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Roster & Controls */}
          <div className="lg:col-span-3 bg-slate-900/40 p-8 rounded-[2.5rem] border-2 border-slate-800">
            <h3 className="text-xs font-black text-slate-600 uppercase mb-8 border-b border-slate-800 pb-3 tracking-widest">ROSTER ({tournament?.players.length}/{tournament?.maxPlayers})</h3>
            <div className="space-y-4">
              {tournament?.players.map(p => (
                <div key={p.id} className={`flex items-center justify-between p-4 rounded-xl border-2 ${p.id === myPlayerId ? 'bg-amber-500/10 border-amber-500' : 'bg-slate-950/70 border-slate-900'}`}>
                  <span className={`text-xl font-black uppercase truncate ${p.status === PlayerStatus.ELIMINATED ? 'text-slate-700 line-through' : 'text-white'}`}>{p.name}</span>
                  {p.status === PlayerStatus.READY && <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-lg" />}
                </div>
              ))}
              {tournament?.status === TournamentStatus.LOBBY && tournament.players.length < tournament.maxPlayers && !tournament.players.find(p => p.id === myPlayerId) && (
                <button onClick={handleJoin} className="w-full p-6 border-4 border-dashed border-slate-800 rounded-3xl text-slate-700 hover:text-amber-500 transition-all font-black uppercase italic">JOIN ARENA</button>
              )}
            </div>
          </div>

          {/* Bracket */}
          <div className="lg:col-span-6 space-y-8">
            <div className="flex justify-between items-center px-4">
               <h3 className="text-xs font-black text-slate-600 uppercase tracking-[0.3em]">ARENA BRACKET</h3>
               {tournament?.creatorId === myPlayerId && tournament.status === TournamentStatus.LOBBY && (
                 <button onClick={handleStartTournament} className="px-10 py-4 bg-green-600 text-white font-black rounded-2xl text-xl uppercase shadow-xl hover:bg-green-700 transition-all">START TOURNAMENT</button>
               )}
            </div>
            <div className="grid grid-cols-1 gap-6">
              {tournament?.matches.filter(m => m.round === (tournament.currentRound || 1)).map(m => {
                const p1 = tournament.players.find(p => p.id === m.players[0]);
                const p2 = tournament.players.find(p => p.id === m.players[1]);
                const isParticipant = m.players.includes(myPlayerId || '');
                return (
                  <div key={m.id} className={`p-8 rounded-[3rem] border-2 transition-all ${isParticipant ? 'bg-amber-500/10 border-amber-500 shadow-2xl scale-[1.02]' : 'bg-slate-900 border-slate-800'}`}>
                    <div className="flex items-center justify-between gap-6 mb-8 text-center">
                      <div className="flex flex-col items-center flex-1 min-w-0">
                        <div className={`text-2xl font-oswald font-black uppercase truncate w-full ${m.winnerId === p1?.id ? 'text-green-500' : 'text-white'}`}>{p1?.name}</div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">{p1?.score} PTS</span>
                      </div>
                      <div className="text-slate-800 font-black italic text-xl opacity-40">VS</div>
                      <div className="flex flex-col items-center flex-1 min-w-0">
                        <div className={`text-2xl font-oswald font-black uppercase truncate w-full ${m.winnerId === p2?.id ? 'text-green-500' : 'text-white'}`}>{p2?.name}</div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">{p2?.score} PTS</span>
                      </div>
                    </div>
                    {m.status === MatchStatus.PENDING ? (
                      <button onClick={() => handleStartMatch(m)} className={`w-full py-5 rounded-2xl font-black text-2xl uppercase transition-all shadow-xl ${isParticipant ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                        {isParticipant ? 'STRIKE NOW' : (
                          <span className="flex items-center justify-center gap-3">
                            WATCH BATTLE
                            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          </span>
                        )}
                      </button>
                    ) : <div className="text-center font-black uppercase text-green-500 tracking-[0.2em] bg-green-950/20 py-3 rounded-2xl">Completed</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const winner = tournament?.players.find(p => p.status === PlayerStatus.WINNER);
  const isUserWinner = winner?.id === myPlayerId;
  const isSpectating = activeMatch && !activeMatch.players.includes(myPlayerId || '');

  return (
    <div className="min-h-screen bg-slate-950">
      {view === 'HOME' && renderHome()}
      {view === 'LOBBY' && renderLobby()}
      {view === 'MATCH' && (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-950">
          <div className="w-full max-w-lg relative mb-8">
            {isSpectating && (
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-red-600 px-4 py-1 rounded-full animate-pulse shadow-lg">
                <div className="w-2 h-2 bg-white rounded-full" />
                <span className="text-[10px] font-black uppercase tracking-widest text-white">LIVE SPECTATING</span>
              </div>
            )}
            <div className="flex justify-between items-center px-8 py-5 bg-slate-900/80 rounded-full border-2 border-slate-800 shadow-2xl backdrop-blur-md">
              <span className="text-3xl font-oswald font-black text-red-500 italic uppercase truncate max-w-[150px]">{tournament?.players.find(p => p.id === activeMatch?.players[0])?.name}</span>
              <div className="h-14 w-14 bg-slate-800 rounded-full flex items-center justify-center border-2 border-slate-700 text-slate-500 font-black italic text-xl">VS</div>
              <span className="text-3xl font-oswald font-black text-blue-500 italic uppercase truncate max-w-[150px]">{tournament?.players.find(p => p.id === activeMatch?.players[1])?.name}</span>
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

          <div className="flex items-center gap-8 mt-12">
            {!isSpectating && (
              <button onClick={toggleVoice} className={`p-6 rounded-full border-2 transition-all cursor-pointer ${isVoiceActive ? 'bg-red-500 text-white border-red-400' : 'bg-slate-900 text-slate-600 border-slate-800 hover:text-white'}`}>
                <span className="text-3xl">{isVoiceActive ? '🎙️' : '🎤'}</span>
              </button>
            )}
            <button onClick={() => setView('LOBBY')} className="bg-slate-900 px-10 py-5 rounded-full text-slate-500 font-black uppercase tracking-widest text-xs border-2 border-slate-800 hover:text-white transition-all shadow-xl">
              {isSpectating ? 'STOP WATCHING' : 'EXIT ARENA'}
            </button>
          </div>
        </div>
      )}
      {view === 'TOURNAMENT_OVER' && (
        <div className="min-h-screen flex flex-col items-center justify-center p-12 text-center relative overflow-hidden">
          <PartySlices count={isUserWinner ? 120 : 30} />
          <div className="z-20 animate-in zoom-in-75 duration-700 space-y-12">
            <h1 className={`text-[12rem] md:text-[18rem] drop-shadow-3xl leading-none animate-bounce ${!isUserWinner ? 'grayscale opacity-50' : ''}`}>{isUserWinner ? '🏆' : '💀'}</h1>
            <div className="space-y-4">
              <h2 className={`text-8xl md:text-[12rem] font-oswald uppercase italic font-black leading-none tracking-tighter drop-shadow-2xl ${isUserWinner ? 'text-amber-500' : 'text-slate-600'}`}>{isUserWinner ? 'ARENA LORD' : 'DEFEATED'}</h2>
              <p className="text-white font-black tracking-[0.5em] text-2xl uppercase opacity-60">{isUserWinner ? 'CONGRATULATIONS!' : 'BETTER LUCK NEXT SEASON'}</p>
            </div>
            <div className={`flex flex-col items-center py-10 px-24 rounded-[4rem] border-8 bg-white text-slate-950 shadow-3xl relative z-10 ${isUserWinner ? 'border-amber-500' : 'border-slate-400'}`}>
              <span className="text-7xl md:text-[9rem] font-black uppercase italic leading-none">{winner?.name || 'GAME OVER'}</span>
              <span className="text-amber-500 font-black text-4xl mt-4 tracking-widest">FINAL SCORE: {winner?.score}</span>
            </div>
            <div className="pt-16">
              <button onClick={handleBackToHome} className="px-24 py-8 bg-amber-500 text-slate-950 font-black rounded-[2.5rem] text-3xl hover:bg-white hover:scale-110 active:scale-95 transition-all shadow-2xl uppercase tracking-widest italic">BACK TO MAIN MENU</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;