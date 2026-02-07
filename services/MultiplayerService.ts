import { Tournament, Match, Player, TournamentStatus, PlayerStatus, PlayerType, MatchStatus, AIDifficulty, GameState } from '../types';

export interface ChatMessage {
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

class MultiplayerService {
  private channel: BroadcastChannel;
  private matchChannel: BroadcastChannel;
  private voiceChannel: BroadcastChannel;
  private onStateChangeListeners: ((tournament: Tournament) => void)[] = [];
  private onChatListeners: ((msg: ChatMessage) => void)[] = [];
  private onMatchStateListeners: Map<string, ((state: GameState) => void)[]> = new Map();
  private onVoiceListeners: ((data: { senderId: string, pcm: string }) => void)[] = [];

  constructor() {
    this.channel = new BroadcastChannel('sling-puck-multiplayer-v4');
    this.matchChannel = new BroadcastChannel('sling-puck-match-state-v4');
    this.voiceChannel = new BroadcastChannel('sling-puck-voice-v4');

    this.channel.onmessage = (event) => {
      if (event.data?.type === 'STATE_UPDATE') {
        const updatedTournament = event.data.tournament as Tournament;
        this.saveLocal(updatedTournament);
        this.notifyListeners(updatedTournament);
      } else if (event.data?.type === 'CHAT_MESSAGE') {
        this.onChatListeners.forEach(l => l(event.data.message));
      }
    };

    this.matchChannel.onmessage = (event) => {
      if (event.data?.type === 'MATCH_SYNC') {
        const { matchId, state } = event.data;
        const listeners = this.onMatchStateListeners.get(matchId);
        if (listeners) {
          listeners.forEach(l => l(state));
        }
      }
    };

    this.voiceChannel.onmessage = (event) => {
      if (event.data?.type === 'VOICE_DATA') {
        this.onVoiceListeners.forEach(l => l(event.data));
      }
    };
  }

