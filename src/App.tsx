import { Component, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Library from './pages/Library';
import Practice from './pages/Practice';
import Import from './pages/Import';
import KeyboardTest from './pages/KeyboardTest';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="page">
          <h1>Something went wrong</h1>
          <p role="alert">{this.state.error.message}</p>
          <button
            className="primary"
            onClick={() => {
              this.setState({ error: null });
              window.location.href = '/';
            }}
          >
            Back to the library
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

function NarrowNotice() {
  return (
    <div className="narrow-notice" role="alert">
      This window is too narrow for practice — widen it to at least 1024 px.
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <NarrowNotice />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/practice/:songId" element={<Practice />} />
          <Route path="/import" element={<Import />} />
          <Route path="/keyboard-test" element={<KeyboardTest />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
