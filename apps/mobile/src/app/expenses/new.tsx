import { router } from 'expo-router';
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
          const id = addExpense(fields);
          router.replace({ pathname: '/expenses/[id]', params: { id } });
        }}
      />
    </FormScreen>
  );
}
