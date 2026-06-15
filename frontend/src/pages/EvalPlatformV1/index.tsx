import { Card } from 'antd';

const EvalPlatformV1: React.FC = () => {
  return (
    <Card
      title="评测平台 v1.0"
      style={{ marginBottom: 24 }}
      styles={{
        body: { padding: 0 }
      }}
    >
      <iframe
        src="https://annto-eval-ver.annto.com/"
        title="评测平台 v1.0"
        style={{
          width: '100%',
          height: 800,
          border: 'none',
          backgroundColor: '#fff',
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
      />
    </Card>
  );
};

export default EvalPlatformV1;
