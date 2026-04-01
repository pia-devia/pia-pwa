import { useState, useEffect } from 'react';
import HardwareWidget from './HardwareWidget';
import SubscriptionWidget from './SubscriptionWidget';
import ModelSelector from './ModelSelector';
import WeatherWidget from './WeatherWidget';
import BriefingWidget from './BriefingWidget';
import CronsWidget from './CronsWidget';
import EmailsWidget from './EmailsWidget';
import SpotifyWidget from './SpotifyWidget';
import TasksWidget from './TasksWidget';
import CalendarWidget from './CalendarWidget';
import MobilePanel from './MobilePanel';
import { useOutletContext } from 'react-router-dom';
import styles from './DashboardV2.module.css';

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 780);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 780);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mobile;
}

export default function DashboardV2() {
  const ctx = useOutletContext() || {};
  const compact = ctx.chatSidebar;
  const isMobile = useIsMobile();

  if (isMobile) return <MobilePanel />;

  return (
    <div className={`${styles.dashboard} ${compact ? styles.compact : ''}`} data-compact={compact || undefined}>
      {/* Row 1: Hardware + Suscripción + Clima */}
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <HardwareWidget compact={compact} />
        </div>
        <div className={styles.topRight}>
          <SubscriptionWidget compact={compact} />
          <ModelSelector compact={compact} />
          <WeatherWidget compact={compact} />
        </div>
      </div>

      {/* Briefing: full width */}
      <div className={styles.briefingRow}>
        <BriefingWidget />
      </div>

      {/* Main content: 2 columns */}
      <div className={styles.main}>
        <div className={styles.colLeft}>
          <div className={styles.cellCalendar}>
            <CalendarWidget />
          </div>
          <div className={styles.cellTasks}>
            <TasksWidget />
          </div>
        </div>

        <div className={styles.colRight}>
          <div className={styles.cellRow}>
            <div className={styles.cellWide}><CronsWidget /></div>
            <div className={styles.cellNarrow}>
              <SpotifyWidget />
            </div>
          </div>
          <div className={styles.cellFill}>
            <EmailsWidget />
          </div>
        </div>
      </div>
    </div>
  );
}
