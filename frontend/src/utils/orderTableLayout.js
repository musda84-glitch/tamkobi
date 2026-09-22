/** Shared orders list column layout (resizable cols persisted under "orders-fit"). */

/** Data columns the user may drag-resize. Actions is intentionally excluded. */
export const ORDER_COL_DEFAULTS = {
  order_number: 145,
  customer_name: 190,
  items: 220,
  total_amount: 90,
  order_status: 130,
};

export const ORDER_COL_LIMITS = {
  min: { order_number: 110, customer_name: 140, items: 160, total_amount: 80, order_status: 120 },
  max: { order_number: 480, customer_name: 760, items: 760, total_amount: 240, order_status: 360 },
};

export const ORDER_SELECT_COL = 40;
/** Fixed actions rail — not user-resizable (keeps the card edge clean). */
export const ORDER_ACTIONS_COL = 210;

export const orderTableMinWidth = (widths = ORDER_COL_DEFAULTS) =>
  ORDER_SELECT_COL + ORDER_ACTIONS_COL + Object.values(widths).reduce((sum, n) => sum + Number(n || 0), 0);
