import { Component, type ReactNode } from 'react';
import { errorDetails } from '../lib/errors';
import { Button } from './form';
import { goBackOrHome, ProblemView } from './ProblemView';

// Wraps every screen (the navigators' screenLayout), so a screen that fails to draw is replaced by a
// plain message while the rest of the app (header, tab bar, going back) keeps working.

interface State {
  error: unknown;
}

export class ScreenErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ProblemView
        icon="alert-circle-outline"
        tint="red"
        title="Something went wrong"
        message="This screen could not be shown. Everything you saved is safe on this phone."
        details={errorDetails(this.state.error)}
      >
        <Button label="Try again" onPress={this.reset} />
        <Button
          label="Go back"
          variant="secondary"
          onPress={() => {
            goBackOrHome();
            this.reset();
          }}
        />
      </ProblemView>
    );
  }
}

export const screenLayout = ({ children }: { children: ReactNode }) => <ScreenErrorBoundary>{children}</ScreenErrorBoundary>;
