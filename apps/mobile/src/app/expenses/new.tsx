import { router } from 'expo-router';
import { formatDate } from '../../lib/dates';
import { existingExpense } from '../../finance/existing';
import { CATEGORY_LABELS } from '../../finance/model';
import { askIfExisting } from '../../ui/askIfExisting';
import { ExpenseForm } from '../../finance/ExpenseForm';
import { addExpense } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { FormScreen } from '../../ui/form';

export default function NewExpense() {
  const f = useFinance();
  return (
    <FormScreen card title="New expense">
      <ExpenseForm
        initial={{ expense_date: f.today, category: 'feed', amount: '', currency: f.currency, payee: null, payment_method: 'cash', payment_status: 'paid', notes: null }}
        submitLabel="Save expense"
        onSubmit={(fields) => {
          const save = () => {
            const id = addExpense(fields);
            router.replace({ pathname: '/expenses/[id]', params: { id } });
          };
          const same = existingExpense(f.expenses, fields);
          if (!same) return save();
          askIfExisting(
            `${CATEGORY_LABELS[same.category]}, ${same.currency} ${same.amount} on ${formatDate(same.expense_date)} is already recorded.`,
            () => router.replace({ pathname: '/expenses/[id]', params: { id: same.id } }),
            save,
          );
        }}
      />
    </FormScreen>
  );
}
