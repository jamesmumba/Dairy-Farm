import { router } from 'expo-router';
import { Button } from '../ui/form';
import { goBackOrHome, ProblemView } from '../ui/ProblemView';

// A link or address that leads to no screen (an old notification, a mistyped link).
export default function NotFound() {
  return (
    <ProblemView icon="map-marker-question-outline" title="Page not found" message="This link does not lead to anything in the app. Your records are not affected.">
      <Button label="Go to Home" onPress={() => router.replace('/')} />
      <Button label="Go back" variant="secondary" onPress={goBackOrHome} />
    </ProblemView>
  );
}
