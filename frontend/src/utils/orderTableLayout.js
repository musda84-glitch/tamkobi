/** Shared orders list column layout (resizable, persisted under "orders-fit"). */

export const ORDER_COL_DEFAULTS = {
  order_number: 150,
  customer_name: 200,
  items: 240,
  total_amount: 96,
  order_status: 140,
  actions: 220,
};

export const ORDER_COL_LIMITS = {
  min: { order_number: 110, customer_name: 140, items: 160, total_amount: 80, order_status: 120, actions: 180 },
  max: { order_number: 480, customer_name: 760, items: 760, total_amount: 240, order_status: 360, actions: 480 },
};

export const ORDER_SELECT_COL = 40;

export const orderTableMinWidth = (widths = ORDER_COL_DEFAULTS) =>
  ORDER_SELECT_COL + Object.values(widths).reduce((sum, n) => sum + Number(n || 0), 0);
