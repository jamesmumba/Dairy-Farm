import { router } from 'expo-router';
import { useAuth } from '../state/auth';
import { Button } from '../ui/form';
import { goBackOrHome, ProblemView } from '../ui/ProblemView';

// A link or address that leads to no screen (an old notification, a mistyped link).
export default function NotFound() {
  // Signed out, Home is out of reach: its guard would bounce straight back here.
  const signedIn = useAuth().status === 'signedIn';
  return (
    <ProblemView icon="map-marker-question-outline" title="Page not found" message="This link does not lead to anything in the app. Your records are not affected.">
      {signedIn ? (
        <>
          <Button label="Go to Home" onPress={() => router.replace('/')} />
          <Button label="Go back" variant="secondary" onPress={goBackOrHome} />
        </>
      ) : (
        <Button label="Go to sign in" onPress={() => router.replace('/sign-in')} />
      )}
    </ProblemView>
  );
}
