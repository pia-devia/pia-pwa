import { useContext } from 'react';
import { Check } from 'lucide-react';
import { AgentContext } from '../../context/AgentContext';
import styles from './AgentPicker.module.css';

export default function AgentPicker({ onClose }) {
  const { agentId, setAgent, agents } = useContext(AgentContext);

  const handleSelectAgent = (newAgentId) => {
    setAgent(newAgentId);
    if (onClose) onClose();
  };

  return (
    <div className={styles.picker}>
      <div className={styles.header}>
        <h3 className={styles.title}>Seleccionar Agente</h3>
      </div>
      <div className={styles.agentsList}>
        {agents.map((agent) => (
          <button
            key={agent.id}
            className={`${styles.agentItem} ${agentId === agent.id ? styles.active : ''}`}
            onClick={() => handleSelectAgent(agent.id)}
          >
            <span className={styles.emoji}>{agent.emoji}</span>
            <span className={styles.name}>{agent.name}</span>
            {agentId === agent.id && <Check className={styles.checkIcon} size={18} />}
          </button>
        ))}
      </div>
    </div>
  );
}
