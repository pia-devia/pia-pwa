import { useState, useEffect, useCallback } from 'react';
import { X, ExternalLink } from 'lucide-react';
import styles from './ArticleModal.module.css';

const CATEGORY_IMAGES = {
  'AI Applied': '/images/briefing/ai-applied.jpg',
  'System Design': '/images/briefing/system-design.jpg',
  'Engineering Leadership': '/images/briefing/engineering-leadership.jpg',
  'Product & Strategy': '/images/briefing/product-strategy.jpg',
  'AI Research': '/images/briefing/ai-research.jpg',
  'DevTools': '/images/briefing/devtools.jpg',
};

export default function ArticleModal({ article, onClose }) {
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [handleClose]);

  if (!article) return null;

  // Extract relevancia section and separate from rest
  let relevancia = '';
  let restSummary = article.summary || '';

  const relevanciaRegex = /RELEVANCIA PARA TPM\/TECH LEAD\n\n?([\s\S]*?)(?=\n[A-ZÁÉÍÓÚÑ\s]{4,}\n|$)/i;
  const match = restSummary.match(relevanciaRegex);
  if (match) {
    relevancia = match[1].trim();
    // Remove the entire relevancia section (header + content)
    restSummary = restSummary.replace(/\n?RELEVANCIA PARA TPM\/TECH LEAD\n\n?[\s\S]*?(?=\n[A-ZÁÉÍÓÚÑ\s]{4,}\n|$)/, '').trim();
  }

  return (
    <div className={`${styles.backdrop} ${closing ? styles.backdropOut : ''}`} onClick={handleClose}>
      <div className={`${styles.modal} ${closing ? styles.modalOut : ''}`} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.imageWrap}>
            <img src={CATEGORY_IMAGES[article.category] || '/images/briefing/ai-applied.jpg'} alt="" className={styles.image} />
            <div className={styles.imageGradient} />
          </div>
          <div className={styles.headerContent}>
            <div className={styles.meta}>
              <span className={styles.source}>{article.source}</span>
              {article.category && <span className={styles.category}>{article.category}</span>}
            </div>
            <h2 className={styles.title}>{article.title}</h2>
          </div>
          <button className={styles.closeBtn} onClick={handleClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          {relevancia && (
            <div className={styles.relevancia}>
              <span className={styles.relevanciaLabel}>Por qué te interesa</span>
              <p className={styles.relevanciaText}>{relevancia}</p>
            </div>
          )}
          {restSummary && (
            <div className={styles.summary}>{restSummary}</div>
          )}
          <div className={styles.footer}>
            <a href={article.url} target="_blank" rel="noopener noreferrer" className={styles.originalBtn}>
              Ver original <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
