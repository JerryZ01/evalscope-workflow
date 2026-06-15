import React from 'react';
import { Typography } from 'antd';

interface PageHeaderProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  extra?: React.ReactNode;
  gradient?: string;
}

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #1890ff 0%, #9254de 100%)';

const PageHeader: React.FC<PageHeaderProps> = ({
  icon,
  title,
  subtitle,
  extra,
  gradient = DEFAULT_GRADIENT,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        {/* 左侧渐变条 */}
        <div
          style={{
            width: 4,
            alignSelf: 'stretch',
            minHeight: 36,
            background: gradient,
            borderRadius: 2,
            boxShadow: '0 2px 8px rgba(24,144,255,0.25)',
          }}
        />
        {icon && (
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 20,
              boxShadow: '0 6px 16px rgba(24,144,255,0.22)',
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <Typography.Title
            level={4}
            style={{
              margin: 0,
              lineHeight: 1.3,
              fontSize: 20,
              fontWeight: 600,
              color: '#1f2d3d',
            }}
          >
            {title}
          </Typography.Title>
          {subtitle && (
            <div
              style={{
                marginTop: 4,
                fontSize: 13,
                color: '#86909c',
                lineHeight: 1.5,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      </div>
      {extra && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {extra}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
