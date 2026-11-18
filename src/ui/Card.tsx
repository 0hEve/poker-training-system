import { memo, type CSSProperties } from 'react';
import { CARD_ASPECT, cardBackURL, cardFaceURL } from '../art';
import { cardLabel, type Card } from '../engine/cards';

interface Props {
  card: Card | null;
  faceUp: boolean;
  width: number;
  className?: string;
  style?: CSSProperties;
  highlight?: boolean;
}

/**
 * A playing card with two faces and a CSS 3D flip. Faces are cached SVG
 * sprites, so the browser rasterises each image once.
 */
export const PlayingCard = memo(function PlayingCard({ card, faceUp, width, className = '', style, highlight }: Props) {
  const showFace = faceUp && card !== null;
  return (
    <div
      className={`card3d ${showFace ? 'is-up' : ''} ${highlight ? 'is-hl' : ''} ${className}`}
      style={{ width, height: width / CARD_ASPECT, ...style }}
      aria-label={showFace ? cardLabel(card!) : 'Face-down card'}
      role="img"
    >
      <div className="card3d-inner">
        <img className="card-face card-front" src={card !== null ? cardFaceURL(card) : cardBackURL()} alt="" draggable={false} />
        <img className="card-face card-back" src={cardBackURL()} alt="" draggable={false} />
      </div>
    </div>
  );
});
