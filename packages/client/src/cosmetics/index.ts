/** Cosmetic renderers driven by the shared shop catalog. All sized by props. */
export { Felt, type FeltProps } from './Felt';
export { CardBack, CardBackPattern, CARD_RATIO, type CardBackProps } from './CardBack';
export { PlayingCard, cardName, isRedSuit, CARD_WIDTH, SUIT_PATH, type CardSize, type PlayingCardProps } from './PlayingCard';
export { AvatarFrame, type AvatarFrameProps } from './AvatarFrame';
export { TitleTag, titleText, type TitleTagProps } from './TitleTag';
export { CelebrationPreview, celebrationOptions, fireCelebration, prefersReducedMotion, type CelebrationOrigin } from './celebration';
export { ItemPreview, type ItemPreviewProps } from './ItemPreview';
export { RatbagCrest, type RatbagCrestProps } from './RatbagCrest';
export { feltVisual, cardBackVisual, frameVisual, celebrationVisual, owns, ownedOfCategory } from './catalog';
// Emblem, TrophyShelf and emblemGlyphs are imported by path, not from here: they
// carry the icon set, which should load with the screens that show emblems
// rather than with the app.
