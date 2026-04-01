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
import styles from './MobilePanel.module.css';

export default function MobilePanel() {
  return (
    <div className={styles.mobile}>
      {/* Top bar — icons only */}
      <div className={styles.topBar}>
        <HardwareWidget compact />
        <div className={styles.topRight}>
          <SubscriptionWidget compact />
          <ModelSelector compact />
          <WeatherWidget compact />
        </div>
      </div>

      {/* Briefing carousel */}
      <div className={styles.section}>
        <BriefingWidget />
      </div>

      {/* Tasks */}
      <div className={styles.section}>
        <TasksWidget />
      </div>

      {/* Calendar */}
      <div className={styles.section}>
        <CalendarWidget />
      </div>

      {/* Crons + Spotify */}
      <div className={styles.row}>
        <div className={styles.rowMain}><CronsWidget /></div>
        <div className={styles.rowSide}><SpotifyWidget /></div>
      </div>

      {/* Email */}
      <div className={styles.section}>
        <EmailsWidget />
      </div>
    </div>
  );
}
