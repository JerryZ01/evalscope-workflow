import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './index.css'

const themeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: '#1890ff',
    colorInfo: '#1890ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorLink: '#1890ff',

    colorTextBase: '#262626',
    colorBgBase: '#ffffff',
    colorBgLayout: '#f5f7fb',

    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 8,
    borderRadiusXS: 6,

    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 28,

    fontFamily:
      "'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    fontSize: 14,

    wireframe: false,
    motionDurationMid: '0.2s',
    motionDurationSlow: '0.3s',

    boxShadow:
      '0 1px 2px -2px rgba(0,0,0,0.06), 0 3px 6px 0 rgba(0,0,0,0.04), 0 5px 12px 4px rgba(0,0,0,0.03)',
    boxShadowSecondary:
      '0 6px 16px 0 rgba(0,0,0,0.06), 0 3px 6px -4px rgba(0,0,0,0.08), 0 9px 28px 8px rgba(0,0,0,0.03)',
  },
  components: {
    Layout: {
      bodyBg: '#f5f7fb',
      headerBg: 'transparent',
      headerPadding: '0 24px',
      headerHeight: 64,
      siderBg: 'transparent',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(24,144,255,0.18)',
      itemSelectedColor: '#ffffff',
      itemColor: 'rgba(255,255,255,0.72)',
      itemHoverColor: '#ffffff',
      itemHoverBg: 'rgba(255,255,255,0.08)',
      itemBorderRadius: 10,
      itemMarginInline: 12,
      itemHeight: 44,
      iconSize: 18,
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(24,144,255,0.22)',
      darkItemHoverBg: 'rgba(255,255,255,0.08)',
    },
    Card: {
      borderRadiusLG: 14,
      paddingLG: 20,
      headerBg: 'transparent',
      headerFontSize: 15,
      boxShadowTertiary:
        '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(15,52,96,0.05)',
    },
    Button: {
      borderRadius: 10,
      controlHeight: 36,
      fontWeight: 500,
      primaryShadow: '0 4px 12px rgba(24,144,255,0.25)',
    },
    Input: {
      borderRadius: 10,
      activeShadow: '0 0 0 3px rgba(24,144,255,0.12)',
    },
    Select: {
      borderRadius: 10,
    },
    Table: {
      borderRadius: 12,
      headerBg: '#f7f9fc',
      headerColor: '#1f2d3d',
      headerSplitColor: 'transparent',
      rowHoverBg: '#f5f9ff',
      cellPaddingBlock: 14,
    },
    Tabs: {
      titleFontSize: 14,
      horizontalItemPadding: '10px 4px',
      inkBarColor: '#1890ff',
      itemActiveColor: '#1890ff',
      itemSelectedColor: '#1890ff',
    },
    Tag: {
      borderRadiusSM: 6,
      defaultBg: '#f5f7fb',
    },
    Statistic: {
      titleFontSize: 13,
      contentFontSize: 28,
    },
    Modal: {
      borderRadiusLG: 16,
    },
    Drawer: {
      borderRadiusLG: 16,
    },
    Tooltip: {
      borderRadius: 8,
    },
    Form: {
      labelColor: '#1f2d3d',
      labelFontSize: 13,
      itemMarginBottom: 18,
    },
  },
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
)
