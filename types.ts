export enum PlayerType {
  HUMAN = 'HUMAN',
  AI = 'AI'
}

export enum PlayerStatus {
  READY = 'READY',
  PLAYING = 'PLAYING',
  ELIMINATED = 'ELIMINATED',
  WINNER = 'WINNER'
}

export enum MatchStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED'
}

export enum TournamentStatus {
  LOBBY = 'LOBBY',
  IN_PROGRESS = 'IN_PROGRESS',
  FINISHED = 'FINISHED'
}

export enum AIDifficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD'
}

export interface Vector {
  x: number;
  y: number;
}

export interface Puck {
  id: string;
  pos: Vector;
  vel: Vector;
  radius: number;
  ownerId: string; // The side it belongs to initially
  color: string;
}

export interface Player {
  id: string;
  name: string;
  type: PlayerType;
  status: PlayerStatus;
  score: number;
  difficulty?: AIDifficulty;
}

export interface Match {
  id: string;
  round: number;
  players: [string, string]; // Player IDs
  winnerId?: string;
  status: MatchStatus;
  spectators: string[];
}

export interface Tournament {
  id: string;
  name: string;
  creatorId: string;
  maxPlayers: number;
  players: Player[];
  matches: Match[];
  status: TournamentStatus;
  currentRound: number;
  difficulty: AIDifficulty;
}

export interface GameState {
  pucks: Puck[];
  player1Id: string;
  player2Id: string;
  timer: number;
  isPaused: boolean;
  winnerId?: string;
  isOpeningMove1: boolean; // Tracking opening move for player 1
  isOpeningMove2: boolean; // Tracking opening move for player 2
}