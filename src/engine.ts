// Motor de reglas de gateball (`saihai-gateball/engine`): el mismo que usa el planificador para simular. Sin Phaser ni DOM.
export { CONFIG, LAYOUT } from './config';
export type { BarPattern } from './config';
export { BALLS, FINISHED, POLE_STEP, Match, accuracySpeedFactor, barSpeed } from './game/match';
export type { BallState, MatchEvent, Resolution, SavedState, SoundCue, Transition } from './game/match';
export { COURT_H, COURT_W, GATES, POSTS } from './game/court';
export type { Gate } from './game/court';
export { browserRng, gauss, mulberry32 } from './game/rng';
export type { Rng } from './game/rng';
export { messageFor, messagesFor } from './game/messages';
export type { CpuPlan } from './game/cpu';
export { CPU_AIM_SPEED, CPU_BAR_WAIT, CPU_SET_WAIT, cpuPlan, cpuThinkSeconds, levelOptions } from './game/cpuDriver';
