import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { createQueryClient } from './queries/queryClient';
import './styles/global.css';

const queryClient = createQueryClient();

const QueryDevtools = import.meta.env.DEV
  ? lazy(() => import('./queries/QueryDevtools'))
  : () => null;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Suspense fallback={null}>
        <QueryDevtools />
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>,
);
