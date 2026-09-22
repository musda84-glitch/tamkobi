import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { GroupedSelect } from "../components/GroupedSelect";
import { OvertimeAssignFields } from "../components/OvertimeAssignFields";
import { Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { TabStrip } from "../components/TabStrip";
import { colors } from "../theme";
import {
  LEAVE_TYPES,
  employeeSelectGroups,
  leaveDays,
  leaveStatusTr,
  leaveTypeTr,
  dailyEarned,
  isDailyWage,
  monthlyPayrollLoad,
  openPayroll,
  advancePayload,
  payrollBreakdown,
  payrollStatusTr,
  remainingDue,
  employeeCompRows,
  unpaidPayrollTotal,
  employeePayMoves,
  EMPLOYEE_CARD_PAY_ACTIONS,
  EMPLOYEE_CARD_WORK_ACTIONS,
  allowanceDue,
  bonusDue,
  bonusPayPayload,
  enrichEmployeeBalance,
  overtimeDue,
  personnelExpensePayload,
  assignEmployeeToTasks,
  overtimePayload,
  projectSelectGroups,
  taskSelectGroups,
  validateAdvance,
  validateIsoDate,
  validateLeave,
  validateOvertime,
  validateTaskAssign,
  type AttendancePayload,
  type AttendanceSummary,
  type Employee,
  type EmployeeBalance,
  type EmployeeCard,
  type EmployeePayMove,
  type LeaveRequest,
  type Payroll,
  type ProjectWithTasks,
} from "../utils/personnel";
import { paymentTargetGroups, splitPaymentTarget, type BankAccount, type Partner } from "../utils/finance";
import { fmtMoney, idOf, todayIso } from "../utils/money";

type Tab = "payroll" | "attendance" | "leaves";

export function PersonnelScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/personnel", "edit");
  const [tab, setTab] = useState<Tab>("payroll");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [attendance, setAttendance] = useState<AttendancePayload | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [balances, setBalances] = useState<Record<string, EmployeeBalance>>({});
  const [payItem, setPayItem] = useState<Payroll | null>(null);
  const [payAccount, setPayAccount] = useState("");
  const [advanceEmp, setAdvanceEmp] = useState<Employee | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceNote, setAdvanceNote] = useState("");
  const [allowanceEmp, setAllowanceEmp] = useState<Employee | null>(null);
  const [allowanceKind, setAllowanceKind] = useState<"meal" | "transport">("meal");
  const [allowanceAmount, setAllowanceAmount] = useState("");
  const [allowanceNote, setAllowanceNote] = useState("");
  const [leaveForm, setLeaveForm] = useState({ employee_id: "", type: "annual", start_date: "", end_date: "", reason: "" });
  const [movesEmp, setMovesEmp] = useState<Employee | null>(null);
  const [moves, setMoves] = useState<EmployeePayMove[]>([]);
  const [movesBusy, setMovesBusy] = useState(false);
  const [otEmp, setOtEmp] = useState<Employee | null>(null);
  const [otHours, setOtHours] = useState("");
  const [otStart, setOtStart] = useState("");
  const [otEnd, setOtEnd] = useState("");
  const [otDate, setOtDate] = useState(todayIso());
  const [otNote, setOtNote] = useState("");
  const [taskEmp, setTaskEmp] = useState<Employee | null>(null);
  const [projects, setProjects] = useState<ProjectWithTasks[]>([]);
  const [taskProjectId, setTaskProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [extraEmp, setExtraEmp] = useState<Employee | null>(null);
  const [extraKind, setExtraKind] = useState<"bonus" | "overtime">("bonus");
  const [extraAmount, setExtraAmount] = useState("");
  const [extraNote, setExtraNote] = useState("");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [emps, pays, accs, pars, lvs, att] = await Promise.all([
        get<Employee[]>(client, "/personnel/employees", { company_id: companyId }),
        get<Payroll[]>(client, "/personnel/payrolls", { company_id: companyId }),
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }).catch(() => []),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
        get<LeaveRequest[]>(client, "/personnel/leaves", { company_id: companyId }).catch(() => []),
        get<AttendancePayload>(client, "/personnel/attendance", { company_id: companyId, month }).catch(() => null),
      ]);
      setEmployees(emps || []);
      setPayrolls(pays || []);
      setAccounts(Array.isArray(accs) ? accs : []);
      setPartners(Array.isArray(pars) ? pars : []);
      setLeaves(lvs || []);
      setAttendance(att);
      const pairs = await Promise.all((emps || []).slice(0, 40).map(async (e) => {
        const card = await get<EmployeeCard>(client, `/personnel/employees/${idOf(e)}/card`).catch(() => null);
        return [idOf(e), enrichEmployeeBalance(card, month)] as const;
      }));
      setBalances(Object.fromEntries(pairs.filter((row): row is readonly [string, EmployeeBalance] => !!row[1])));
      const firstPartner = (pars || []).find((p) => p.is_active !== false);
      if ((accs || []).length) setPayAccount((cur) => cur || idOf(accs[0]));
      else if (firstPartner) setPayAccount((cur) => cur || `partner:${idOf(firstPartner)}`);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Personel verileri yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, month]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openSalaryPay = async (emp: Employee) => {
    let item = openPayroll(idOf(emp), payrolls);
    if (!item) {
      setBusy(true);
      try {
        await post(client, "/personnel/generate-payroll", {
          company_id: companyId,
          period: new Date().toISOString().slice(0, 7),
        });
        const pays = await get<Payroll[]>(client, "/personnel/payrolls", { company_id: companyId });
        setPayrolls(pays || []);
        item = openPayroll(idOf(emp), pays || []);
        if (!item) {
          setMessage("Bu dönemin maaşı zaten ödenmiş.");
          return;
        }
      } catch (err) {
        setError(apiErrorMessage(err, "Bordro hazırlanamadı."));
        return;
      } finally {
        setBusy(false);
      }
    }
    setPayItem(item);
    const [freshAccs, freshPars] = await Promise.all([
      get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }).catch(() => accounts),
      get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => partners),
    ]);
    const accList = Array.isArray(freshAccs) ? freshAccs : accounts;
    const parList = Array.isArray(freshPars) ? freshPars : partners;
    setAccounts(accList);
    setPartners(parList);
    const firstPartner = parList.find((p) => p.is_active !== false);
    setPayAccount((cur) => cur || (accList[0] ? idOf(accList[0]) : firstPartner ? `partner:${idOf(firstPartner)}` : ""));
  };

  const saveAdvance = async () => {
    if (!advanceEmp) return;
    const invalid = validateAdvance(advanceAmount);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      await post(client, "/personnel/bonuses", {
        ...advancePayload(idOf(advanceEmp), advanceAmount, new Date().toISOString().slice(0, 7), payAccount, advanceNote),
      });
      setAdvanceEmp(null);
      setAdvanceAmount("");
      setAdvanceNote("");
      setMessage(`${advanceEmp.full_name} için avans kaydedildi.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Avans kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openAllowance = (emp: Employee, kind: "meal" | "transport") => {
    setAllowanceEmp(emp);
    setAllowanceKind(kind);
    const due = allowanceDue(emp, balances[idOf(emp)], kind);
    setAllowanceAmount(due > 0 ? String(due) : "");
    setAllowanceNote("");
    get<Partner[]>(client, "/banking/partners", { company_id: companyId })
      .then((pars) => { if (Array.isArray(pars)) setPartners(pars); })
      .catch(() => undefined);
  };

  const saveAllowance = async () => {
    if (!allowanceEmp) return;
    const invalid = validateAdvance(allowanceAmount);
    if (invalid) { setError(invalid === "Avans tutarı girin." ? "Tutar girin." : invalid); return; }
    setBusy(true);
    try {
      await post(client, "/expenses", personnelExpensePayload(
        idOf(allowanceEmp),
        allowanceKind,
        allowanceAmount,
        payAccount,
        allowanceNote,
        companyId,
        todayIso(),
      ));
      const label = allowanceKind === "meal" ? "Yemek" : "Yol";
      setAllowanceEmp(null);
      setAllowanceAmount("");
      setAllowanceNote("");
      setMessage(`${allowanceEmp.full_name} için ${label.toLowerCase()} ödemesi kaydedildi.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Ödeme kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openOvertime = (emp: Employee) => {
    setOtEmp(emp);
    setOtHours("");
    setOtStart("");
    setOtEnd("");
    setOtDate(todayIso());
    setOtNote("");
  };

  const saveOvertime = async () => {
    if (!otEmp) return;
    const invalid = validateOvertime(otHours, otStart, otEnd) || validateIsoDate(otDate);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      const r = await put<{ message?: string }>(client, "/personnel/attendance/assign-overtime", overtimePayload(idOf(otEmp), otDate, otHours, otNote, otStart, otEnd));
      setOtEmp(null);
      setMessage(r?.message || `${otEmp.full_name} için fazla mesai yazıldı.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Fazla mesai yazılamadı."));
    } finally {
      setBusy(false);
    }
  };

  const openTaskAssign = async (emp: Employee) => {
    setTaskEmp(emp);
    setTaskProjectId("");
    setTaskId("");
    setTaskTitle("");
    setBusy(true);
    try {
      const rows = await get<ProjectWithTasks[]>(client, "/projects", { company_id: companyId, light: 1 });
      setProjects(rows || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Projeler yüklenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openAdvance = (emp: Employee) => {
    setAdvanceEmp(emp);
    setAdvanceAmount("");
    setAdvanceNote("");
    get<Partner[]>(client, "/banking/partners", { company_id: companyId })
      .then((pars) => { if (Array.isArray(pars)) setPartners(pars); })
      .catch(() => undefined);
  };

  const openExtraPay = (emp: Employee, kind: "bonus" | "overtime") => {
    const bal = balances[idOf(emp)];
    const due = kind === "overtime" ? overtimeDue(bal) : bonusDue(bal);
    setExtraEmp(emp);
    setExtraKind(kind);
    setExtraAmount(due > 0 ? String(due) : "");
    setExtraNote("");
    get<Partner[]>(client, "/banking/partners", { company_id: companyId })
      .then((pars) => { if (Array.isArray(pars)) setPartners(pars); })
      .catch(() => undefined);
  };

  const saveExtraPay = async () => {
    if (!extraEmp) return;
    const invalid = validateAdvance(extraAmount);
    if (invalid) { setError(invalid === "Avans tutarı girin." ? "Tutar girin." : invalid); return; }
    setBusy(true);
    try {
      await post(client, "/personnel/bonuses", bonusPayPayload(
        idOf(extraEmp),
        extraKind,
        extraAmount,
        month,
        payAccount,
        extraNote,
      ));
      const label = extraKind === "overtime" ? "Fazla mesai ücreti" : "Prim";
      setExtraEmp(null);
      setExtraAmount("");
      setExtraNote("");
      setMessage(`${extraEmp.full_name} için ${label.toLowerCase()} kaydedildi.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Ödeme kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const empActionHandlers = {
    advance: openAdvance,
    salary: openSalaryPay,
    task: openTaskAssign,
    overtime: openOvertime,
    meal: (emp: Employee) => openAllowance(emp, "meal"),
    transport: (emp: Employee) => openAllowance(emp, "transport"),
    bonus: (emp: Employee) => openExtraPay(emp, "bonus"),
    otpay: (emp: Employee) => openExtraPay(emp, "overtime"),
  };

  const saveTaskAssign = async () => {
    if (!taskEmp) return;
    const invalid = validateTaskAssign(taskProjectId, taskId, taskTitle);
    if (invalid) { setError(invalid); return; }
    const project = projects.find((p) => idOf(p) === taskProjectId);
    if (!project) { setError("Proje bulunamadı."); return; }
    const next = assignEmployeeToTasks(project.tasks, taskEmp, { taskId, title: taskTitle });
    if (next.error) { setError(next.error); return; }
    setBusy(true);
    try {
      await put(client, `/projects/${taskProjectId}`, { tasks: next.tasks });
      setTaskEmp(null);
      setMessage(`${taskEmp.full_name} ${project.name || "projeye"} atandı.`);
    } catch (err) {
      setError(apiErrorMessage(err, "Görev ataması kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const paySalary = async () => {
    if (!payItem) return;
    setBusy(true);
    try {
      const r = await post<{ message?: string }>(client, `/personnel/payrolls/${idOf(payItem)}/pay`, splitPaymentTarget(payAccount));
      setMessage(r?.message || "Maaş ödemesi yapıldı.");
      setPayItem(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Maaş ödemesi gerçekleştirilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const attAct = async (employeeId: string, body: Record<string, unknown>) => {
    try {
      await post(client, "/personnel/attendance", { employee_id: employeeId, ...body });
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Puantaj kaydedilemedi."));
    }
  };

  const saveLeave = async () => {
    const invalid = validateLeave(leaveForm.employee_id, leaveForm.start_date, leaveForm.end_date);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      await post(client, "/personnel/leaves", { ...leaveForm, days: leaveDays(leaveForm.start_date, leaveForm.end_date) });
      setLeaveForm({ employee_id: "", type: "annual", start_date: "", end_date: "", reason: "" });
      setMessage("İzin talebi oluşturuldu.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İzin kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openMoves = async (emp: Employee) => {
    setMovesEmp(emp);
    setMoves([]);
    setMovesBusy(true);
    try {
      const card = await get<EmployeeCard>(client, `/personnel/employees/${idOf(emp)}/card`);
      setMoves(employeePayMoves(card));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Ödeme hareketleri yüklenemedi."));
      setMovesEmp(null);
    } finally {
      setMovesBusy(false);
    }
  };

  const decideLeave = async (id: string, status: "approved" | "rejected") => {
    try {
      await post(client, `/personnel/leaves/${id}/decide`, { status });
      setMessage(status === "approved" ? "İzin onaylandı." : "İzin reddedildi.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem başarısız."));
    }
  };

  const loadAmount = monthlyPayrollLoad(employees);
  const pendingLeaves = leaves.filter((l) => l.status === "pending").length;
  const payGroups = paymentTargetGroups(accounts, partners, { partnersFirst: true });

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <Text style={{ fontWeight: "800", color: colors.text, fontSize: 18 }} testID="personnel-title">Personel & Bordro</Text>
      <Muted>Aylık net maaş yükü: {fmtMoney(loadAmount)}{employees.some(isDailyWage) ? " · yevmiye × 26 gün tahmini" : ""}</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted testID="personnel-msg">{message}</Muted> : null}

      <TabStrip
        testID="personnel-tab"
        value={tab}
        onChange={setTab}
        items={[
          { key: "payroll", label: "Bordro", icon: "people", count: employees.length },
          { key: "attendance", label: "Puantaj", icon: "time" },
          { key: "leaves", label: "İzinler", icon: "calendar", count: pendingLeaves || undefined },
        ]}
      />

      {tab === "payroll" ? (
        <>
          {!employees.length ? (
            <Empty icon="people-outline" title="Çalışan yok" />
          ) : employees.map((emp) => {
            const eid = idOf(emp);
            const unpaid = unpaidPayrollTotal(eid, payrolls);
            const due = remainingDue(balances[eid], unpaid);
            const bal = balances[eid];
            const comp = employeeCompRows(emp, bal);
            return (
              <Card key={eid} testID={`employee-card-${emp.tc_kimlik || eid}`}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <EmployeeAvatar
                    name={emp.full_name}
                    photoUrl={emp.photo_url}
                    size={48}
                    testID={`emp-card-photo-${eid}`}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                      <Text style={{ fontWeight: "800", color: colors.text }}>{emp.full_name}</Text>
                      {isDailyWage(emp) ? (
                        <Text
                          testID={`emp-yevmiye-badge-${eid}`}
                          style={{ fontSize: 10, fontWeight: "800", color: "#B45309", backgroundColor: "#FFFBEB", overflow: "hidden", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}
                        >
                          Yevmiye
                        </Text>
                      ) : null}
                    </View>
                    <Muted>{[emp.position, emp.department].filter(Boolean).join(" · ")}</Muted>
                    <Muted>{[emp.phone, emp.email].filter(Boolean).join(" · ") || "İletişim yok"}</Muted>
                  </View>
                </View>
                <Row testID={`emp-comp-${eid}`} style={{ flexWrap: "wrap", justifyContent: "space-between", paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                  {comp.map((row) => (
                    <View key={row.key} style={{ minWidth: 140, flexGrow: 1, flexBasis: "46%", paddingRight: 8, paddingBottom: 4 }}>
                      <Muted>{row.label}{row.key === "salary" && isDailyWage(emp) ? " / gün" : ""}</Muted>
                      <Text
                        testID={row.key === "total" ? `emp-remaining-${eid}` : `emp-comp-${row.key}-${eid}`}
                        style={{ fontWeight: "800", color: row.key === "total" ? colors.primary : colors.text }}
                      >
                        {fmtMoney(row.value)}
                      </Text>
                    </View>
                  ))}
                </Row>
                {due !== (comp.find((r) => r.key === "total")?.value ?? 0) || bal?.advances ? (
                  <Row style={{ justifyContent: "space-between" }}>
                    {due !== (comp.find((r) => r.key === "total")?.value ?? 0) ? (
                      <View>
                        <Muted>Kalan alacak</Muted>
                        <Text style={{ fontWeight: "700", color: due > 0 ? colors.danger : colors.text }}>{fmtMoney(due)}</Text>
                      </View>
                    ) : null}
                    {bal?.advances ? (
                      <View style={{ alignItems: "flex-end" }}>
                        <Muted>Avans</Muted>
                        <Text style={{ fontWeight: "700", color: colors.warning }}>{fmtMoney(bal.advances)}</Text>
                      </View>
                    ) : null}
                  </Row>
                ) : null}
                <View style={{ gap: 8 }} testID={`emp-card-actions-${eid}`}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    <PayChip
                      title="Hareketler"
                      color={colors.secondary}
                      bg="#F1F5F9"
                      testID={`emp-card-moves-btn-${eid}`}
                      onPress={() => openMoves(emp)}
                      wide
                    />
                    {canEdit ? EMPLOYEE_CARD_PAY_ACTIONS.map((action) => (
                      <EmpActionChip key={action.key} action={action} emp={emp} eid={eid} handlers={empActionHandlers} />
                    )) : null}
                  </View>
                  {canEdit ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} testID={`emp-card-work-actions-${eid}`}>
                      {EMPLOYEE_CARD_WORK_ACTIONS.map((action) => (
                        <EmpActionChip key={action.key} action={action} emp={emp} eid={eid} handlers={empActionHandlers} />
                      ))}
                    </View>
                  ) : null}
                </View>
              </Card>
            );
          })}

          <Text style={{ fontWeight: "800", color: colors.text, marginTop: 8 }}>Bordro & maaş ödemeleri</Text>
          {!payrolls.length ? <Muted>Bordro kaydı yok. Aylık bordro hesaplayın.</Muted> : payrolls.map((p) => {
            const extra = payrollBreakdown(p);
            const unpaid = p.status !== "paid";
            return (
              <ListRow
                key={idOf(p)}
                testID={`payroll-row-${idOf(p)}`}
                title={p.employee_name || "Personel"}
                subtitle={[`${p.period} dönemi`, extra, payrollStatusTr(p.status, p.paid_date)].filter(Boolean).join(" · ")}
                right={fmtMoney(p.final_payable ?? p.net_salary)}
                rightSub={unpaid && canEdit ? "Maaşı öde" : undefined}
                rightSubColor={colors.primary}
                onPress={unpaid && canEdit ? () => { setPayItem(p); setPayAccount(payAccount || (accounts[0] ? idOf(accounts[0]) : "")); } : undefined}
              />
            );
          })}
        </>
      ) : null}

      {tab === "attendance" ? (
        <>
          <Field label="Ay" testID="attendance-month-input" value={month} onChangeText={setMonth} placeholder="2026-09" />
          {!(attendance?.summary || []).length ? (
            <Empty icon="time-outline" title="Puantaj yok" hint="Çalışan ekleyince giriş/çıkış burada görünür." />
          ) : (attendance?.summary || []).map((s: AttendanceSummary) => (
            <Card key={s.employee_id} testID={`att-row-${s.employee_id}`}>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <Text style={{ fontWeight: "800", color: colors.text }}>{s.employee_name}</Text>
                {isDailyWage(s) || isDailyWage(employees.find((e) => idOf(e) === s.employee_id)) ? (
                  <Text testID={`att-yevmiye-badge-${s.employee_id}`} style={{ fontSize: 10, fontWeight: "800", color: "#B45309", backgroundColor: "#FFFBEB", overflow: "hidden", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>Yevmiye</Text>
                ) : null}
              </View>
              <Muted>
                Bugün {s.today ? `${s.today.check_in || "--:--"} → ${s.today.check_out || "--:--"}` : "—"}
                {s.today?.late_minutes ? ` · ${s.today.late_minutes} dk geç` : ""}
              </Muted>
              <Muted>Gün {s.days_present || 0} · devamsız {s.days_absent || 0} · izin {s.days_leave || 0} · {s.total_hours || 0} sa · mesai {s.overtime_hours || 0} sa</Muted>
              {(() => {
                const emp = employees.find((e) => idOf(e) === s.employee_id);
                const daily = isDailyWage(s) || isDailyWage(emp);
                if (!daily) return null;
                const days = s.days_present || 0;
                const wage = Number(s.daily_wage ?? emp?.daily_wage) || 0;
                const earned = s.period_wage != null ? Number(s.period_wage) : dailyEarned(emp || { pay_type: "daily", daily_wage: wage }, days);
                return <Muted testID={`att-yevmiye-${s.employee_id}`}>Yevmiye: {days} gün × {fmtMoney(wage)} = {fmtMoney(earned)}</Muted>;
              })()}
              {canEdit ? (
                <Row style={{ flexWrap: "wrap" }}>
                  <PrimaryButton title="Giriş" color={colors.primary} testID={`att-in-${s.employee_id}`} onPress={() => attAct(s.employee_id || "", { action: "check_in" })} />
                  <PrimaryButton title="Çıkış" color={colors.secondary} testID={`att-out-${s.employee_id}`} onPress={() => attAct(s.employee_id || "", { action: "check_out" })} />
                  <PrimaryButton title="Devamsız" color={colors.danger} testID={`att-absent-${s.employee_id}`} onPress={() => attAct(s.employee_id || "", { status: "absent" })} />
                </Row>
              ) : null}
            </Card>
          ))}
          {(attendance?.records || []).slice(0, 30).map((r) => (
            <ListRow
              key={idOf(r)}
              testID={`att-rec-${idOf(r)}`}
              title={r.employee_name || "Personel"}
              subtitle={[r.date, r.status === "present" ? `${r.check_in || "--:--"} → ${r.check_out || "--:--"}` : r.status === "absent" ? "Devamsız" : "İzinli"].join(" · ")}
              right={r.hours != null ? `${r.hours} sa` : undefined}
            />
          ))}
        </>
      ) : null}

      {tab === "leaves" ? (
        <>
          {canEdit ? (
            <Card testID="leave-form">
              <Text style={{ fontWeight: "800", color: colors.text }}>İzin talebi</Text>
              <GroupedSelect
                label="Çalışan"
                testID="leave-employee-select"
                value={leaveForm.employee_id}
                onChange={(v) => setLeaveForm({ ...leaveForm, employee_id: v })}
                groups={employeeSelectGroups(employees)}
                emptyLabel="Çalışan seçin"
              />
              <GroupedSelect
                label="Tür"
                testID="leave-type-select"
                value={leaveForm.type}
                onChange={(v) => setLeaveForm({ ...leaveForm, type: v })}
                groups={[{ label: "İzin türü", options: LEAVE_TYPES.map((t) => ({ value: t.key, label: t.label })) }]}
              />
              <Field label="Başlangıç" testID="leave-start-input" value={leaveForm.start_date} onChangeText={(v) => setLeaveForm({ ...leaveForm, start_date: v })} placeholder="YYYY-MM-DD" />
              <Field label="Bitiş" testID="leave-end-input" value={leaveForm.end_date} onChangeText={(v) => setLeaveForm({ ...leaveForm, end_date: v })} placeholder="YYYY-MM-DD" />
              <Field label="Açıklama" testID="leave-reason-input" value={leaveForm.reason} onChangeText={(v) => setLeaveForm({ ...leaveForm, reason: v })} placeholder="Opsiyonel" />
              <PrimaryButton title="Kaydet" testID="save-leave-btn" color={colors.indigo} loading={busy} onPress={saveLeave} />
            </Card>
          ) : null}
          {!leaves.length ? <Empty icon="calendar-outline" title="İzin talebi yok" /> : leaves.map((l) => (
            <Card key={idOf(l)} testID={`leave-row-${idOf(l)}`}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "800", color: colors.text }}>{l.employee_name}</Text>
                  <Muted>{leaveTypeTr(l.type)} · {l.start_date} → {l.end_date} · {l.days} gün</Muted>
                </View>
                <Text style={{ fontWeight: "700", color: l.status === "approved" ? colors.primary : l.status === "rejected" ? colors.danger : colors.warning }}>
                  {leaveStatusTr(l.status)}
                </Text>
              </Row>
              {canEdit && l.status === "pending" ? (
                <Row>
                  <PrimaryButton title="Onayla" color={colors.primary} testID={`approve-leave-${idOf(l)}`} onPress={() => decideLeave(idOf(l), "approved")} />
                  <PrimaryButton title="Reddet" color={colors.danger} testID={`reject-leave-${idOf(l)}`} onPress={() => decideLeave(idOf(l), "rejected")} />
                </Row>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      <B2BSheet
        visible={!!movesEmp}
        title="Ödeme hareketleri"
        subtitle={movesEmp?.full_name}
        onClose={() => { setMovesEmp(null); setMoves([]); }}
        testID="emp-pay-moves-sheet"
      >
        {movesBusy ? <Muted>Yükleniyor…</Muted> : null}
        {!movesBusy && !moves.length ? <Muted>Bu personel için ödeme hareketi yok.</Muted> : null}
        {moves.map((row) => (
          <ListRow
            key={row.id}
            testID={`emp-pay-move-${row.id}`}
            title={row.title}
            subtitle={row.subtitle}
            right={fmtMoney(row.amount)}
            rightColor={row.kind === "bonus" && row.title === "Avans" ? colors.warning : colors.text}
          />
        ))}
      </B2BSheet>

      <B2BSheet
        visible={!!advanceEmp}
        title="Avans ver"
        subtitle={advanceEmp ? `${advanceEmp.full_name} · ${new Date().toISOString().slice(0, 7)} dönemi · bordroda mahsup edilir` : undefined}
        onClose={() => setAdvanceEmp(null)}
        testID="advance-pay-sheet"
      >
        <Field label="Tutar (₺)" testID="quick-pay-amount" value={advanceAmount} onChangeText={setAdvanceAmount} keyboardType="numeric" placeholder="Örn: 5000" />
        <Field label="Açıklama" testID="quick-pay-note" value={advanceNote} onChangeText={setAdvanceNote} placeholder="Örn: Maaş avansı" />
        <GroupedSelect
          label="Kasa / Banka / Ortak"
          testID="quick-pay-account"
          value={payAccount}
          onChange={setPayAccount}
          groups={payGroups}
          emptyLabel="Hesap seçilmedi (sadece kayıt)"
        />
        <PrimaryButton title="Avansı kaydet" testID="quick-pay-submit" color="#D97706" loading={busy} onPress={saveAdvance} />
      </B2BSheet>

      <B2BSheet
        visible={!!allowanceEmp}
        title={allowanceKind === "meal" ? "Yemek ücreti" : "Yol ödemesi"}
        subtitle={allowanceEmp ? `${allowanceEmp.full_name} · masraf olarak kaydedilir` : undefined}
        onClose={() => setAllowanceEmp(null)}
        testID="allowance-pay-sheet"
      >
        <Field
          label="Tutar (₺)"
          testID="allowance-pay-amount"
          value={allowanceAmount}
          onChangeText={setAllowanceAmount}
          keyboardType="numeric"
          placeholder={allowanceKind === "meal" ? "Örn: 5000" : "Örn: 2500"}
        />
        <Field
          label="Açıklama"
          testID="allowance-pay-note"
          value={allowanceNote}
          onChangeText={setAllowanceNote}
          placeholder={allowanceKind === "meal" ? "Yemek ücreti" : "Yol / ulaşım"}
        />
        <GroupedSelect
          label="Kasa / Banka / Ortak"
          testID="allowance-pay-account"
          value={payAccount}
          onChange={setPayAccount}
          groups={payGroups}
          emptyLabel="Şimdi ödenmeyecek (borç olarak kaydet)"
        />
        <PrimaryButton
          title={payAccount ? "Kaydet & Öde" : "Kaydet"}
          testID="allowance-pay-submit"
          color={allowanceKind === "meal" ? "#C2410C" : "#0E7490"}
          loading={busy}
          onPress={saveAllowance}
        />
      </B2BSheet>

      <B2BSheet
        visible={!!extraEmp}
        title={extraKind === "overtime" ? "Mesai ücreti öde" : "Prim öde"}
        subtitle={extraEmp ? `${extraEmp.full_name} · ${month}` : undefined}
        onClose={() => setExtraEmp(null)}
        testID="extra-pay-sheet"
      >
        <Field
          label="Tutar (₺)"
          testID="extra-pay-amount"
          value={extraAmount}
          onChangeText={setExtraAmount}
          keyboardType="numeric"
          placeholder={extraKind === "overtime" ? "Fazla mesai ücreti" : "Prim tutarı"}
        />
        <Field
          label="Açıklama"
          testID="extra-pay-note"
          value={extraNote}
          onChangeText={setExtraNote}
          placeholder={extraKind === "overtime" ? "Fazla mesai ücreti" : "Prim"}
        />
        <GroupedSelect
          label="Kasa / Banka / Ortak"
          testID="extra-pay-account"
          value={payAccount}
          onChange={setPayAccount}
          groups={payGroups}
          emptyLabel="Şimdi ödenmeyecek (kayıt olarak bırak)"
        />
        <PrimaryButton
          title={payAccount ? "Kaydet & Öde" : "Kaydet"}
          testID="extra-pay-submit"
          color={extraKind === "overtime" ? "#6D28D9" : "#B45309"}
          loading={busy}
          onPress={saveExtraPay}
        />
      </B2BSheet>

      <B2BSheet
        visible={!!payItem}
        title="Maaş ödemesi onayı"
        subtitle={payItem ? `${payItem.employee_name} · ${payItem.period} · ${fmtMoney(payItem.final_payable)}` : undefined}
        onClose={() => setPayItem(null)}
        testID="salary-pay-sheet"
      >
        <GroupedSelect
          label="Ödemenin yapılacağı hesap / ortak"
          testID="salary-pay-account"
          value={payAccount}
          onChange={setPayAccount}
          groups={payGroups}
          emptyLabel="Hesap seçin"
        />
        <PrimaryButton title="Ödemeyi tamamla" testID="confirm-salary-pay-btn" loading={busy} onPress={paySalary} />
      </B2BSheet>

      <B2BSheet
        visible={!!otEmp}
        title="+ Mesai yaz"
        subtitle={otEmp ? `${otEmp.full_name} · saat aralığı (örn. 18:00–20:30)` : undefined}
        onClose={() => setOtEmp(null)}
        testID="overtime-assign-sheet"
      >
        <OvertimeAssignFields
          value={{ date: otDate, start: otStart, end: otEnd, hours: otHours, note: otNote }}
          onChange={(next) => {
            setOtDate(next.date);
            setOtStart(next.start);
            setOtEnd(next.end);
            setOtHours(next.hours);
            setOtNote(next.note);
          }}
        />
        <PrimaryButton title="Mesaiyi kaydet" testID="ot-save-btn" color={colors.indigo} loading={busy} onPress={saveOvertime} />
      </B2BSheet>

      <B2BSheet
        visible={!!taskEmp}
        title="Görev ata"
        subtitle={taskEmp ? `${taskEmp.full_name} · proje görevi seçin veya yeni yazın` : undefined}
        onClose={() => setTaskEmp(null)}
        testID="task-assign-sheet"
      >
        <GroupedSelect
          label="Proje"
          testID="task-project-select"
          value={taskProjectId}
          onChange={(v) => { setTaskProjectId(v); setTaskId(""); }}
          groups={projectSelectGroups(projects)}
          emptyLabel="Proje seçin"
        />
        <GroupedSelect
          label="Mevcut görev"
          testID="task-existing-select"
          value={taskId}
          onChange={setTaskId}
          groups={taskSelectGroups(projects.find((p) => idOf(p) === taskProjectId)?.tasks)}
          emptyLabel="Yeni görev yaz"
        />
        {!taskId ? (
          <Field label="Yeni görev adı" testID="task-title-input" value={taskTitle} onChangeText={setTaskTitle} placeholder="Örn: Keşif, montaj" />
        ) : null}
        <PrimaryButton title="Personeli ata" testID="task-assign-save-btn" color={colors.indigo} loading={busy} onPress={saveTaskAssign} />
      </B2BSheet>
    </Screen>
  );
}

const EMP_ACTION_TONE: Record<string, { color: string; bg: string }> = {
  advance: { color: "#B45309", bg: colors.amber50 },
  salary: { color: colors.primaryHover, bg: colors.emerald50 },
  task: { color: colors.indigo, bg: colors.indigo50 },
  overtime: { color: "#6D28D9", bg: colors.indigo50 },
  meal: { color: "#C2410C", bg: "#FFF7ED" },
  transport: { color: "#0E7490", bg: "#ECFEFF" },
  bonus: { color: "#B45309", bg: "#FFFBEB" },
  otpay: { color: "#6D28D9", bg: "#F5F3FF" },
};

function EmpActionChip({
  action,
  emp,
  eid,
  handlers,
}: {
  action: { key: string; title: string };
  emp: Employee;
  eid: string;
  handlers: Record<string, (emp: Employee) => void>;
}) {
  const tone = EMP_ACTION_TONE[action.key] || { color: colors.text, bg: colors.slate50 };
  return (
    <PayChip
      title={action.title}
      color={tone.color}
      bg={tone.bg}
      testID={`emp-card-${action.key}-btn-${eid}`}
      onPress={() => handlers[action.key]?.(emp)}
    />
  );
}

function PayChip({
  title,
  color,
  bg,
  onPress,
  testID,
  wide,
}: {
  title: string;
  color: string;
  bg: string;
  onPress: () => void;
  testID: string;
  wide?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        flexGrow: 1,
        flexBasis: wide ? "100%" : "47%",
        minWidth: wide ? "100%" : "47%",
        maxWidth: wide ? "100%" : "48.5%",
        minHeight: 40,
        paddingVertical: 8,
        paddingHorizontal: 8,
        borderRadius: 10,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontWeight: "800", fontSize: 12, color, textAlign: "center" }}>{title}</Text>
    </Pressable>
  );
}
