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
  private onStateChangeListeners: ((tournament: Tournament) => void)[] = [];
  private onChatListeners: ((msg: ChatMessage) => void)[] = [];
  private onMatchStateListeners: Map<string, ((state: GameState) => void)[]> = new Map();

  constructor() {
    this.channel = new BroadcastChannel('sling-puck-multiplayer');
    this.matchChannel = new BroadcastChannel('sling-puck-match-state');

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
  }

  private saveLocal(t: Tournament) {
    localStorage.setItem(`tournament_${t.id}`, JSON.stringify(t));
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

  subscribeChat(callback: (msg: ChatMessage) => void) {
    this.onChatListeners.push(callback);
    return () => {
      this.onChatListeners = this.onChatListeners.filter(l => l !== callback);
    };
  }

  // High-frequency sync for spectators
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

  sendChatMessage(tournamentId: string, senderId: string, senderName: string, text: string) {
    const msg: ChatMessage = { senderId, senderName, text, timestamp: Date.now() };
    this.channel.postMessage({ type: 'CHAT_MESSAGE', tournamentId, message: msg });
  }

  createTournament(name: string, playerCount: number, creatorName: string, difficulty: AIDifficulty = AIDifficulty.MEDIUM): Tournament {
    const id = Math.random().toString(36).substring(2, 9);
    const creatorId = 'player_' + Math.random().toString(36).substring(2, 5);
    
    const players: Player[] = [
      { id: creatorId, name: creatorName, type: PlayerType.HUMAN, status: PlayerStatus.READY, score: 0 }
    ];

    const tournament: Tournament = {
      id,
      name,
      creatorId,
      maxPlayers: playerCount,
      players,
      matches: [],
      status: TournamentStatus.LOBBY,
      currentRound: 0,
      difficulty
    };

    this.saveLocal(tournament);
    this.broadcast(tournament);
    return tournament;
  }

  getTournament(id: string): Tournament | null {
    const data = localStorage.getItem(`tournament_${id}`);
    return data ? JSON.parse(data) : null;
  }

  joinTournament(tournamentId: string, playerName: string): { tournament: Tournament, playerId: string } | null {
    const t = this.getTournament(tournamentId);
    if (!t) return null;

    const playerId = 'player_' + Math.random().toString(36).substring(2, 5);
    
    if (t.players.length < t.maxPlayers && t.status === TournamentStatus.LOBBY) {
      t.players.push({
        id: playerId,
        name: playerName,
        type: PlayerType.HUMAN,
        status: PlayerStatus.READY,
        score: 0
      });
      
      this.saveLocal(t);
      this.broadcast(t);
    }

    return { tournament: t, playerId };
  }

  startTournament(tournamentId: string, fillWithAI: boolean = true) {
    const t = this.getTournament(tournamentId);
    if (!t) return;

    if (fillWithAI) {
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
    }

    t.status = TournamentStatus.IN_PROGRESS;
    t.currentRound = 1;
    t.matches = this.generateMatches(t.players, 1);
    
    this.saveLocal(t);
    this.broadcast(t);
  }

  private generateMatches(players: Player[], round: number): Match[] {
    const matches: Match[] = [];
    const activePlayers = players.filter(p => p.status !== PlayerStatus.ELIMINATED);
    const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);

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

  updateMatchResult(tournamentId: string, matchId: string, winnerId: string) {
    const t = this.getTournament(tournamentId);
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
        winner.score += 100; // Award points for match win
      }
      if (loser) loser.status = PlayerStatus.ELIMINATED;

      const roundMatches = t.matches.filter(m => m.round === t.currentRound);
      const allDone = roundMatches.every(m => m.status === MatchStatus.COMPLETED);

      if (allDone) {
        const stillIn = t.players.filter(p => p.status !== PlayerStatus.ELIMINATED);
        if (stillIn.length === 1) {
          t.status = TournamentStatus.FINISHED;
          stillIn[0].status = PlayerStatus.WINNER;
          stillIn[0].score += 500; // Bonus for winning the whole tournament
        } else {
          t.currentRound++;
          t.matches = [...t.matches, ...this.generateMatches(stillIn, t.currentRound)];
        }
      }

      this.saveLocal(t);
      this.broadcast(t);
    }
  }

  private broadcast(t: Tournament) {
    this.channel.postMessage({ type: 'STATE_UPDATE', tournament: t });
  }
}

export const multiplayer = new MultiplayerService();