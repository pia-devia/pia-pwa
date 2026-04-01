import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { isAuthenticated } from './api/client';
import { AgentContextProvider } from './context/AgentContext';
import Login from './components/Login/Login';
import Layout from './components/Layout/Layout';

// Sections

import Chat from './components/Chat/Chat';
import ChatWindow from './components/Chat/ChatWindow';

import Pulse from './components/Pulse/Pulse';
import Mente from './components/Mente/Mente';
import Proyectos from './components/Proyectos/Proyectos';
import Vault from './components/Vault/Vault';

import Dashboard from './components/Dashboard/Dashboard';
import DashboardV2 from './components/DashboardV2/DashboardV2';

// File viewer / editor (used inside Mente with nested routes)

import MarkdownView from './components/MarkdownView/MarkdownView';
import Editor from './components/Editor/Editor';

// Legacy route redirects
function RedirectFile() {
  const { '*': path } = useParams();
  return <Navigate to={`/mente/file/${path}`} replace />;
}

function RedirectEdit() {
  const { '*': path } = useParams();
  return <Navigate to={`/mente/edit/${path}`} replace />;
}

function ProtectedRoute({ children }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  if (isAuthenticated()) {
    return <Navigate to="/sistema" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* External chat window (no layout) */}
      <Route
        path="/chat-window"
        element={
          <ProtectedRoute>
            <ChatWindow />
          </ProtectedRoute>
        }
      />

      {/* Public: Login */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />

      {/* Protected: Main app */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AgentContextProvider>
              <Layout />
            </AgentContextProvider>
          </ProtectedRoute>
        }
      >
        {/* Default redirect to /panel */}
        <Route index element={<Navigate to="/panel" replace />} />

        {/* Panel principal */}
        <Route path="panel" element={<DashboardV2 />} />



        {/* 💬 Chat */}
        <Route path="chat" element={<Chat />} />



        {/* ♥ Pulse — system events */}
        <Route path="pulse" element={<Pulse />} />

        {/* Legacy redirect */}
        <Route path="heartpulse" element={<Navigate to="/panel" replace />} />



        {/* 🔐 Vault — secrets manager */}
        <Route path="vault" element={<Vault />} />

        {/* 🧠 Mente — file tree + markdown viewer + editor */}
        <Route path="mente" element={<Mente />}>
          <Route index element={<Dashboard />} />
          <Route path="file/*" element={<MarkdownView />} />
          <Route path="edit/*" element={<Editor />} />
        </Route>

        {/* 📁 Proyectos — shared projects across all agents */}
        <Route path="proyectos" element={<Proyectos />}>
          <Route index element={<Dashboard />} />
          <Route path="file/*" element={<MarkdownView />} />
          <Route path="edit/*" element={<Editor />} />
        </Route>

        {/* Legacy routes — redirect to Mente equivalents */}
        <Route path="file/*" element={<RedirectFile />} />
        <Route path="edit/*" element={<RedirectEdit />} />
        <Route path="events" element={<Navigate to="/pulse" replace />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/sistema" replace />} />
    </Routes>
  );
}
