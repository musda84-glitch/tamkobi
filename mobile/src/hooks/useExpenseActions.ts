import { router } from "expo-router";
import type { ApiClient } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { confirmAction } from "../components/chips";
import {
  EXPENSE_DELETE_FAIL,
  EXPENSE_DELETE_TITLE,
  EXPENSE_PAY_FAIL,
  EXPENSE_PAY_OK,
  EXPENSE_UNPAY_BODY,
  EXPENSE_UNPAY_FAIL,
  EXPENSE_UNPAY_OK,
  EXPENSE_UNPAY_TITLE,
  deleteExpense,
  expenseDeleteConfirm,
  expensePayRequest,
  postExpensePayment,
  postExpenseUnpay,
  type ExpensePayBody,
} from "../utils/expenseActions";
import type { Expense } from "../utils/finance";

type ExpenseActions = {
  expenseId?: string;
  expense?: Pick<Expense, "expense_number"> | null;
  payAcc: string;
  reload: () => void | Promise<void>;
  setError: (message: string | null) => void;
  setMessage: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
};

/** Öde / geri al / sil. Detay ekranı bu çağrıları, onayları ve hata metinlerini kullanır. */
export function useExpenseActions({
  expenseId,
  expense,
  payAcc,
  reload,
  setError,
  setMessage,
  setBusy,
}: ExpenseActions) {
  const { client } = useAuth();

  const payTarget = async () => {
    if (!expenseId) return;
    const request = expensePayRequest(payAcc);
    if (!request.ok) { setError(request.error); return; }
    await sendPayment(client, expenseId, request.body, { setBusy, setError, setMessage, reload });
  };

  const unpay = () => {
    if (!expenseId) return;
    confirmAction(EXPENSE_UNPAY_TITLE, EXPENSE_UNPAY_BODY, () => {
      postExpenseUnpay(client, expenseId)
        .then(() => { setMessage(EXPENSE_UNPAY_OK); void reload(); })
        .catch((err) => setError(apiErrorMessage(err, EXPENSE_UNPAY_FAIL)));
    });
  };

  const remove = () => {
    if (!expenseId) return;
    confirmAction(EXPENSE_DELETE_TITLE, expenseDeleteConfirm(expense), () => {
      deleteExpense(client, expenseId)
        .then(() => router.back())
        .catch((err) => setError(apiErrorMessage(err, EXPENSE_DELETE_FAIL)));
    });
  };

  return { payTarget, unpay, remove };
}

async function sendPayment(
  client: ApiClient,
  expenseId: string,
  body: ExpensePayBody,
  bag: Pick<ExpenseActions, "setBusy" | "setError" | "setMessage" | "reload">,
) {
  bag.setBusy(true);
  try {
    await postExpensePayment(client, expenseId, body);
    bag.setMessage(EXPENSE_PAY_OK);
    await bag.reload();
    bag.setError(null);
  } catch (err) {
    bag.setError(apiErrorMessage(err, EXPENSE_PAY_FAIL));
  } finally {
    bag.setBusy(false);
  }
}
