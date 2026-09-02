import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useEffect, useState } from 'react';
import LayoutComponent from './components/Layout/Layout';
import Dashboard from './pages/Dashboard';
import TaskList from './pages/TaskList';
import TaskCreate from './pages/TaskCreate';
import TaskEdit from './pages/TaskEdit';
import TaskDetail from './pages/TaskDetail';
import Catalog from './pages/Catalog';
import ModelsPage from './pages/Models';
import SettingsPage from './pages/Settings';
import EvalPlatformV1 from './pages/EvalPlatformV1';
import Docs from './pages/Docs';
import AIChat from './pages/AIChat';
import { useCatalogStore } from './stores';

function App() {
  const [loading, setLoading] = useState(true);
  const { fetchDatasets, fetchModels, fetchMetrics } = useCatalogStore();

  useEffect(() => {
    const initCatalog = async () => {
      try {
        await Promise.all([
          fetchDatasets({ limit: 50 }),
          fetchModels(),
          fetchMetrics()
        ]);
      } catch (error) {
        console.error('Failed to load catalog:', error);
      } finally {
        setLoading(false);
      }
    };

    initCatalog();
  }, []);

  if (loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            background: 'linear-gradient(135deg, #1890ff 0%, #9254de 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(24,144,255,0.4)',
            marginBottom: 24,
          }}
        >
          <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 32 }}>E</span>
        </div>
        <Spin size="large" tip="正在加载 EvalScope..." />
        <style>{`
          .ant-spin-text {
            color: rgba(255,255,255,0.7) !important;
          }
          .ant-spin-dot-item {
            background: linear-gradient(135deg, #1890ff 0%, #9254de 100%) !important;
          }
        `}</style>
      </div>
    );
  }

  return (
    <LayoutComponent>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/tasks" element={<TaskList />} />
        <Route path="/tasks/create" element={<TaskCreate />} />
        <Route path="/tasks/:taskId/edit" element={<TaskEdit />} />
        <Route path="/tasks/:taskId" element={<TaskDetail />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/ai-chat" element={<AIChat />} />
        <Route path="/eval-platform-v1" element={<EvalPlatformV1 />} />
        <Route path="/docs" element={<Docs />} />
      </Routes>
    </LayoutComponent>
  );
}

export default App;