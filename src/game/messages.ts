import { CONFIG } from '../config';
import type { FoulReason, MatchEvent } from './match';

/** Textos en español de los eventos del partido. Sin Phaser: la escena los muestra (y espera) y `scripts/selfplay.ts` los cuenta. */

export const NO_TOUCH_MSG = 'SIN TOUCH: TIRO DE SALIDA';

const FOUL_TEXT: Record<FoulReason, string> = {
  touchedOther: '¡FALTA! TOCÓ OTRA BOLA',
  touchedTwice: '¡FALTA! TOCÓ DOS VECES LA MISMA BOLA',
};

export function messageFor(e: MatchEvent): string {
  switch (e.type) {
    case 'gate':
      return e.stroker ? `¡PASÓ LA PUERTA ${e.gate}! +${CONFIG.gatePoints}` : `BOLA ${e.ball}: PUERTA ${e.gate} +${CONFIG.gatePoints}`;
    case 'pole':
      return e.stroker ? `¡POSTE! +${CONFIG.polePoints} PUNTOS` : `BOLA ${e.ball}: ¡POSTE! +${CONFIG.polePoints}`;
    case 'out':
      return `BOLA ${e.ball} SALIÓ`;
    case 'noTouch':
      return NO_TOUCH_MSG;
    case 'strokerOut':
      if (e.start) return '¡FUERA! VUELVE A SALIDA';
      if (e.foul) return FOUL_TEXT[e.foul];
      return e.gate ? `¡PUERTA ${e.gate}! +${CONFIG.gatePoints} PERO FUERA` : '¡BOLA FUERA!';
    case 'backInPlay':
      return 'BOLA EN JUEGO';
    case 'ballOut':
      return '¡BOLA FUERA!';
    case 'failGate1':
      return 'FALLÓ LA PUERTA 1';
    case 'touch':
      return `¡TOUCH A LA BOLA ${e.balls.join(' Y ')}!`;
    case 'spark':
      return '¡SPARK!';
    case 'sparkFoul':
      return e.reason === 'short' ? '¡FALTA! SPARK CORTO' : '¡FALTA! BOLA FUERA DEL CAMPO';
  }
}

/** Mensajes de una resolución, en el orden en que se muestran. */
export const messagesFor = (events: MatchEvent[]) => events.map(messageFor);
