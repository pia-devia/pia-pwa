import { createContext, useState, useEffect, useRef } from 'react';

export const AgentContext = createContext();

const AGENT = { id: 'pia', name: 'CORE', statusKey: 'core' };
const ACCENT = '#F5C518';

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1],16)}, ${parseInt(r[2],16)}, ${parseInt(r[3],16)}` : '0,0,0';
}

function darken(hex, amount = 0.15) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return hex;
  const c = [1,2,3].map(i => Math.max(0, Math.round(parseInt(r[i],16)*(1-amount))).toString(16).padStart(2,'0'));
  return '#' + c.join('');
}

export function AgentContextProvider({ children }) {
  const [modeColors, setModeColors] = useState({ CORE: ACCENT });

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', ACCENT);
    root.style.setProperty('--accent-hover', darken(ACCENT));
    root.style.setProperty('--accent-rgb', hexToRgb(ACCENT));
  }, []);

  return (
    <AgentContext.Provider value={{
      agentId: AGENT.id,
      agentName: AGENT.name,
      setAgent: () => {},
      agents: [AGENT],
      allAgents: [AGENT],
      agentStatuses: { core: { state: 'live' } },
      refreshAgentStatuses: () => {},
      modeColors,
      setModeColor: () => {},
    }}>
      {children}
    </AgentContext.Provider>
  );
}
