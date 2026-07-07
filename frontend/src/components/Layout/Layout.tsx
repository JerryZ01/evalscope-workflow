import { Layout, Menu } from 'antd';
import {
  DashboardOutlined,
  UnorderedListOutlined,
  PlusOutlined,
  DatabaseOutlined,
  ApiOutlined,
  RobotOutlined,
  SettingOutlined,
  LinkOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';

const { Sider, Header, Content } = Layout;

interface LayoutComponentProps {
  children: React.ReactNode;
}

const SIDER_WIDTH = 232;

const LayoutComponent: React.FC<LayoutComponentProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/tasks', icon: <UnorderedListOutlined />, label: '任务列表' },
    { key: '/tasks/create', icon: <PlusOutlined />, label: '创建任务' },
    { key: '/catalog', icon: <DatabaseOutlined />, label: 'Benchmark 库' },
    { key: '/models', icon: <ApiOutlined />, label: '模型管理' },
    { key: '/ai-chat', icon: <RobotOutlined />, label: 'AI 助手' },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
    { key: '/eval-platform-v1', icon: <LinkOutlined />, label: '评测平台 v1.0' },
    { key: '/docs', icon: <ReadOutlined />, label: '使用文档' },
  ];

  // 命中最长前缀的菜单项作为高亮
  const selectedKey = (() => {
    const path = location.pathname;
    const hit = menuItems
      .map((m) => m.key)
      .filter((k) => path === k || path.startsWith(k + '/'))
      .sort((a, b) => b.length - a.length)[0];
    return hit || path;
  })();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 侧边栏 */}
      <Sider
        width={SIDER_WIDTH}
        className="eval-sider"
        style={{
          background: 'var(--gradient-sider)',
          boxShadow: '4px 0 24px rgba(15, 37, 71, 0.18)',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          overflow: 'hidden',
        }}
      >
        {/* 装饰光晕 */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: -80,
            left: -60,
            width: 240,
            height: 240,
            background:
              'radial-gradient(circle, rgba(24,144,255,0.28) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            bottom: -100,
            right: -60,
            width: 220,
            height: 220,
            background:
              'radial-gradient(circle, rgba(146,84,222,0.22) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Logo */}
        <div
          style={{
            position: 'relative',
            height: 64,
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'var(--gradient-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 20px rgba(24,144,255,0.35)',
                position: 'relative',
              }}
            >
              <span
                style={{
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 17,
                  letterSpacing: 0.5,
                }}
              >
                E
              </span>
            </div>
            <div style={{ lineHeight: 1.2 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 16,
                  color: '#fff',
                  letterSpacing: 0.3,
                }}
              >
                EvalScope
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.45)',
                  letterSpacing: '2px',
                  marginTop: 2,
                }}
              >
                WORKFLOW
              </div>
            </div>
          </div>
        </div>

        {/* 菜单 */}
        <div style={{ position: 'relative', marginTop: 14 }}>
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ background: 'transparent', borderRight: 'none' }}
          />
        </div>

        {/* 底部版权 */}
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.32)',
            fontSize: 11,
            letterSpacing: 0.5,
          }}
        >
          © EvalScope · v1.0
        </div>
      </Sider>

      {/* 主内容区 */}
      <Layout style={{ marginLeft: SIDER_WIDTH, background: 'var(--color-bg-page)' }}>
        {/* 顶部 Header */}
        <Header
          style={{
            padding: '0 24px',
            background: 'var(--gradient-header)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 2px 12px rgba(15, 37, 71, 0.12)',
            position: 'sticky',
            top: 0,
            zIndex: 99,
            height: 56,
            lineHeight: '56px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 3,
                height: 18,
                background: 'var(--gradient-primary)',
                borderRadius: 2,
              }}
            />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.92)',
                letterSpacing: 0.3,
              }}
            >
              工作流引擎
            </span>
            <span
              style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.4)',
                marginLeft: 4,
              }}
            >
              / 模型评测自动化平台
            </span>
          </div>

          {/* 右侧状态徽章 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                padding: '5px 12px',
                borderRadius: 999,
                background: 'rgba(82,196,26,0.14)',
                border: '1px solid rgba(82,196,26,0.32)',
                fontSize: 12,
                color: '#b7eb8f',
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                lineHeight: 1,
              }}
            >
              <span
                className="status-dot"
                style={{ color: 'rgba(82,196,26,0.35)', background: '#52c41a' }}
              />
              在线服务
            </div>
          </div>
        </Header>

        {/* 内容区 */}
        <Content
          style={{
            padding: '20px 24px 32px',
            minHeight: 'calc(100vh - 56px)',
            background: 'var(--color-bg-page)',
            position: 'relative',
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'fixed',
              top: 56,
              right: 0,
              width: '40%',
              maxWidth: 720,
              height: 320,
              background:
                'radial-gradient(circle at 80% 30%, rgba(24,144,255,0.06) 0%, transparent 65%)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          <div className="page-fade-in" style={{ position: 'relative', zIndex: 1 }}>
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  );
};

export default LayoutComponent;
