export type Role = "owner" | "staff";
export type User = { id: number; name: string; email: string; role: Role };
export type OrderStatus = "Paid" | "Partial" | "Unpaid";
export type ClientStatus = "ok" | "debt" | "overdue";

export type Order = {
  id: number; order_number: string; client_id: number | null; client_name: string | null;
  product_service: string; quantity: number; unit_price: number; total_amount: number;
  amount_paid: number; amount_due: number; payment_method: string; status: OrderStatus;
  order_date: string; due_date: string | null; inventory_id: number | null; material_used: number | null; created_at: string;
  support_type: string | null; width_cm: number | null; height_cm: number | null; rate_cm2: number | null; extra_fees: number;
};
export type Client = {
  id: number; name: string; phone: string | null; email: string | null; total_spent: number;
  orders_count: number; debt: number; opening_total?: number; opening_paid?: number; next_due: string | null; overdue: boolean; status: ClientStatus; created_at: string;
};
export type StockItem = {
  id: number; ref: string; item: string; unit: string; initial_stock: number; current_stock: number;
  movement: number; purchase_price: number; alert_threshold: number; value: number; low: boolean;
};
export type Expense = {
  id: number; category: string; supplier: string | null; amount: number; payment_method: string;
  observation: string | null; expense_date: string; created_at: string;
};
export type CashEntry = {
  id: number; description: string; type: "IN" | "OUT"; amount: number; running_balance: number;
  payment_method: string; created_at: string;
};
export type Dashboard = {
  today_revenue: number; today_revenue_trend: number | null;
  monthly_revenue: number; monthly_revenue_trend: number | null;
  monthly_expenses: number; monthly_expenses_trend: number | null;
  net_profit: number; unpaid_debts: number; unpaid_count: number; stock_value: number;
  orders_month: number; orders_month_trend: number | null;
  top_items: { name: string; amount: number; share: number }[]; top_items_total: number;
  series: { month: string; sales: number; expenses: number }[];
  recent_orders: Pick<Order, "id" | "order_number" | "client_name" | "product_service" | "quantity" | "total_amount" | "amount_paid" | "amount_due" | "status" | "order_date" | "created_at">[];
};
export type Alerts = {
  low_stock: { id: number; ref: string; item: string; current_stock: number; alert_threshold: number; unit: string }[];
  overdue_clients: { id: number; name: string; debt: number; due_date: string }[];
};
export const PAYMENT_METHODS = ["Espèces", "Carte", "Virement", "Chèque", "Prélèvement"] as const;

export type Settings = {
  shop_name: string; shop_address: string; shop_phone: string; shop_email: string; receipt_footer: string;
  currency: string; receipt_format: "ticket" | "a5" | "a4"; logo: string | null;
  print_rates: Record<string, number>; // price per cm² for each support
};
export const DEFAULT_SETTINGS: Settings = {
  shop_name: "", shop_address: "", shop_phone: "", shop_email: "", receipt_footer: "", currency: "DH", receipt_format: "a5", logo: null,
  print_rates: { "Bâche": 0.3, "Autocollant": 0.3, "Perforé": 0.45, "Étiquettes": 0.45, "Transparents": 0.45 },
};
// Supports priced by surface (width × height in cm × rate per cm²).
export const SUPPORT_TYPES = ["Bâche", "Autocollant", "Perforé", "Étiquettes", "Transparents"] as const;
