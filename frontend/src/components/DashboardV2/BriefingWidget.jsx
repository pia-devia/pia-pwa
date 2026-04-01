import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Newspaper } from 'lucide-react';
import { getToken } from '../../api/client';
import ArticleModal from './ArticleModal';
import styles from './BriefingWidget.module.css';

function auth() {
  return { Authorization: `Bearer ${getToken()}` };
}

const CATEGORY_IMAGES = {
  'AI Applied': '/images/briefing/ai-applied.jpg',
  'System Design': '/images/briefing/system-design.jpg',
  'Engineering Leadership': '/images/briefing/engineering-leadership.jpg',
  'Product & Strategy': '/images/briefing/product-strategy.jpg',
  'AI Research': '/images/briefing/ai-research.jpg',
  'DevTools': '/images/briefing/devtools.jpg',
};

const CATEGORY_COLORS = {
  'AI Applied': '124, 217, 254',
  'System Design': '113, 254, 195',
  'Engineering Leadership': '138, 181, 2',
  'Product & Strategy': '132, 94, 247',
  'AI Research': '222, 33, 12',
  'DevTools': '255, 255, 255',
};

const FALLBACK_IMG = '/images/briefing/ai-applied.jpg';

// Positions: center(0), side(-1,+1), far(-2,+2), hidden(rest)
const SLOTS = {
  0:    { x: '0%',   scale: 1,    opacity: 1,    z: 5, blur: 0 },
  1:    { x: '80%',  scale: 0.85, opacity: 0.7,  z: 3, blur: 0 },
  '-1': { x: '-80%', scale: 0.85, opacity: 0.7,  z: 3, blur: 0 },
  2:    { x: '145%', scale: 0.7,  opacity: 0.35, z: 1, blur: 2 },
  '-2': { x: '-145%',scale: 0.7,  opacity: 0.35, z: 1, blur: 2 },
};

function getSlot(offset) {
  if (offset === 0) return SLOTS[0];
  if (offset === 1 || offset === -1) return SLOTS[offset];
  if (offset === 2 || offset === -2) return SLOTS[offset];
  // Hidden
  return { x: offset > 0 ? '250%' : '-250%', scale: 0.4, opacity: 0, z: 0, blur: 4 };
}

function getOffset(i, current, len) {
  let diff = i - current;
  // Wrap around for circular
  if (diff > len / 2) diff -= len;
  if (diff < -len / 2) diff += len;
  return diff;
}

export default function BriefingWidget() {
  const [articles, setArticles] = useState([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        let res = await fetch('/api/briefing/today', { headers: auth() });
        let data = await res.json();
        if (data.articles?.length === 0) {
          res = await fetch('/api/briefing/latest?limit=30', { headers: auth() });
          data = await res.json();
        }
        setArticles(data.articles || []);
      } catch {} finally {
        setLoading(false);
      }
    })();
  }, []);

  const len = articles.length;

  if (loading) {
    return <div className={styles.widget}><div className={styles.empty}><div className={styles.spinner} /></div></div>;
  }

  if (len === 0) {
    return (
      <div className={styles.widget}>
        <div className={styles.empty}>
          <Newspaper size={28} strokeWidth={1} />
          <span>Sin artículos aún</span>
        </div>
      </div>
    );
  }

  const prev = () => setIndex(i => (i - 1 + len) % len);
  const next = () => setIndex(i => (i + 1) % len);

  return (
    <div className={styles.widget}>
      <div className={styles.carousel}>
        {articles.map((article, i) => {
          const offset = getOffset(i, index, len);
          const slot = getSlot(offset);
          const isCenter = offset === 0;
          const isSide = Math.abs(offset) === 1;
          const glowColor = CATEGORY_COLORS[article.category] || '245, 197, 24';

          return (
            <div
              key={article.id || i}
              className={styles.card}
              style={{
                '--glow': glowColor,
                transform: `translateX(${slot.x}) scale(${slot.scale})`,
                opacity: slot.opacity,
                zIndex: slot.z,
                filter: slot.blur ? `blur(${slot.blur}px) brightness(0.5)` : isCenter ? 'none' : 'brightness(0.7)',
                pointerEvents: Math.abs(offset) <= 1 ? 'auto' : 'none',
              }}
              onClick={() => {
                if (isCenter) setSelected(article);
                else if (offset === -1 || offset === -2) prev();
                else if (offset === 1 || offset === 2) next();
              }}
            >
              <img src={CATEGORY_IMAGES[article.category] || FALLBACK_IMG} alt="" className={styles.cardImg} />
              {Math.abs(offset) <= 1 && article.category && (
                <span className={styles.tag}>{article.category}</span>
              )}
              {Math.abs(offset) <= 1 && (
                <div className={styles.cardOverlay}>
                  <span className={styles.cardSource}>{article.source}</span>
                  <span className={styles.cardTitle}>{article.title}</span>
                </div>
              )}
              {isCenter && <div className={styles.glow} />}
            </div>
          );
        })}
      </div>

      {len > 1 && (
        <>
          <button className={`${styles.arrow} ${styles.arrowLeft}`} onClick={prev}>
            <ChevronLeft size={16} />
          </button>
          <button className={`${styles.arrow} ${styles.arrowRight}`} onClick={next}>
            <ChevronRight size={16} />
          </button>
        </>
      )}

      {len > 1 && (
        <div className={styles.dots}>
          {articles.map((_, i) => (
            <span key={i} className={`${styles.dot} ${i === index ? styles.dotActive : ''}`} onClick={() => setIndex(i)} />
          ))}
        </div>
      )}

      {selected && <ArticleModal article={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
