export const BOARD_WIDTH = 400;
export const BOARD_HEIGHT = 600;
export const PUCK_RADIUS = 15;
export const FRICTION = 0.985;
export const WALL_BOUNCE = 0.7;
export const PUCK_BOUNCE = 0.8;
export const GATE_WIDTH = 80;
export const MAX_FLING_STRENGTH = 40;
export const SLING_RADIUS = 60;
export const PUCKS_PER_PLAYER = 5;

export const AI_CONFIG = {
  EASY: {
    delay: [2000, 3500],
    accuracy: 0.4,
    powerRange: [10, 25]
  },
  MEDIUM: {
    delay: [1000, 2000],
    accuracy: 0.7,
    powerRange: [15, 35]
  },
  HARD: {
    delay: [400, 900],
    accuracy: 0.95,
    powerRange: [25, 40]
  }
};

export const COLORS = {
  BOARD: '#d97706', // Amber-600 (wood color)
  BOARD_BORDER: '#78350f',
  PLAYER1: '#ef4444', // Red-500
  PLAYER2: '#3b82f6', // Blue-500
  ACCENT: '#fbbf24', // Amber-400
  RUBBER: '#1e293b'  // Slate-800 for the elastic band
};