  private generateRoomCode(): string {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private saveLocal(t: Tournament) {
    localStorage.setItem(`tournament_code_${t.roomCode}`, JSON.stringify(t));
    localStorage.setItem(`tournament_id_${t.id}`, JSON.stringify(t));
    
    const publicRooms = this.getPublicRooms();
    if (!t.isPrivate && !t.isLocked && t.players.length < t.maxPlayers && t.status === TournamentStatus.LOBBY) {
      publicRooms[t.roomCode] = t.id;
    } else {
      delete publicRooms[t.roomCode];
    }
    localStorage.setItem('public_tournaments_v4', JSON.stringify(publicRooms));
  }

  private getPublicRooms(): Record<string, string> {
    const data = localStorage.getItem('public_tournaments_v4');
    return data ? JSON.parse(data) : {};
  }

  private notifyListeners(t: Tournament) {
    this.onStateChangeListeners.forEach(listener => listener(t));
  }

  subscribe(callback: (tournament: Tournament) => void) {
    this.onStateChangeListeners.push(callback);
    return () => {
      this.onStateChangeListeners = this.onStateChangeListeners.filter(l => l !== callback);
    };
  }

  broadcastMatchState(matchId: string, state: GameState) {
    this.matchChannel.postMessage({ type: 'MATCH_SYNC', matchId, state });
  }

  subscribeMatchState(matchId: string, callback: (state: GameState) => void) {
    if (!this.onMatchStateListeners.has(matchId)) {
      this.onMatchStateListeners.set(matchId, []);
    }
    this.onMatchStateListeners.get(matchId)?.push(callback);
    return () => {
      const listeners = this.onMatchStateListeners.get(matchId);
      if (listeners) {
        this.onMatchStateListeners.set(matchId, listeners.filter(l => l !== callback));
      }
    };
  }

  broadcastVoice(senderId: string, base64Pcm: string) {
    this.voiceChannel.postMessage({ type: 'VOICE_DATA', senderId, pcm: base64Pcm });
  }

  subscribeVoice(callback: (data: { senderId: string, pcm: string }) => void) {
    this.onVoiceListeners.push(callback);
    return () => {
      this.onVoiceListeners = this.onVoiceListeners.filter(l => l !== callback);
    };
  }

  createTournament(name: string, playerCount: number, creatorName: string, difficulty: AIDifficulty = AIDifficulty.MEDIUM): Tournament {
    const id = 't_' + Math.random().toString(36).substring(2, 9);
    const roomCode = this.generateRoomCode();
    const creatorId = 'player_' + Math.random().toString(36).substring(2, 7);
    
    const tournament: Tournament = {
      id,
      roomCode,
      name: name || "New Tournament",
      creatorId,
      maxPlayers: playerCount,
      players: [{ id: creatorId, name: creatorName, type: PlayerType.HUMAN, status: PlayerStatus.READY, score: 0 }],
      matches: [],
      status: TournamentStatus.LOBBY,
      currentRound: 0,
      difficulty,
      isLocked: false,
      isPrivate: false
    };

    this.saveLocal(tournament);
    this.broadcast(tournament);
    return tournament;
  }

  getTournamentByCode(code: string): Tournament | null {
    const data = localStorage.getItem(`tournament_code_${code.toUpperCase()}`);
    return data ? JSON.parse(data) : null;
  }

  findRandomTournament(): Tournament | null {
    const rooms = this.getPublicRooms();
    const codes = Object.keys(rooms);
    if (codes.length === 0) return null;
    return this.getTournamentByCode(codes[Math.floor(Math.random() * codes.length)]);
  }

  joinTournament(roomCode: string, playerName: string, existingId?: string): { tournament: Tournament, playerId: string } | null {
    const t = this.getTournamentByCode(roomCode);
    if (!t) return null;
    
    // Allow re-joining if already in player list
    const existing = existingId ? t.players.find(p => p.id === existingId) : null;
    if (t.isLocked && !existing) return null;

    let playerId = existingId || 'player_' + Math.random().toString(36).substring(2, 7);
    
    if (!existing) {
      if (t.players.length >= t.maxPlayers || t.status !== TournamentStatus.LOBBY) return null;
      t.players.push({ id: playerId, name: playerName, type: PlayerType.HUMAN, status: PlayerStatus.READY, score: 0 });
    }

    this.saveLocal(t);
    this.broadcast(t);
    return { tournament: t, playerId };
  }

  toggleLock(roomCode: string) {
    const t = this.getTournamentByCode(roomCode);
    if (t) {
      t.isLocked = !t.isLocked;
      this.saveLocal(t);
      this.broadcast(t);
      return t;
    }
    return null;
  }

  startTournament(roomCode: string) {
    const t = this.getTournamentByCode(roomCode);
    if (!t) return;

    // Fill with AI
    while (t.players.length < t.maxPlayers) {
      t.players.push({
        id: `ai_${Math.random().toString(36).substring(2, 5)}`,
        name: `Bot ${t.players.length + 1}`,
        type: PlayerType.AI,
        status: PlayerStatus.READY,
        score: 0,
        difficulty: t.difficulty
      });
    }

    t.status = TournamentStatus.IN_PROGRESS;
    t.isLocked = true;
    t.currentRound = 1;
    t.matches = this.generateMatches(t.players, 1);
    
    this.saveLocal(t);
    this.broadcast(t);
  }

  updateMatchResult(roomCode: string, matchId: string, winnerId: string) {
    const t = this.getTournamentByCode(roomCode);
    if (!t) return;

    const match = t.matches.find(m => m.id === matchId);
    if (match) {
      match.winnerId = winnerId;
      match.status = MatchStatus.COMPLETED;
      
      const loserId = match.players.find(p => p !== winnerId);
      const winner = t.players.find(p => p.id === winnerId);
      const loser = t.players.find(p => p.id === loserId);
      
      if (winner) {
        winner.status = PlayerStatus.READY;
        winner.score += 100;
      }
      if (loser) loser.status = PlayerStatus.ELIMINATED;

      const roundMatches = t.matches.filter(m => m.round === t.currentRound);
      const allDone = roundMatches.every(m => m.status === MatchStatus.COMPLETED);

      if (allDone) {
        const stillIn = t.players.filter(p => p.status !== PlayerStatus.ELIMINATED);
        if (stillIn.length === 1) {
          t.status = TournamentStatus.FINISHED;
          stillIn[0].status = PlayerStatus.WINNER;
          stillIn[0].score += 500;
        } else {
          t.currentRound++;
          t.matches = [...t.matches, ...this.generateMatches(stillIn, t.currentRound)];
        }
      }

      this.saveLocal(t);
      this.broadcast(t);
    }
  }

  private generateMatches(players: Player[], round: number): Match[] {
    const matches: Match[] = [];
    const active = players.filter(p => p.status !== PlayerStatus.ELIMINATED);
    const shuffled = [...active].sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length; i += 2) {
      if (shuffled[i + 1]) {
        matches.push({
          id: `match_${round}_${i}`,
          round,
          players: [shuffled[i].id, shuffled[i + 1].id],
          status: MatchStatus.PENDING,
          spectators: []
        });
      }
    }
    return matches;
  }

  private broadcast(t: Tournament) {
    this.channel.postMessage({ type: 'STATE_UPDATE', tournament: t });
  }
}

export const multiplayer = new MultiplayerService();
