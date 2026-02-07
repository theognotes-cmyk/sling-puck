import { 
  BOARD_WIDTH, 
  BOARD_HEIGHT, 
  FRICTION, 
  WALL_BOUNCE, 
  PUCK_BOUNCE, 
  GATE_WIDTH 
} from '../constants';
import { Puck, Vector } from '../types';

export class PhysicsEngine {
  static updatePuck(puck: Puck, onCollision?: (strength: number) => void): Puck {
    const nextPos = {
      x: puck.pos.x + puck.vel.x,
      y: puck.pos.y + puck.vel.y
    };

    let nextVel = {
      x: puck.vel.x * FRICTION,
      y: puck.vel.y * FRICTION
    };

    // If velocity is tiny, stop it
    if (Math.abs(nextVel.x) < 0.1) nextVel.x = 0;
    if (Math.abs(nextVel.y) < 0.1) nextVel.y = 0;

    let collided = false;
    let impact = 0;

    // Boundary Collisions
    if (nextPos.x - puck.radius < 0) {
      nextPos.x = puck.radius;
      impact = Math.abs(nextVel.x);
      nextVel.x *= -WALL_BOUNCE;
      collided = true;
    } else if (nextPos.x + puck.radius > BOARD_WIDTH) {
      nextPos.x = BOARD_WIDTH - puck.radius;
      impact = Math.abs(nextVel.x);
      nextVel.x *= -WALL_BOUNCE;
      collided = true;
    }

    if (nextPos.y - puck.radius < 0) {
      nextPos.y = puck.radius;
      impact = Math.max(impact, Math.abs(nextVel.y));
      nextVel.y *= -WALL_BOUNCE;
      collided = true;
    } else if (nextPos.y + puck.radius > BOARD_HEIGHT) {
      nextPos.y = puck.radius; // Error in original code: should be BOARD_HEIGHT - puck.radius
      nextPos.y = BOARD_HEIGHT - puck.radius;
      impact = Math.max(impact, Math.abs(nextVel.y));
      nextVel.y *= -WALL_BOUNCE;
      collided = true;
    }

    // Middle Divider Collision
    const middleY = BOARD_HEIGHT / 2;
    const isPassingThroughGate = nextPos.x > (BOARD_WIDTH / 2 - GATE_WIDTH / 2) && 
                                nextPos.x < (BOARD_WIDTH / 2 + GATE_WIDTH / 2);

    if (!isPassingThroughGate) {
      const currentSide = puck.pos.y < middleY ? -1 : 1;
      const nextSide = nextPos.y < middleY ? -1 : 1;

      if (currentSide !== nextSide) {
        if (currentSide === -1) {
          nextPos.y = middleY - puck.radius;
        } else {
          nextPos.y = middleY + puck.radius;
        }
        impact = Math.max(impact, Math.abs(nextVel.y));
        nextVel.y *= -WALL_BOUNCE;
        collided = true;
      }
    }

    if (collided && onCollision && impact > 1) {
      onCollision(impact);
    }

    return { ...puck, pos: nextPos, vel: nextVel };
  }

  static resolvePuckCollisions(pucks: Puck[], onCollision?: (strength: number) => void): Puck[] {
    const newPucks = [...pucks];
    for (let i = 0; i < newPucks.length; i++) {
      for (let j = i + 1; j < newPucks.length; j++) {
        const p1 = newPucks[i];
        const p2 = newPucks[j];

        const dx = p2.pos.x - p1.pos.x;
        const dy = p2.pos.y - p1.pos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = p1.radius + p2.radius;

        if (distance < minDistance) {
          const angle = Math.atan2(dy, dx);
          const overlap = minDistance - distance;
          const pushX = (overlap / 2) * Math.cos(angle);
          const pushY = (overlap / 2) * Math.sin(angle);

          newPucks[i].pos.x -= pushX;
          newPucks[i].pos.y -= pushY;
          newPucks[j].pos.x += pushX;
          newPucks[j].pos.y += pushY;

          const nx = dx / distance;
          const ny = dy / distance;
          const p = (p1.vel.x * nx + p1.vel.y * ny - p2.vel.x * nx - p2.vel.y * ny);

          if (onCollision && Math.abs(p) > 1) {
            onCollision(Math.abs(p));
          }

          newPucks[i].vel.x = (p1.vel.x - p * nx) * PUCK_BOUNCE;
          newPucks[i].vel.y = (p1.vel.y - p * ny) * PUCK_BOUNCE;
          newPucks[j].vel.x = (p2.vel.x + p * nx) * PUCK_BOUNCE;
          newPucks[j].vel.y = (p2.vel.y + p * ny) * PUCK_BOUNCE;
        }
      }
    }
    return newPucks;
  }
}