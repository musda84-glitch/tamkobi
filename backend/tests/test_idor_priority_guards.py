"""Statik kontrol: path-id rotaları kiracı (company) doğrulaması yapmalı."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

GUARDS = {"get_tenant_doc", "assert_doc_company", "get_tenant_child", "users_share_company", "user_may_access_company"}

EXPECTED = {
    "server.py": [
        "assign_office_task", "set_employee_active_duty", "update_employee_assigned_task",
        "delete_employee_assigned_task", "trash_completed_employee_tasks", "create_statement_link",
        "download_contact_statement_pdf", "contact_aging", "apply_contact_terms", "get_contact_overview",
        "clear_contact_opening_balance", "create_contact_ledger_slip", "get_purchase_order",
        "update_stock_lot", "delete_stock_lot", "product_lots", "product_purchase_costs",
        "list_product_movements", "create_dispatch_from_invoice", "create_expense_slip_from_invoice",
        "match_invoice_item_product", "create_product_from_invoice_item",
        "create_missing_products_for_invoice", "approve_cash_request", "reject_cash_request",
        "get_stock_count", "scan_stock_count", "set_stock_count_item", "complete_stock_count",
        "delete_stock_count", "send_project_tracking", "employee_create_user", "set_shopfloor_pin",
        "set_stage_photo_visibility",
        # personnel / orders / production / integrations
        "decide_leave", "cancel_leave", "delete_leave",
        "update_bonus", "decide_bonus", "delete_bonus",
        "pay_payroll", "delete_payroll",
        "complete_my_assigned_task", "upload_my_task_photo",
        "match_order_item_product", "create_dispatch", "warehouse_ship_order",
        "push_order_to_shopphp", "get_order_cargo_label", "get_order_cargo_label_file",
        "update_production_order", "delete_production_order", "copy_recipe",
        "create_production_recipe_from_order", "decide_trash_work_order",
        "update_ecommerce_integration", "remove_ecommerce_channel", "sync_ecommerce_channel",
        "delete_mapping", "update_cargo_integration", "delete_cargo_integration",
        "test_cargo_integration", "refresh_cargo_shipment",
        "approve_marketplace_claim", "reject_marketplace_claim",
        "expense_slip_for_marketplace_claim", "answer_marketplace_question",
        "update_label_template", "delete_label_template",
    ],
    "vehicles.py": ["get_vehicle", "update_vehicle", "delete_vehicle"],
    "tax_obligations.py": ["delete_tax_obligation", "delete_tax_document"],
    "trade.py": ["get_trade_file", "update_trade_file", "delete_trade_file", "set_trade_status"],
    "rbac.py": ["update_role", "delete_role", "update_user", "delete_user"],
    "mobile_logs.py": ["delete_mobile_log"],
    "migration.py": ["migration_batch_errors", "migration_rollback"],
}


def _guarded(fn: ast.AST) -> bool:
    for n in ast.walk(fn):
        if isinstance(n, ast.Name) and n.id in GUARDS:
            return True
        if isinstance(n, ast.Attribute) and n.attr in GUARDS:
            return True
    for n in ast.walk(fn):
        if isinstance(n, ast.Await) and isinstance(n.value, ast.Call):
            f = n.value.func
            if isinstance(f, ast.Name) and f.id.endswith("_core"):
                return True
            if isinstance(f, ast.Attribute) and f.attr.endswith("_core"):
                return True
    return False


def test_priority_path_id_routes_have_tenant_guard():
    missing = []
    for fname, names in EXPECTED.items():
        tree = ast.parse((ROOT / fname).read_text(encoding="utf-8"))
        fns = {n.name: n for n in ast.walk(tree) if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef))}
        for name in names:
            if name not in fns or not _guarded(fns[name]):
                missing.append(f"{fname}:{name}")
    assert not missing, f"Kiracı doğrulaması eksik: {missing}"
