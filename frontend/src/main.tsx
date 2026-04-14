import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { initClientLogger } from './shared/clientLogger';

initClientLogger({
  app: 'app',
  endpoint: '/api/client-log'
});

createRoot(document.getElementById('root')!).render(<App />);
