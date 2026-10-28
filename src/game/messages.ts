import { CONFIG } from '../config';
import { DEFAULT_LANG } from './i18n';
import type { Lang } from './i18n';
import type { FoulReason, MatchEvent } from './match';

/** Textos de los eventos del partido, en español (predeterminado) o inglés. Sin Phaser: la escena los muestra (y espera) y `scripts/selfplay.ts` los cuenta. */

export const NO_TOUCH_MSG = 'SIN TOUCH: TIRO DE SALIDA';
const NO_TOUCH_MSG_EN = 'NO TOUCH: START SHOT';

/** Mensaje de «sin touch» en el idioma pedido (`NO_TOUCH_MSG` es el español). */
export const noTouchMessage = (lang: Lang = DEFAULT_LANG) => (lang === 'en' ? NO_TOUCH_MSG_EN : NO_TOUCH_MSG);

const FOUL_TEXT: Record<FoulReason, string> = {
  touchedOther: '¡FALTA! TOCÓ OTRA BOLA',
  touchedTwice: '¡FALTA! TOCÓ DOS VECES LA MISMA BOLA',
};
const FOUL_TEXT_EN: Record<FoulReason, string> = {
  touchedOther: 'FOUL! TOUCHED ANOTHER BALL',
  touchedTwice: 'FOUL! TOUCHED THE SAME BALL TWICE',
};

/** Solo `'en'` cambia el idioma: cualquier otro valor da español, así `events.map(messageFor)` (que pasa el índice como segundo argumento) sigue dando lo de siempre. */
export function messageFor(e: MatchEvent, lang: Lang = DEFAULT_LANG): string {
  return lang === 'en' ? messageEn(e) : messageEs(e);
}

function messageEs(e: MatchEvent): string {
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

function messageEn(e: MatchEvent): string {
  switch (e.type) {
    case 'gate':
      return e.stroker ? `GATE ${e.gate} PASSED! +${CONFIG.gatePoints}` : `BALL ${e.ball}: GATE ${e.gate} +${CONFIG.gatePoints}`;
    case 'pole':
      return e.stroker ? `POLE! +${CONFIG.polePoints} POINTS` : `BALL ${e.ball}: POLE! +${CONFIG.polePoints}`;
    case 'out':
      return `BALL ${e.ball} WENT OUT`;
    case 'noTouch':
      return NO_TOUCH_MSG_EN;
    case 'strokerOut':
      if (e.start) return 'OUT! BACK TO START';
      if (e.foul) return FOUL_TEXT_EN[e.foul];
      return e.gate ? `GATE ${e.gate}! +${CONFIG.gatePoints} BUT OUT` : 'BALL OUT!';
    case 'backInPlay':
      return 'BALL BACK IN PLAY';
    case 'ballOut':
      return 'BALL OUT!';
    case 'failGate1':
      return 'MISSED GATE 1';
    case 'touch':
      return `TOUCH ON BALL ${e.balls.join(' AND ')}!`;
    case 'spark':
      return 'SPARK!';
    case 'sparkFoul':
      return e.reason === 'short' ? 'FOUL! SHORT SPARK' : 'FOUL! BALL OUT OF THE COURT';
  }
}

/** Mensajes de una resolución, en el orden en que se muestran (`lang` predeterminado: español). */
export const messagesFor = (events: MatchEvent[], lang: Lang = DEFAULT_LANG) => events.map((e) => messageFor(e, lang));
