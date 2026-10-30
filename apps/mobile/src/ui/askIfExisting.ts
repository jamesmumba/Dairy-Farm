import { Alert } from 'react-native';

/**
 * Before saving something that looks already recorded: open the existing record, or save anyway.
 * Never blocks, since real repeats happen (two sales to one customer in a day).
 */
export function askIfExisting(message: string, open: () => void, save: () => void) {
  Alert.alert('Already recorded?', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Open it', onPress: open },
    { text: 'Save anyway', onPress: save },
  ]);
}
