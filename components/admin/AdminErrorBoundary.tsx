"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

export class AdminErrorBoundary extends Component<{
  children: ReactNode; onReset: () => void; fallback: (reset: () => void) => ReactNode;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[admin] section failed:", error, info.componentStack);
  }

  render() {
    if (this.state.failed) return this.props.fallback(() => {
      this.props.onReset();
      this.setState({ failed: false });
    });
    return this.props.children;
  }
}
