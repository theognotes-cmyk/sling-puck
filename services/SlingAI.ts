import { BOARD_WIDTH, BOARD_HEIGHT, GATE_WIDTH, AI_CONFIG } from '../constants';
import { Puck, Vector, AIDifficulty } from '../types';

export class SlingAI {
  static decideMove(
    pucks: Puck[], 
    aiPlayerId: string, 
    side: 'top' | 'bottom', 
    difficulty: AIDifficulty = AIDifficulty.MEDIUM
  ): { puckId: string, force: Vector } | null {
    const config = AI_CONFIG[difficulty];
    const middleY = BOARD_HEIGHT / 2;
    const ourPucks = pucks.filter(p => side === 'top' ? p.pos.y < middleY : p.pos.y > middleY);

    if (ourPucks.length === 0) return null;

    // Filter pucks that are not moving too fast
    const candidates = ourPucks.filter(p => Math.abs(p.vel.x) < 0.5 && Math.abs(p.vel.y) < 0.5);
    if (candidates.length === 0) return null;

    const chosenPuck = candidates[Math.floor(Math.random() * candidates.length)];

    // Target is point inside the gate
    let gateTargetX = BOARD_WIDTH / 2;
    
    // Add inaccuracy based on difficulty
    const inaccuracy = (1 - config.accuracy) * 150;
    gateTargetX += (Math.random() - 0.5) * inaccuracy;

    // Ensure we don't aim outside the gate entirely on hard mode but can miss on easy
    const maxMiss = (1 - config.accuracy) * 100;
    gateTargetX = Math.max(BOARD_WIDTH / 2 - GATE_WIDTH / 2 - maxMiss, Math.min(BOARD_WIDTH / 2 + GATE_WIDTH / 2 + maxMiss, gateTargetX));

    const gateTargetY = middleY;

    const dx = gateTargetX - chosenPuck.pos.x;
    const dy = gateTargetY - chosenPuck.pos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // AI "pulls" the elastic band back
    const minStr = config.powerRange[0];
    const maxStr = config.powerRange[1];
    const strength = minStr + Math.random() * (maxStr - minStr);
    
    return {
      puckId: chosenPuck.id,
      force: {
        x: (dx / distance) * strength,
        y: (dy / distance) * strength
      }
    };
  }
}