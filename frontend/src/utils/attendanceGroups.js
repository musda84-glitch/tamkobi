export function attendanceEmployeeKey(r) {
  return String(r?.employee_id || r?.employee_name || "unknown");
}

export function groupAttendanceRecords(records) {
  const map = new Map();
  for (const r of records || []) {
    const key = attendanceEmployeeKey(r);
    const g = map.get(key);
    if (g) g.records.push(r);
    else {
      map.set(key, {
        employee_id: String(r.employee_id || key),
        employee_name: r.employee_name || "Personel",
        records: [r],
      });
    }
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.records.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }
  groups.sort((a, b) => String(a.employee_name).localeCompare(String(b.employee_name), "tr"));
  return groups;
}

export function attendanceRecordsForEmployee(records, employeeId, employeeName) {
  const key = attendanceEmployeeKey({ employee_id: employeeId, employee_name: employeeName });
  return (records || [])
    .filter((r) => attendanceEmployeeKey(r) === key)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export function attendanceGroupToggleLabel(open, count = 0) {
  const n = Number(count) || 0;
  return open ? `Kayıtları gizle (${n})` : `Kayıtlar (${n})`;
}
