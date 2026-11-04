import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

/**
 * Error boundary so a renderer crash inside any tab doesn't unmount the
 * entire app and leave the user staring at a blank window. Shows the error
 * message + stack inline, plus a "Reload" button. Without this, any React
 * exception during render (bad settings.json shape, undefined map target,
 * etc.) takes the whole UI offline silently — which is what was happening
 * when clicking the phrases tab made "everything disappear".
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the main-process log via the preload bridge if available.
    console.error('[renderer crash]', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{ padding: 24, color: '#eee', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}
      >
        <h2 style={{ marginTop: 0, color: '#ff8fb3' }}>Something crashed in the UI</h2>
        <p style={{ opacity: 0.8 }}>
          The app caught an error before the whole window went blank. Copy the message below if you
          want to report it, then click <b>Reload</b>.
        </p>
        <pre
          style={{
            background: '#181522',
            padding: 12,
            borderRadius: 8,
            overflow: 'auto',
            maxHeight: 280,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {String(this.state.error?.stack ?? this.state.error)}
        </pre>
        <button
          style={{
            marginTop: 12,
            padding: '8px 14px',
            background: '#46f0c8',
            color: '#101',
            border: 0,
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
          }}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element missing from index.html');
}

// The renderer is only meant to run inside the Electron window, where the
// preload script exposes `window.chatbox`. If someone opens the Vite dev URL
// (http://localhost:5173) directly in a browser, there's no preload and every
// IPC call would throw "Cannot read properties of undefined". Render a clear
// message instead of letting React crash on a blank page.
if (typeof (window as unknown as { chatbox?: unknown }).chatbox === 'undefined') {
  ReactDOM.createRoot(rootEl).render(
    <div className="boot" style={{ padding: 24, lineHeight: 1.5, color: '#eee' }}>
      <h2 style={{ marginTop: 0 }}>Open this app from Electron, not a browser.</h2>
      <p>
        You are viewing the Vite dev server directly. The chatbox needs the Electron preload bridge
        (<code>window.chatbox</code>), which only exists when the page is loaded by Electron.
      </p>
      <ol>
        <li>Close this browser tab.</li>
        <li>
          In a terminal in the project folder, run <code>npm run dev</code>.
        </li>
        <li>Wait ~10 seconds. An Electron window opens automatically — that is the app.</li>
      </ol>
      <p style={{ opacity: 0.7 }}>
        If no Electron window appears, check the terminal output for errors from the{' '}
        <code>electron</code> script.
      </p>
    </div>,
  );
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
