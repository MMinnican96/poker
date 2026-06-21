// Hand evaluation now lives in @poker/shared so the client can reuse it.
// This shim preserves the engine's existing import paths.
export {
  evaluate5,
  evaluateBest,
  compareHands,
  describeBestHand,
  type HandCategory,
  type HandRank,
} from '@poker/shared';
