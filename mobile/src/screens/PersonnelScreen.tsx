import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { del, get, post, put, upload } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { AssignedDutyCard } from "../components/AssignedDutyCard";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { LocationSignalDot } from "../components/LocationSignal";
import { GroupedSelect } from "../components/GroupedSelect";
import { OvertimeAssignFields } from "../components/OvertimeAssignFields";
import { TimeField } from "../components/TimeField";
import { Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { TabStrip } from "../components/TabStrip";
import { colors } from "../theme";
import { compressPickerAsset } from "../utils/compressUploadImage";
import {
  appendUploadBlob,
  imageUploadRequest,
  pickBrowserImages,
  resolveUploadBlob,
  uploadedImageUrl,
} from "../utils/formDataFile";
import {
  LEAVE_TYPES,
  employeeSelectGroups,
  leaveDays,
  leaveStatusTr,
  leaveTypeTr,
  dailyEarned,
  isDailyPayroll,
  isDailyWage,
  monthlyPayrollLoad,
  openPayroll,
  advancePayload,
  payrollBreakdown,
  payrollStatusTr,
  remainingDue,
  employeeCompRows,
  employeeCompGroups,
  employeeCompRowCaption,
  requestDecisionActions,
  unpaidPayrollTotal,
  employeePayMoves,
  EMPLOYEE_CARD_PAY_ACTIONS,
  EMPLOYEE_CARD_WORK_ACTIONS,
  employeeCardActionTitle,
  employeeCardActionIcon,
  EMPLOYEE_LOCATION_SETTINGS_TITLE,
  parseYevmiyeDays,
  parseYevmiyeWage,
  parseTaskDays,
  yevmiyeAccrual,
  yevmiyeAddHint,
  ledgerPayPayload,
  dueDateFromDays,
  validateTaskDays,
  validateYevmiyeDays,
  validateYevmiyeWage,
  yevmiyeDaysFromBonus,
  yevmiyeDaysLine,
  yevmiyePayPayload,
  yevmiyeStatusLine,
  allowanceDue,
  bonusDue,
  bonusPayPayload,
  enrichEmployeeBalance,
  overtimeDue,
  personnelExpensePayload,
  assignEmployeeToTasks,
  employeeDutyBoard,
  employeeStatusLabel,
  openEmployeeTasks,
  remainingLeaveDays,
  workplaceDetailsSummary,
  workplaceDetailsToggleLabel,
  employeeCardChrome,
  employeeCardPayKind,
  initLocMode,
  patchLocMode,
  locationTrackingPayload,
  locationTrackingEnabled,
  locationControllerLabel,
  locationCellCaption,
  locationTrackingTogglePayload,
  todayAttendanceParts,
  locModeSummary,
  DEFAULT_LOC_MODE,
  type LocMode,
  filterPayMoves,
  payMovesPeriodHint,
  payMovesPeriodLabel,
  type PayMovesPeriod,
  pendingRequestDecision,
  pendingRequestDecisionMessage,
  requestKindLabel,
  requestsForEmployee,
  requestsDetailsToggleLabel,
  requestsDetailsToggleIcon,
  requestsDetailsSummary,
  companyBonusPayload,
  bonusesPeriodTotal,
  COMPANY_BONUS_TYPES,
  overtimePayload,
  projectSelectGroups,
  closedProjectCount,
  taskSelectGroups,
  validateAdvance,
  validateIsoDate,
  validateLeave,
  validateOvertime,
  validateTaskAssign,
  attendanceGroupToggleLabel,
  attendanceRecordsForEmployee,
  groupAttendanceRecords,
  workplaceDetailsToggleIcon,
  type AttendancePayload,
  type AttendanceRecord,
  type AttendanceSummary,
  type Employee,
  type EmployeeBalance,
  type EmployeeBonus,
  type EmployeeCard,
  type EmployeePayMove,
  type LedgerSide,
  type LeaveRequest,
  type Payroll,
  type PendingRequest,
  type ProjectWithTasks,
} from "../utils/personnel";
import { paymentTargetGroups, splitPaymentTarget, type BankAccount, type Partner } from "../utils/finance";
import { fmtMoney, idOf, todayIso } from "../utils/money";
import { findWorkPark, officeTaskPayload, parkSelectGroups, validateOfficeTaskAssign, type WorkPark } from "../utils/workParks";
import { fmtDmy } from "../utils/calendar";
import { fieldWorkplaceFromProjects, workplaceHint, workplaceShort, type Workplace } from "../utils/workplace";
import { dutyFromCurrent, pendingDutyPhotoCount, type AssignedDuty } from "../utils/assignedDuty";

type Tab = "payroll" | "attendance" | "leaves" | "extras";

function AttendanceRecCard({
  r,
  canEdit,
  onDecide,
  onCorrectOut,
  hideName,
}: {
  r: AttendanceRecord;
  canEdit: boolean;
  onDecide: (it: PendingRequest, approved: boolean | "ack" | "deduct") => void;
  onCorrectOut?: (rec: AttendanceRecord, checkOut: string) => void;
  hideName?: boolean;
}) {
  const early = r.early_leave_request?.status === "pending";
  const intra = r.intraday_leave_request?.status === "pending";
  const yevAdj = r.yevmiye_adjustment_request?.status === "pending";
  const locExit = r.location_exit_request?.status === "pending";
  const yevLine = yevmiyeStatusLine(r);
  const [editOut, setEditOut] = React.useState(r.check_out || "");
  return (
    <View testID={`att-rec-${idOf(r)}`} style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8 }}>
      {hideName ? null : <Text style={{ fontWeight: "800", color: colors.text }}>{r.employee_name || "Personel"}</Text>}
      <Muted>
        {[fmtDmy(r.date), r.status === "present" ? `${r.check_in || "--:--"} → ${r.check_out || "--:--"}` : r.status === "absent" ? "Devamsız" : "İzinli"].join(" · ")}
        {r.hours != null ? ` · ${r.hours} sa` : ""}
        {r.late_minutes ? ` · ${r.late_minutes} dk geç` : ""}
      </Muted>
      {r.manager_time_edit?.pending_employee ? (
        <Muted testID={`att-time-edit-${idOf(r)}`}>Personel onayı bekleniyor ({r.manager_time_edit.prev_check_out || r.manager_time_edit.prev_check_in || "—"} → {r.manager_time_edit.check_out || r.manager_time_edit.check_in || "—"})</Muted>
      ) : null}
      {early ? <Muted testID={`att-early-${idOf(r)}`}>Erken çıkış talebi {r.early_leave_request?.planned_time || ""} {r.early_leave_request?.reason ? `· ${r.early_leave_request.reason}` : ""}</Muted> : null}
      {intra ? <Muted testID={`att-intra-${idOf(r)}`}>Gün içi izin {r.intraday_leave_request?.out_time || ""}–{r.intraday_leave_request?.return_time || ""} {r.intraday_leave_request?.reason ? `· ${r.intraday_leave_request.reason}` : ""}</Muted> : null}
      {yevLine ? <Muted testID={`att-yevmiye-adj-${idOf(r)}`}>{yevLine}</Muted> : null}
      {locExit ? (
        <Muted testID={`att-loc-exit-${idOf(r)}`}>
          Konum dışı{r.location_exit_request?.place ? ` · ${r.location_exit_request.place}` : ""}
          {r.location_exit_request?.distance_m != null ? ` · ${r.location_exit_request.distance_m} m` : ""}
          {r.location_exit_request?.tolerance_hours ? ` · tolerans ${r.location_exit_request.tolerance_hours} sa` : ""}
          {` · kesinti: ${r.location_exit_request?.wage_deduction == null ? "bekliyor" : r.location_exit_request.wage_deduction ? "olsun" : "olmasın"}`}
        </Muted>
      ) : null}
      {canEdit && (early || intra || yevAdj || locExit) ? (
        <Row>
          {early ? (
            <>
              <PrimaryButton title="Erken çıkış onayla" color={colors.primary} testID={`att-early-ok-${idOf(r)}`} onPress={() => onDecide({ id: idOf(r), kind: "early_leave" }, true)} />
              <PrimaryButton title="Reddet" color={colors.danger} testID={`att-early-no-${idOf(r)}`} onPress={() => onDecide({ id: idOf(r), kind: "early_leave" }, false)} />
            </>
          ) : null}
          {intra ? (
            <>
              <PrimaryButton title="Gün içi onayla" color={colors.primary} testID={`att-intra-ok-${idOf(r)}`} onPress={() => onDecide({ id: idOf(r), kind: "intraday_leave" }, true)} />
              <PrimaryButton title="Reddet" color={colors.danger} testID={`att-intra-no-${idOf(r)}`} onPress={() => onDecide({ id: idOf(r), kind: "intraday_leave" }, false)} />
            </>
          ) : null}
          {yevAdj ? (
            <>
              <PrimaryButton title="Ücret kes" color={colors.warning} testID={`att-yevmiye-ok-${idOf(r)}`} onPress={() => onDecide({ id: idOf(r), kind: "yevmiye_adjustment" }, true)} />
              <PrimaryButton title="Ücret kesme" color={colors.primary} testID={`att-yevmiye-no-${idOf(r)}`} onPress={() => onDecide({ id: idOf(r), kind: "yevmiye_adjustment" }, false)} />
            </>
          ) : null}
          {locExit ? (
            <>
              <PrimaryButton title="Haberim var" color={colors.secondary} testID={`att-loc-exit-ack-${idOf(r)}`} onPress={() => onDecide({ id: idOf(r), kind: "location_exit" }, "ack")} />
              <PrimaryButton title="Kesinti olmasın" color={colors.primary} testID={`att-loc-exit-ok-${idOf(r)}`} onPress={() => onDecide({ id: idOf(r), kind: "location_exit" }, true)} />
              <PrimaryButton title="Kesinti olsun" color={colors.warning} testID={`att-loc-exit-deduct-${idOf(r)}`} onPress={() => onDecide({ id: idOf(r), kind: "location_exit" }, "deduct")} />
              <PrimaryButton title="Reddet" color={colors.danger} testID={`att-loc-exit-no-${idOf(r)}`} onPress={() => onDecide({ id: idOf(r), kind: "location_exit" }, false)} />
            </>
          ) : null}
        </Row>
      ) : null}
      {canEdit && onCorrectOut && r.status === "present" ? (
        <View style={{ gap: 6, marginTop: 6 }} testID={`att-correct-${idOf(r)}`}>
          <TimeField label="Çıkış saati düzelt" testID={`att-correct-out-${idOf(r)}`} value={editOut} onChangeText={setEditOut} optional />
          <PrimaryButton
            title="Saati kaydet (personel onayı gerekir)"
            color={colors.indigo}
            testID={`att-correct-save-${idOf(r)}`}
            onPress={() => onCorrectOut(r, editOut)}
          />
        </View>
      ) : null}
    </View>
  );
}

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
  const [workplaceOpen, setWorkplaceOpen] = useState<Record<string, boolean>>({});
  const [requestsOpen, setRequestsOpen] = useState<Record<string, boolean>>({});
  const [attRecOpen, setAttRecOpen] = useState<Record<string, boolean>>({});
  const [movesPeriod, setMovesPeriod] = useState<PayMovesPeriod>("30d");
  const [movesMonth, setMovesMonth] = useState(new Date().toISOString().slice(0, 7));
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
  const [taskDays, setTaskDays] = useState("");
  const [taskKind, setTaskKind] = useState<"field" | "office">("field");
  const [taskShowCompleted, setTaskShowCompleted] = useState(false);
  const [workParks, setWorkParks] = useState<WorkPark[]>([]);
  const [taskParkId, setTaskParkId] = useState("");
  const [extraEmp, setExtraEmp] = useState<Employee | null>(null);
  const [extraKind, setExtraKind] = useState<"bonus" | "overtime">("bonus");
  const [extraAmount, setExtraAmount] = useState("");
  const [extraNote, setExtraNote] = useState("");
  const [yevmiyeEmp, setYevmiyeEmp] = useState<Employee | null>(null);
  const [yevmiyeDays, setYevmiyeDays] = useState("");
  const [yevmiyeWage, setYevmiyeWage] = useState("");
  const [yevmiyeNote, setYevmiyeNote] = useState("");
  const [yevmiyeHaveDays, setYevmiyeHaveDays] = useState(0);
  const [ledgerEmp, setLedgerEmp] = useState<Employee | null>(null);
  const [ledgerSide, setLedgerSide] = useState<LedgerSide>("alacak");
  const [ledgerAmount, setLedgerAmount] = useState("");
  const [ledgerNote, setLedgerNote] = useState("");
  const [yevmiyeEditId, setYevmiyeEditId] = useState("");
  const [pendingReqs, setPendingReqs] = useState<PendingRequest[]>([]);
  const [cards, setCards] = useState<Record<string, EmployeeCard>>({});
  const [photoEmp, setPhotoEmp] = useState<Employee | null>(null);
  const [bonuses, setBonuses] = useState<EmployeeBonus[]>([]);
  const [bonusForm, setBonusForm] = useState({ employee_id: "", type: "bonus", amount: "", period: new Date().toISOString().slice(0, 7), note: "" });
  const [expenseEmp, setExpenseEmp] = useState<Employee | null>(null);
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNote, setExpenseNote] = useState("");
  const [locEmp, setLocEmp] = useState<Employee | null>(null);
  const [locBusy, setLocBusy] = useState<string | null>(null);
  const [locCompany, setLocCompany] = useState<LocMode>(DEFAULT_LOC_MODE);
  const [locField, setLocField] = useState<LocMode>(DEFAULT_LOC_MODE);
  const [dutiesEmp, setDutiesEmp] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [emps, pays, accs, pars, lvs, att, projs, reqs, bonusRows] = await Promise.all([
        get<Employee[]>(client, "/personnel/employees", { company_id: companyId }),
        get<Payroll[]>(client, "/personnel/payrolls", { company_id: companyId }),
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }).catch(() => []),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
        get<LeaveRequest[]>(client, "/personnel/leaves", { company_id: companyId }).catch(() => []),
        get<AttendancePayload>(client, "/personnel/attendance", { company_id: companyId, month }).catch(() => null),
        get<ProjectWithTasks[]>(client, "/projects", { company_id: companyId, light: 1 }).catch(() => []),
        get<{ items?: PendingRequest[] }>(client, "/personnel/pending-requests", { company_id: companyId }).catch(() => ({ items: [] })),
        get<EmployeeBonus[]>(client, "/personnel/bonuses", { company_id: companyId }).catch(() => []),
      ]);
      setPayrolls(pays || []);
      setAccounts(Array.isArray(accs) ? accs : []);
      setPartners(Array.isArray(pars) ? pars : []);
      setLeaves(lvs || []);
      setAttendance(att);
      setProjects(Array.isArray(projs) ? projs : []);
      setPendingReqs(Array.isArray(reqs?.items) ? reqs.items : []);
      setBonuses(Array.isArray(bonusRows) ? bonusRows : []);
      const pairs = await Promise.all((emps || []).slice(0, 40).map(async (e) => {
        const card = await get<EmployeeCard>(client, `/personnel/employees/${idOf(e)}/card`).catch(() => null);
        return [idOf(e), enrichEmployeeBalance(card, month), card?.employee?.photo_url, card?.workplace, yevmiyeAccrual({ bonuses: card?.bonuses, payrolls: card?.payrolls, employeeId: idOf(e) }), card] as const;
      }));
      setBalances(Object.fromEntries(pairs.filter((row) => !!row[1]).map(([id, bal]) => [id, bal as EmployeeBalance] as const)));
      setCards(Object.fromEntries(pairs.map(([id, , , , , card]) => [id, card || {}])));
      const photos = Object.fromEntries(pairs.flatMap(([id, , url]) => (url ? [[id, url] as const] : [])));
      const cardWp = Object.fromEntries(pairs.flatMap(([id, , , wp]) => (wp ? [[id, wp] as const] : [])));
      const yevFromCard = Object.fromEntries(pairs.map(([id, , , , yev]) => [id, yev] as const));
      const cardsById = Object.fromEntries(pairs.map(([id, , , , , card]) => [id, card || {}]));
      setEmployees((emps || []).map((e) => {
        const eid = idOf(e);
        const attWp = (att?.summary || []).find((s) => s.employee_id === eid)?.workplace;
        const wp = pickEmployeeWorkplace(e.workplace, cardWp[eid], attWp, fieldWorkplaceFromProjects(projs || [], eid));
        const cardYev = yevFromCard[eid] || { days: 0, amount: 0 };
        const fromPays = yevmiyeAccrual({
          payrolls: (pays || []).filter((p) => p.employee_id === eid),
          employeeId: eid,
        });
        const cardEmp = cardsById[eid]?.employee;
        return {
          ...e,
          ...cardEmp,
          photo_url: e.photo_url || photos[eid] || cardEmp?.photo_url,
          workplace: wp,
          annual_leave_days: cardEmp?.annual_leave_days ?? e.annual_leave_days,
          used_leave_days: cardEmp?.used_leave_days ?? e.used_leave_days,
          yevmiye_days: Math.max(cardYev.days || 0, Number(e.yevmiye_days) || 0, fromPays.days),
          yevmiye_due: Math.max(cardYev.amount || 0, Number(e.yevmiye_due) || 0, fromPays.amount),
        };
      }));
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
    if (isDailyWage(emp)) {
      const due = remainingDue(balances[idOf(emp)], unpaidPayrollTotal(idOf(emp), payrolls));
      setLedgerEmp(emp);
      setLedgerSide("alacak");
      setLedgerAmount(due > 0 ? String(due) : "");
      setLedgerNote("");
      setPayAccount((cur) => cur || (accounts[0] ? idOf(accounts[0]) : ""));
      get<Partner[]>(client, "/banking/partners", { company_id: companyId })
        .then((pars) => {
          if (Array.isArray(pars)) setPartners(pars);
          setPayAccount((cur) => cur || (accounts[0] ? idOf(accounts[0]) : pars?.[0] ? `partner:${idOf(pars[0])}` : ""));
        })
        .catch(() => undefined);
      return;
    }
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
    setTaskDays("");
    setTaskParkId("");
    setTaskShowCompleted(false);
    setBusy(true);
    try {
      const [rows, parksRes] = await Promise.all([
        get<ProjectWithTasks[]>(client, "/projects", { company_id: companyId, light: 1 }),
        get<{ parks?: WorkPark[] }>(client, `/companies/${companyId}/work-parks`).catch(() => ({ parks: [] })),
      ]);
      setProjects(rows || []);
      const parks = parksRes?.parks || [];
      setWorkParks(parks);
      setTaskParkId(parks[0]?.id || "");
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

  const fillYevmiyeForm = (emp: Employee, bonus?: EmployeeBonus | null) => {
    setYevmiyeEmp(emp);
    setPayAccount("");
    if (bonus) {
      setYevmiyeEditId(idOf(bonus));
      setYevmiyeDays(String(yevmiyeDaysFromBonus(bonus) || ""));
      setYevmiyeWage(String(bonus.daily_wage || emp.daily_wage || ""));
      setYevmiyeNote(bonus.note || "");
    } else {
      setYevmiyeEditId("");
      setYevmiyeDays("");
      setYevmiyeWage(emp.daily_wage ? String(emp.daily_wage) : "");
      setYevmiyeNote("");
    }
  };

  const openYevmiyeDays = async (emp: Employee, existing?: EmployeeBonus | null) => {
    fillYevmiyeForm(emp, existing);
    setYevmiyeHaveDays(Number(emp.yevmiye_days) || 0);
    get<Partner[]>(client, "/banking/partners", { company_id: companyId })
      .then((pars) => { if (Array.isArray(pars)) setPartners(pars); })
      .catch(() => undefined);
    if (existing) return;
    try {
      const card = await get<EmployeeCard>(client, `/personnel/employees/${idOf(emp)}/card`);
      const fromPays = yevmiyeAccrual({
        bonuses: card?.bonuses,
        payrolls: card?.payrolls,
        employeeId: idOf(emp),
      });
      setYevmiyeHaveDays(fromPays.days);
    } catch {
      /* mevcut gün bilinmese de yeni kayıt açılır */
    }
  };

  const closeYevmiyeDays = () => {
    setYevmiyeEmp(null);
    setYevmiyeDays("");
    setYevmiyeWage("");
    setYevmiyeNote("");
    setYevmiyeEditId("");
    setYevmiyeHaveDays(0);
  };

  const saveLedger = async () => {
    if (!ledgerEmp) return;
    const invalid = validateAdvance(ledgerAmount);
    if (invalid) { setError(invalid === "Avans tutarı girin." ? "Tutar girin." : invalid); return; }
    if (!payAccount) { setError("Kasa / banka / ortak seçin."); return; }
    setBusy(true);
    try {
      await post(client, "/personnel/bonuses", ledgerPayPayload(
        idOf(ledgerEmp),
        ledgerSide,
        ledgerAmount,
        month,
        payAccount,
        ledgerNote,
      ));
      const label = ledgerSide === "borc" ? "borç" : "bakiye";
      setLedgerEmp(null);
      setLedgerAmount("");
      setLedgerNote("");
      setMessage(`${ledgerEmp.full_name} için ${label} ödemesi yapıldı.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Kayıt yazılamadı."));
    } finally {
      setBusy(false);
    }
  };

  const deletePayMove = async (row: EmployeePayMove) => {
    if (row.kind !== "bonus") return;
    setBusy(true);
    try {
      await del(client, `/personnel/bonuses/${row.id}`);
      setMessage("Yevmiye / ödeme kaydı silindi.");
      if (movesEmp) {
        const card = await get<EmployeeCard>(client, `/personnel/employees/${idOf(movesEmp)}/card`);
        setMoves(employeePayMoves(card));
      }
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Kayıt silinemedi."));
    } finally {
      setBusy(false);
    }
  };

  const deleteYevmiyeEdit = async () => {
    if (!yevmiyeEditId) return;
    setBusy(true);
    try {
      await del(client, `/personnel/bonuses/${yevmiyeEditId}`);
      closeYevmiyeDays();
      setMessage("Yevmiye kaydı silindi.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Yevmiye kaydı silinemedi."));
    } finally {
      setBusy(false);
    }
  };

  const saveYevmiyeDays = async () => {
    if (!yevmiyeEmp) return;
    const daysErr = validateYevmiyeDays(yevmiyeDays);
    if (daysErr) { setError(daysErr); return; }
    const wageErr = validateYevmiyeWage(yevmiyeWage);
    if (wageErr) { setError(wageErr); return; }
    const wage = parseYevmiyeWage(yevmiyeWage) || 0;
    setBusy(true);
    try {
      if (wage !== (Number(yevmiyeEmp.daily_wage) || 0)) {
        await put(client, `/personnel/employees/${idOf(yevmiyeEmp)}`, { daily_wage: wage });
      }
      const payload = yevmiyePayPayload(
        idOf(yevmiyeEmp),
        { ...yevmiyeEmp, daily_wage: wage },
        yevmiyeDays,
        month,
        payAccount,
        yevmiyeNote,
        yevmiyeWage,
      );
      if (yevmiyeEditId) await put(client, `/personnel/bonuses/${yevmiyeEditId}`, payload);
      else await post(client, "/personnel/bonuses", payload);
      const days = parseYevmiyeDays(yevmiyeDays) || 0;
      closeYevmiyeDays();
      const line = yevmiyeDaysLine({ ...yevmiyeEmp, daily_wage: wage }, days, wage);
      setMessage(payAccount
        ? `${yevmiyeEmp.full_name} için ${line} ödendi.`
        : `${yevmiyeEmp.full_name} için ${line} personel alacağına yazıldı.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Yevmiye kaydedilemedi."));
    } finally {
      setBusy(false);
    }
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
    bonus: (emp: Employee) => (isDailyWage(emp) ? openYevmiyeDays(emp) : openExtraPay(emp, "bonus")),
    otpay: (emp: Employee) => openExtraPay(emp, "overtime"),
  };

  const toggleCardLocation = async (emp: Employee, enabled: boolean) => {
    const eid = idOf(emp);
    const raw = emp.location_tracking || cards[eid]?.employee?.location_tracking || {};
    setLocBusy(eid);
    try {
      await put(client, `/personnel/employees/${eid}`, {
        location_tracking: locationTrackingTogglePayload(raw, enabled),
      });
      setMessage(`${emp.full_name}: ${locationControllerLabel(enabled)}.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Konum ayarı kaydedilemedi."));
    } finally {
      setLocBusy(null);
    }
  };

  const openLocSettings = (emp: Employee) => {
    const raw = emp.location_tracking || cards[idOf(emp)]?.employee?.location_tracking || {};
    setLocEmp(emp);
    setLocCompany(initLocMode(raw));
    setLocField(initLocMode(raw.field || raw));
  };

  const saveLocSettings = async () => {
    if (!locEmp) return;
    setBusy(true);
    try {
      await put(client, `/personnel/employees/${idOf(locEmp)}`, {
        location_tracking: locationTrackingPayload(locCompany, locField),
      });
      setMessage(`${locEmp.full_name} konum ayarları kaydedildi.`);
      setLocEmp(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Konum ayarları kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const saveTaskAssign = async () => {
    if (!taskEmp) return;
    if (taskKind === "office") {
      const invalid = validateOfficeTaskAssign(taskParkId);
      if (invalid) { setError(invalid); return; }
      const park = findWorkPark(workParks, taskParkId);
      setBusy(true);
      try {
        await post(client, `/personnel/employees/${idOf(taskEmp)}/office-tasks`, officeTaskPayload(park, taskTitle));
        setTaskEmp(null);
        setTaskDays("");
        setTaskParkId("");
        setMessage(`${taskEmp.full_name} · ${park?.name || "iç görev"}`);
        await load();
      } catch (err) {
        setError(apiErrorMessage(err, "Görev ataması kaydedilemedi."));
      } finally {
        setBusy(false);
      }
      return;
    }
    const invalid = validateTaskAssign(taskProjectId, taskId, taskTitle);
    if (invalid) { setError(invalid); return; }
    const project = projects.find((p) => idOf(p) === taskProjectId);
    if (!project) { setError("Proje bulunamadı."); return; }
    const daysInvalid = validateTaskDays(taskDays);
    if (daysInvalid) { setError(daysInvalid); return; }
    const days = parseTaskDays(taskDays);
    const due = days ? dueDateFromDays(todayIso(), days) : undefined;
    const next = assignEmployeeToTasks(project.tasks, taskEmp, {
      taskId, title: taskTitle, durationDays: days || undefined, dueDate: due, kind: "field",
    });
    if (next.error) { setError(next.error); return; }
    setBusy(true);
    try {
      await put(client, `/projects/${taskProjectId}`, { tasks: next.tasks });
      const assigned = taskId
        ? next.tasks.find((t) => t.id === taskId)
        : next.tasks[next.tasks.length - 1];
      const work = (assigned?.title || taskTitle || "iş").trim();
      try {
        await post(client, `/personnel/employees/${idOf(taskEmp)}/active-duty`, {
          kind: "field",
          task_id: assigned?.id,
          title: work,
          project_id: taskProjectId,
          project_name: project.name || "",
          project_number: project.project_number || "",
        });
      } catch { /* görev kaydı yeterli */ }
      setTaskEmp(null);
      setTaskDays("");
      setMessage(`${taskEmp.full_name} · ${work} · ${project.name || "proje"}`);
      await load();
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

  const payUnpaidMove = (row: EmployeePayMove) => {
    const emp = movesEmp;
    if (!emp) return;
    setMovesEmp(null);
    setMoves([]);
    if (row.kind === "payroll") {
      const item = payrolls.find((p) => idOf(p) === row.id);
      if (item) setPayItem(item);
      return;
    }
    if (row.type === "yevmiye" || row.title === "Yevmiye") {
      openYevmiyeDays(emp, {
        id: row.id,
        type: row.type,
        amount: row.amount,
        period: month,
        note: row.note,
        status: row.status,
        worked_days: row.worked_days,
        daily_wage: row.daily_wage,
      });
      return;
    }
    setExtraKind(row.type === "overtime" ? "overtime" : "bonus");
    setExtraAmount(row.amount ? String(row.amount) : "");
    setExtraNote(row.note || "");
    setExtraEmp(emp);
  };

  const openMoves = async (emp: Employee) => {
    setMovesEmp(emp);
    setMoves([]);
    setMovesPeriod("30d");
    setMovesMonth(month || new Date().toISOString().slice(0, 7));
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

  const generatePayroll = async () => {
    setBusy(true);
    try {
      const r = await post<{ message?: string }>(client, "/personnel/generate-payroll", {
        company_id: companyId,
        period: new Date().toISOString().slice(0, 7),
      });
      setMessage(r?.message || "Aylık bordro hesaplandı.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Bordro hesaplanamadı."));
    } finally {
      setBusy(false);
    }
  };

  const decideRequest = async (it: PendingRequest, approved: boolean | "ack" | "deduct") => {
    const spec = pendingRequestDecision(it, approved);
    if (!spec) {
      setTab("attendance");
      setMessage("İtirazı puantaj kaydından inceleyin.");
      return;
    }
    setBusy(true);
    try {
      await post(client, spec.path, spec.body);
      setMessage(pendingRequestDecisionMessage(it, approved));
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem başarısız."));
    } finally {
      setBusy(false);
    }
  };

  const uploadEmployeePhoto = async (fromCamera: boolean) => {
    const emp = photoEmp;
    const eid = emp ? idOf(emp) : "";
    if (!eid) return;
    setBusy(true);
    try {
      let assets: { uri?: string; fileName?: string | null; mimeType?: string | null; file?: Blob }[] = [];
      if (!fromCamera && Platform.OS === "web") {
        assets = await pickBrowserImages(undefined, false);
      } else {
        const perm = fromCamera
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== "granted") {
          setError(fromCamera ? "Kamera izni verilmedi." : "Galeri izni verilmedi.");
          return;
        }
        const res = fromCamera
          ? await ImagePicker.launchCameraAsync({ quality: 0.8, exif: false })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, exif: false, mediaTypes: ["images"] });
        if (res.canceled || !res.assets?.length) return;
        assets = res.assets;
      }
      const asset = assets[0];
      if (!asset) return;
      const form = new FormData();
      const compact = await compressPickerAsset(asset);
      const { blob, name } = await resolveUploadBlob(compact);
      appendUploadBlob(form, blob, name);
      const { path, query } = imageUploadRequest("employee", eid, companyId);
      const res = await upload(client, path, form, query);
      if (!uploadedImageUrl(res)) {
        setError("Fotoğraf yüklendi ama adres dönmedi.");
        return;
      }
      setPhotoEmp(null);
      setMessage("Fotoğraf yüklendi.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Fotoğraf yüklenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const saveCompanyBonus = async () => {
    const empId = bonusForm.employee_id || idOf(employees[0]);
    if (!empId) { setError("Çalışan seçin."); return; }
    const invalid = validateAdvance(bonusForm.amount);
    if (invalid) { setError(invalid === "Avans tutarı girin." ? "Tutar girin." : invalid); return; }
    setBusy(true);
    try {
      await post(client, "/personnel/bonuses", companyBonusPayload(empId, bonusForm.type, bonusForm.amount, bonusForm.period, payAccount, bonusForm.note));
      setBonusForm({ ...bonusForm, amount: "", note: "" });
      setMessage("Ödeme kaydedildi.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const deleteBonus = async (id: string) => {
    setBusy(true);
    try {
      await del(client, `/personnel/bonuses/${id}`);
      setMessage("Kayıt silindi.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Silinemedi."));
    } finally {
      setBusy(false);
    }
  };

  const saveExpense = async () => {
    if (!expenseEmp) return;
    const invalid = validateAdvance(expenseAmount);
    if (invalid) { setError(invalid === "Avans tutarı girin." ? "Tutar girin." : invalid); return; }
    setBusy(true);
    try {
      await post(client, "/expenses", personnelExpensePayload(idOf(expenseEmp), "expense", expenseAmount, payAccount, expenseNote, companyId, todayIso()));
      setExpenseEmp(null);
      setExpenseAmount("");
      setExpenseNote("");
      setMessage(`${expenseEmp.full_name} için masraf kaydedildi.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Masraf kaydedilemedi."));
    } finally {
      setBusy(false);
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

      {canEdit ? (
        <Row style={{ flexWrap: "wrap", gap: 8 }}>
          <PrimaryButton title="Aylık bordro hesapla" onPress={generatePayroll} loading={busy} color={colors.indigo} testID="generate-payroll-btn" />
          <PrimaryButton
            title="Yeni personel ekle"
            onPress={() => router.push("/personnel/new")}
            color={colors.primary}
            testID="personnel-add-btn"
          />
        </Row>
      ) : null}

      {pendingReqs.length ? (
        <Card testID="personnel-requests-inbox">
          <Text style={{ fontWeight: "800", color: colors.text }}>Personel talepleri ({pendingReqs.length})</Text>
          {pendingReqs.slice(0, 8).map((it) => (
            <View key={`${it.kind}-${it.id}`} style={{ paddingTop: 8, gap: 4, borderTopWidth: 1, borderTopColor: colors.border }} testID={`personnel-request-${it.kind}-${it.id}`}>
              <Muted>{requestKindLabel(it.kind)} · {it.title || "Talep"}</Muted>
              {it.detail ? <Muted>{it.detail}</Muted> : null}
              {canEdit ? (
                <Row style={{ flexWrap: "wrap" }}>
                  {requestDecisionActions(it.kind).map((btn) => (
                    <PrimaryButton
                      key={btn.key}
                      title={btn.title}
                      color={btn.color === "danger" ? colors.danger : btn.color === "warning" ? colors.warning : btn.color === "secondary" ? colors.secondary : colors.primary}
                      testID={`${btn.key}-req-${it.id}`}
                      onPress={() => decideRequest(it, btn.decision)}
                    />
                  ))}
                  {it.kind === "dispute" ? (
                    <PrimaryButton title="Puantajda aç" color={colors.secondary} testID={`view-req-${it.id}`} onPress={() => setTab("attendance")} />
                  ) : null}
                </Row>
              ) : it.kind === "dispute" ? (
                <PrimaryButton title="Puantajda aç" color={colors.secondary} testID={`view-req-${it.id}`} onPress={() => setTab("attendance")} />
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      <TabStrip
        testID="personnel-tab"
        value={tab}
        onChange={setTab}
        items={[
          { key: "payroll", label: "Bordro", icon: "people", count: employees.length },
          { key: "attendance", label: "Puantaj", icon: "time" },
          { key: "leaves", label: "İzinler", icon: "calendar", count: pendingLeaves || undefined },
          { key: "extras", label: "Prim", icon: "gift", count: bonuses.length || undefined },
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
            const daysPresent = (attendance?.summary || []).find((s) => s.employee_id === eid)?.days_present || 0;
            const fromPays = yevmiyeAccrual({ payrolls: payrolls.filter((p) => p.employee_id === eid), employeeId: eid });
            const comp = employeeCompRows(emp, bal, {
              daysPresent,
              yevmiyeDays: Math.max(Number(emp.yevmiye_days) || 0, fromPays.days),
              yevmiyeAmount: Math.max(Number(emp.yevmiye_due) || 0, fromPays.amount),
            });
            return (
              <Card key={eid} testID={`employee-card-${emp.tc_kimlik || eid}`} style={employeeCardChrome(emp)}>
                <View
                  testID={`emp-card-pay-${employeeCardPayKind(emp)}-${eid}`}
                  style={{ height: 6, marginHorizontal: -12, marginTop: -12, marginBottom: 8, backgroundColor: employeeCardChrome(emp).borderColor, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
                />
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <EmployeeAvatar
                    name={emp.full_name}
                    photoUrl={emp.photo_url}
                    size={56}
                    testID={`emp-card-photo-${eid}`}
                    onLongPress={canEdit ? () => setPhotoEmp(emp) : undefined}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                      <Text style={{ fontWeight: "800", color: colors.text }}>{emp.full_name}</Text>
                      <Text
                        testID={`emp-status-${eid}`}
                        style={{ fontSize: 10, fontWeight: "800", color: emp.status === "terminated" ? "#BE123C" : colors.primaryHover, backgroundColor: emp.status === "terminated" ? colors.rose50 : colors.emerald50, overflow: "hidden", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}
                      >
                        {employeeStatusLabel(emp.status)}
                      </Text>
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
                    <Muted testID={`emp-leave-${eid}`}>
                      Kalan izin: {cards[eid]?.leave_balance?.remaining ?? remainingLeaveDays(emp)} / {cards[eid]?.leave_balance?.annual ?? emp.annual_leave_days ?? 14} gün
                      {cards[eid]?.performance?.overall != null ? ` · performans %${cards[eid]?.performance?.overall}` : ""}
                    </Muted>
                  </View>
                </View>
                {(() => {
                  const locOn = locationTrackingEnabled(emp.location_tracking || cards[eid]?.employee?.location_tracking);
                  const today = (attendance?.summary || []).find((s) => s.employee_id === eid)?.today || null;
                  const punch = todayAttendanceParts(today);
                  return (
                    <View
                      testID={`emp-card-loc-${eid}`}
                      style={{
                        padding: 4,
                        borderRadius: 8,
                        backgroundColor: locOn ? "#ECFDF5" : colors.slate50,
                        borderWidth: 1,
                        borderColor: locOn ? "#A7F3D0" : colors.border,
                      }}
                    >
                      <Row style={{ alignItems: "stretch", gap: 4 }}>
                        <Pressable
                          testID={`emp-card-loc-toggle-${eid}`}
                          disabled={!canEdit || locBusy === eid}
                          onPress={() => toggleCardLocation(emp, !locOn)}
                          accessibilityLabel={locationControllerLabel(locOn)}
                          style={{ flex: 1, minWidth: 0, gap: 2, padding: 4, borderRadius: 8, backgroundColor: locOn ? "#D1FAE5" : "#fff" }}
                        >
                          <Text style={{ fontSize: 9, fontWeight: "800", color: colors.muted, letterSpacing: 0.3 }}>KONUM</Text>
                          <Row style={{ alignItems: "center", gap: 3 }}>
                            <Ionicons name={locOn ? "location" : "location-outline"} size={12} color={locOn ? "#047857" : colors.muted} />
                            <Text numberOfLines={1} style={{ fontWeight: "800", fontSize: 11, color: locOn ? "#047857" : colors.muted, flex: 1 }}>
                              {locBusy === eid ? "…" : locationCellCaption(locOn)}
                            </Text>
                          </Row>
                          <LocationSignalDot
                            compact
                            signal={{ ok: emp.location_last_ok ?? cards[eid]?.employee?.location_last_ok ?? null, at: emp.location_last_at ?? cards[eid]?.employee?.location_last_at ?? null }}
                            testID={`emp-card-loc-signal-${eid}`}
                          />
                        </Pressable>
                        <View testID={`emp-card-today-${eid}`} style={{ flex: 2, minWidth: 0, flexDirection: "row", gap: 4 }}>
                          <View style={{ flex: 1, minWidth: 0, gap: 2, padding: 4, borderRadius: 8, backgroundColor: "#fff" }}>
                            <Text style={{ fontSize: 9, fontWeight: "800", color: colors.muted, letterSpacing: 0.3 }}>GİRİŞ</Text>
                            <Text style={{ fontWeight: "800", fontSize: 13, color: colors.text }}>{punch.checkIn}</Text>
                            {punch.late ? <Text style={{ fontSize: 9, color: colors.warning }}>{punch.late} dk geç</Text> : null}
                          </View>
                          <View style={{ flex: 1, minWidth: 0, gap: 2, padding: 4, borderRadius: 8, backgroundColor: "#fff" }}>
                            <Text style={{ fontSize: 9, fontWeight: "800", color: colors.muted, letterSpacing: 0.3 }}>ÇIKIŞ</Text>
                            <Text style={{ fontWeight: "800", fontSize: 13, color: colors.text }}>{punch.checkOut}</Text>
                          </View>
                        </View>
                      </Row>
                    </View>
                  );
                })()}
                {emp.workplace?.kind === "task" || openEmployeeTasks(cards[eid]).length ? (
                  <View
                    testID={`emp-card-workplace-${eid}`}
                    style={{ padding: 10, borderRadius: 12, backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#C7D2FE", gap: 2 }}
                  >
                    <Pressable
                      testID={`emp-card-workplace-toggle-${eid}`}
                      onPress={() => setWorkplaceOpen((cur) => ({ ...cur, [eid]: !cur[eid] }))}
                      accessibilityLabel={workplaceDetailsToggleLabel(!!workplaceOpen[eid])}
                      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                    >
                      <Text style={{ fontWeight: "800", color: "#3730A3", fontSize: 12, flex: 1 }}>Görev / çalıştığı yer</Text>
                      <View
                        testID={`emp-card-workplace-toggle-icon-${eid}`}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: "#C7D2FE",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name={workplaceDetailsToggleIcon(!!workplaceOpen[eid])}
                          size={16}
                          color="#3730A3"
                        />
                      </View>
                    </Pressable>
                    {workplaceOpen[eid] ? (
                      <>
                        {emp.workplace?.kind === "task" ? (
                          <>
                            <Text style={{ fontWeight: "700", color: "#312E81", fontSize: 13 }}>Dış görev · {workplaceShort(emp.workplace)}</Text>
                            <Muted>{workplaceHint(emp.workplace, true)}</Muted>
                          </>
                        ) : null}
                        {openEmployeeTasks(cards[eid]).slice(0, 6).map((t) => (
                          <Muted key={t.id || t.title} testID={`emp-card-task-${eid}-${t.id || t.title}`}>
                            {t.title || "Görev"}
                            {t.project_number || t.project_name ? ` · ${t.project_number || t.project_name}` : ""}
                            {t.kind === "office" ? ` · iç görev${t.park_name ? ` · ${t.park_name}` : ""}` : t.duration_days ? ` · ${t.duration_days} gün` : t.due_date ? ` · ${t.due_date}` : ""}
                          </Muted>
                        ))}
                        {pendingDutyPhotoCount(cards[eid]?.tasks as AssignedDuty[]) ? (
                          <Muted testID={`emp-card-photo-pending-${eid}`}>
                            {pendingDutyPhotoCount(cards[eid]?.tasks as AssignedDuty[])} iş fotoğrafı müşteri onayı bekliyor
                          </Muted>
                        ) : null}
                      </>
                    ) : (
                      <Muted testID={`emp-card-workplace-summary-${eid}`}>
                        {[
                          workplaceDetailsSummary({
                            hasFieldDuty: emp.workplace?.kind === "task",
                            fieldLabel: emp.workplace?.kind === "task" ? workplaceShort(emp.workplace) : "",
                            taskCount: openEmployeeTasks(cards[eid]).length,
                          }),
                          pendingDutyPhotoCount(cards[eid]?.tasks as AssignedDuty[])
                            ? `${pendingDutyPhotoCount(cards[eid]?.tasks as AssignedDuty[])} foto onay bekliyor`
                            : "",
                        ].filter(Boolean).join(" · ")}
                      </Muted>
                    )}
                  </View>
                ) : null}
                {(() => {
                  const empReqs = requestsForEmployee(pendingReqs, eid);
                  if (!empReqs.length) return null;
                  const reqOpen = !!requestsOpen[eid];
                  return (
                    <View testID={`emp-card-requests-${eid}`} style={{ padding: 6, borderRadius: 8, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", gap: 4 }}>
                      <Pressable
                        testID={`emp-card-requests-toggle-${eid}`}
                        onPress={() => setRequestsOpen((cur) => ({ ...cur, [eid]: !cur[eid] }))}
                        accessibilityLabel={requestsDetailsToggleLabel(reqOpen)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                      >
                        <Text style={{ fontWeight: "800", color: "#92400E", fontSize: 12 }}>Talepler ({empReqs.length})</Text>
                        <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, color: colors.muted }}>{requestsDetailsSummary(empReqs)}</Text>
                        <View
                          testID={`emp-card-requests-toggle-icon-${eid}`}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor: "#FDE68A",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name={requestsDetailsToggleIcon(reqOpen)} size={16} color="#92400E" />
                        </View>
                      </Pressable>
                      {reqOpen
                        ? empReqs.slice(0, 3).map((it) => (
                            <View key={`${it.kind}-${it.id}`} style={{ gap: 4 }}>
                              <Muted>{requestKindLabel(it.kind)} · {it.title || "Talep"}</Muted>
                              {canEdit ? (
                                <Row style={{ flexWrap: "wrap" }}>
                                  {requestDecisionActions(it.kind).map((btn) => (
                                    <PrimaryButton
                                      key={btn.key}
                                      title={btn.title}
                                      color={btn.color === "danger" ? colors.danger : btn.color === "warning" ? colors.warning : btn.color === "secondary" ? colors.secondary : colors.primary}
                                      testID={`card-${btn.key}-${it.kind}-${it.id}`}
                                      onPress={() => decideRequest(it, btn.decision)}
                                    />
                                  ))}
                                  {it.kind === "dispute" ? (
                                    <PrimaryButton title="Puantajda aç" color={colors.secondary} testID={`card-view-dispute-${it.id}`} onPress={() => setTab("attendance")} />
                                  ) : null}
                                </Row>
                              ) : null}
                            </View>
                          ))
                        : null}
                    </View>
                  );
                })()}
                <Row testID={`emp-comp-${eid}`} style={{ alignItems: "stretch", gap: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
                  {employeeCompGroups(comp).map((group) => (
                    <View key={group.key} testID={`emp-comp-group-${group.key}-${eid}`} style={{ flex: 1, minWidth: 0, gap: 2, padding: 4, borderRadius: 8, backgroundColor: colors.slate50 }}>
                      <Text style={{ fontSize: 9, fontWeight: "800", color: colors.muted, letterSpacing: 0.3 }}>{group.title}</Text>
                      {group.rows.map((row) => (
                        <View key={row.key} style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 4 }}>
                          <Text
                            numberOfLines={1}
                            testID={row.key === "bonus" && row.days != null ? `emp-comp-bonus-days-${eid}` : undefined}
                            style={{ fontSize: 10, color: colors.muted, flex: 1 }}
                          >
                            {employeeCompRowCaption(row, isDailyWage(emp))}
                          </Text>
                          <Text
                            testID={row.key === "total" ? `emp-remaining-${eid}` : `emp-comp-${row.key}-${eid}`}
                            style={{ fontWeight: "800", fontSize: 11, color: row.key === "total" ? colors.primary : colors.text }}
                          >
                            {fmtMoney(row.value)}
                          </Text>
                        </View>
                      ))}
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
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }} testID={`emp-card-actions-${eid}`}>
                  <PayChip
                    title="Hareketler"
                    icon={employeeCardActionIcon("moves")}
                    color={colors.secondary}
                    bg="#F1F5F9"
                    testID={`emp-card-moves-btn-${eid}`}
                    onPress={() => openMoves(emp)}
                  />
                  {canEdit ? EMPLOYEE_CARD_PAY_ACTIONS.map((action) => (
                    <EmpActionChip key={action.key} action={action} emp={emp} eid={eid} handlers={empActionHandlers} />
                  )) : null}
                  {canEdit ? (
                    <>
                      {EMPLOYEE_CARD_WORK_ACTIONS.map((action) => (
                        <EmpActionChip key={action.key} action={action} emp={emp} eid={eid} handlers={empActionHandlers} />
                      ))}
                      <PayChip
                        title="Atanan görevler"
                        icon={employeeCardActionIcon("duties")}
                        color="#4338CA"
                        bg="#EEF2FF"
                        testID={`emp-card-duties-btn-${eid}`}
                        onPress={() => setDutiesEmp(emp)}
                      />
                      <PayChip
                        title={EMPLOYEE_LOCATION_SETTINGS_TITLE}
                        icon={employeeCardActionIcon("location")}
                        color="#047857"
                        bg="#ECFDF5"
                        testID={`emp-card-location-btn-${eid}`}
                        onPress={() => openLocSettings(emp)}
                      />
                      <PayChip
                        title="Masraf"
                        icon={employeeCardActionIcon("expense")}
                        color="#9A3412"
                        bg="#FFF7ED"
                        testID={`emp-card-expense-btn-${eid}`}
                        onPress={() => { setExpenseEmp(emp); setExpenseAmount(""); setExpenseNote(""); }}
                      />
                    </>
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
                subtitle={[`${p.period} dönemi`, p.gross_salary ? `brüt ${fmtMoney(p.gross_salary)}` : "", extra, payrollStatusTr(p.status, p.paid_date)].filter(Boolean).join(" · ")}
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
          <Field label="Aylık dönem" testID="attendance-month-input" value={month} onChangeText={setMonth} placeholder="2026-09" />
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
              {s.workplace?.kind === "task" ? (
                <Muted testID={`att-workplace-${s.employee_id}`}>Dış görev · {workplaceShort(s.workplace)}</Muted>
              ) : null}
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
              {(() => {
                const recs = attendanceRecordsForEmployee(attendance?.records, s.employee_id, s.employee_name);
                if (!recs.length) return null;
                const open = !!attRecOpen[s.employee_id || ""];
                return (
                  <View testID={`att-rec-group-${s.employee_id}`}>
                    <Pressable
                      testID={`att-recs-toggle-${s.employee_id}`}
                      onPress={() => setAttRecOpen((m) => ({ ...m, [s.employee_id || ""]: !m[s.employee_id || ""] }))}
                      accessibilityLabel={attendanceGroupToggleLabel(open, recs.length)}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}
                    >
                      <Text style={{ fontWeight: "800", color: colors.indigo, fontSize: 12 }}>{attendanceGroupToggleLabel(open, recs.length)}</Text>
                      <Ionicons name={workplaceDetailsToggleIcon(open)} size={16} color={colors.indigo} />
                    </Pressable>
                    {open ? recs.map((r) => (
                      <AttendanceRecCard key={idOf(r)} r={r} canEdit={canEdit} onDecide={decideRequest} hideName onCorrectOut={(rec, out) => attAct(rec.employee_id || "", { date: rec.date, check_out: out })} />
                    )) : null}
                  </View>
                );
              })()}
            </Card>
          ))}
          {groupAttendanceRecords(attendance?.records)
            .filter((g) => !(attendance?.summary || []).some((s) => String(s.employee_id) === g.employee_id))
            .map((g) => {
              const open = !!attRecOpen[g.employee_id];
              return (
                <Card key={g.employee_id} testID={`att-rec-group-${g.employee_id}`}>
                  <Text style={{ fontWeight: "800", color: colors.text }}>{g.employee_name}</Text>
                  <Pressable
                    testID={`att-recs-toggle-${g.employee_id}`}
                    onPress={() => setAttRecOpen((m) => ({ ...m, [g.employee_id]: !m[g.employee_id] }))}
                    accessibilityLabel={attendanceGroupToggleLabel(open, g.records.length)}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}
                  >
                    <Text style={{ fontWeight: "800", color: colors.indigo, fontSize: 12 }}>{attendanceGroupToggleLabel(open, g.records.length)}</Text>
                    <Ionicons name={workplaceDetailsToggleIcon(open)} size={16} color={colors.indigo} />
                  </Pressable>
                  {open ? g.records.map((r) => (
                    <AttendanceRecCard key={idOf(r)} r={r} canEdit={canEdit} onDecide={decideRequest} hideName onCorrectOut={(rec, out) => attAct(rec.employee_id || "", { date: rec.date, check_out: out })} />
                  )) : null}
                </Card>
              );
            })}
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

      {tab === "extras" ? (
        <>
          <Card testID="bonus-panel">
            <Text style={{ fontWeight: "800", color: colors.text }}>Prim / ikinci maaş</Text>
            <Muted>Gayri resmi kayıt. Dönem toplamı: {fmtMoney(bonusesPeriodTotal(bonuses, bonusForm.period))}</Muted>
            <GroupedSelect
              label="Çalışan"
              testID="bonus-employee-select"
              value={bonusForm.employee_id}
              onChange={(v) => setBonusForm({ ...bonusForm, employee_id: v })}
              groups={employeeSelectGroups(employees)}
              emptyLabel="Çalışan seçin"
            />
            <Row style={{ flexWrap: "wrap", gap: 6 }}>
              {COMPANY_BONUS_TYPES.map((t) => (
                <Pressable
                  key={t.key}
                  testID={`bonus-type-${t.key}`}
                  onPress={() => setBonusForm({ ...bonusForm, type: t.key })}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: bonusForm.type === t.key ? "#F59E0B" : colors.border,
                    backgroundColor: bonusForm.type === t.key ? "#F59E0B" : colors.surface,
                  }}
                >
                  <Text style={{ fontWeight: "700", fontSize: 11, color: bonusForm.type === t.key ? "#fff" : colors.muted }}>{t.label}</Text>
                </Pressable>
              ))}
            </Row>
            <Field label="Dönem" testID="bonus-period" value={bonusForm.period} onChangeText={(v) => setBonusForm({ ...bonusForm, period: v })} placeholder="YYYY-AA" />
            <Field label="Tutar (₺)" testID="bonus-amount-input" value={bonusForm.amount} onChangeText={(v) => setBonusForm({ ...bonusForm, amount: v })} keyboardType="decimal-pad" />
            <GroupedSelect
              label="Ödeme kaynağı"
              testID="bonus-account-select"
              value={payAccount}
              onChange={setPayAccount}
              groups={payGroups}
              emptyLabel="Sadece kaydet (ödeme yok)"
            />
            <Field label="Not" testID="bonus-note" value={bonusForm.note} onChangeText={(v) => setBonusForm({ ...bonusForm, note: v })} />
            <PrimaryButton title="Kaydet" testID="save-bonus-btn" color="#D97706" loading={busy} onPress={saveCompanyBonus} />
          </Card>
          {!bonuses.length ? <Empty icon="gift-outline" title="Prim kaydı yok" /> : bonuses.map((b) => (
            <ListRow
              key={idOf(b)}
              testID={`bonus-row-${idOf(b)}`}
              title={b.employee_name || "Personel"}
              subtitle={[b.period, b.type_label || b.type, b.account_name || "Ödenmedi"].filter(Boolean).join(" · ")}
              right={fmtMoney(b.amount)}
              rightSub={canEdit ? "Sil" : undefined}
              rightSubColor={colors.danger}
              onPress={canEdit ? () => deleteBonus(idOf(b)) : undefined}
            />
          ))}
        </>
      ) : null}

      <B2BSheet
        visible={!!photoEmp}
        title="Personel fotoğrafı"
        subtitle={photoEmp?.full_name}
        onClose={() => setPhotoEmp(null)}
        testID="emp-photo-sheet"
      >
        <Muted>Kamerayla çekin veya galeriden seçin. Kartta hemen görünür.</Muted>
        <PrimaryButton
          title={busy ? "Yükleniyor…" : "Kamerayla çek"}
          onPress={() => uploadEmployeePhoto(true)}
          loading={busy}
          color={colors.indigo}
          testID="emp-photo-camera"
        />
        <PrimaryButton
          title={busy ? "Yükleniyor…" : "Galeriden seç"}
          onPress={() => uploadEmployeePhoto(false)}
          disabled={busy}
          color={colors.primary}
          testID="emp-photo-gallery"
        />
      </B2BSheet>

      <B2BSheet
        visible={!!movesEmp}
        title="Ödeme hareketleri"
        subtitle={movesEmp?.full_name}
        onClose={() => { setMovesEmp(null); setMoves([]); }}
        testID="emp-pay-moves-sheet"
        header={(
          <View testID="emp-pay-moves-period" style={{ gap: 8 }}>
            <Row style={{ flexWrap: "wrap", gap: 8 }}>
              {(["30d", "month", "all"] as PayMovesPeriod[]).map((key) => (
                <Pressable
                  key={key}
                  testID={`emp-pay-moves-period-${key}`}
                  onPress={() => setMovesPeriod(key)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: movesPeriod === key ? colors.indigo50 : colors.slate50,
                    borderWidth: 1,
                    borderColor: movesPeriod === key ? colors.indigo : colors.border,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "800", color: movesPeriod === key ? colors.indigo : colors.text }}>
                    {payMovesPeriodLabel(key)}
                  </Text>
                </Pressable>
              ))}
            </Row>
            {movesPeriod === "month" ? (
              <Field
                dense
                label="Dönem"
                testID="emp-pay-moves-month"
                value={movesMonth}
                onChangeText={setMovesMonth}
                placeholder="YYYY-AA"
              />
            ) : null}
            <Muted testID="emp-pay-moves-count">
              {payMovesPeriodHint(filterPayMoves(moves, movesPeriod, new Date(), movesMonth).length, moves.length, movesPeriod)}
            </Muted>
          </View>
        )}
      >
        {movesBusy ? <Muted>Yükleniyor…</Muted> : null}
        {!movesBusy && !filterPayMoves(moves, movesPeriod, new Date(), movesMonth).length ? <Muted>Bu dönemde ödeme hareketi yok.</Muted> : null}
        {filterPayMoves(moves, movesPeriod, new Date(), movesMonth).map((row) => (
          <View
            key={row.id}
            testID={`emp-pay-move-${row.id}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}
          >
            <Pressable
              style={{ flex: 1, minWidth: 0 }}
              onPress={row.editable && movesEmp ? () => {
                const emp = movesEmp;
                setMovesEmp(null);
                setMoves([]);
                openYevmiyeDays(emp, {
                  id: row.id,
                  type: row.type,
                  amount: row.amount,
                  period: month,
                  note: row.note,
                  status: row.status,
                  worked_days: row.worked_days,
                  daily_wage: row.daily_wage,
                });
              } : undefined}
            >
              <Text style={{ fontWeight: "800", color: colors.text }}>{row.title}</Text>
              <Muted>{row.editable ? `${row.subtitle} · düzenle` : row.subtitle}</Muted>
              <Text style={{ fontWeight: "800", color: row.kind === "bonus" && row.title === "Avans" ? colors.warning : colors.text }}>
                {fmtMoney(row.amount)}
              </Text>
            </Pressable>
            {row.deletable && canEdit ? (
              <Pressable
                testID={`emp-pay-move-del-${row.id}`}
                onPress={() => deletePayMove(row)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: colors.rose50,
                  borderWidth: 1,
                  borderColor: "#FECDD3",
                  flexShrink: 0,
                }}
              >
                <Text style={{ fontWeight: "800", fontSize: 13, color: "#BE123C" }}>Sil</Text>
              </Pressable>
            ) : null}
            {row.payable && canEdit ? (
              <Pressable
                testID={`emp-pay-move-pay-${row.id}`}
                onPress={() => payUnpaidMove(row)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: colors.emerald50,
                  borderWidth: 1,
                  borderColor: "#6EE7B7",
                  flexShrink: 0,
                }}
              >
                <Text style={{ fontWeight: "800", fontSize: 13, color: colors.primaryHover }}>Öde</Text>
              </Pressable>
            ) : null}
          </View>
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
        visible={!!expenseEmp}
        title="Masraf ekle"
        subtitle={expenseEmp ? `${expenseEmp.full_name} · personel masrafı` : undefined}
        onClose={() => setExpenseEmp(null)}
        testID="emp-expense-sheet"
      >
        <Field label="Tutar (₺)" testID="emp-expense-amount" value={expenseAmount} onChangeText={setExpenseAmount} keyboardType="numeric" />
        <Field label="Açıklama" testID="emp-expense-note" value={expenseNote} onChangeText={setExpenseNote} placeholder="Personel masrafı" />
        <GroupedSelect
          label="Kasa / Banka / Ortak"
          testID="emp-expense-account"
          value={payAccount}
          onChange={setPayAccount}
          groups={payGroups}
          emptyLabel="Şimdi ödenmeyecek (borç olarak kaydet)"
        />
        <PrimaryButton title={payAccount ? "Kaydet & Öde" : "Kaydet"} testID="emp-expense-submit" color="#9A3412" loading={busy} onPress={saveExpense} />
      </B2BSheet>

      <B2BSheet
        visible={!!locEmp}
        title={EMPLOYEE_LOCATION_SETTINGS_TITLE}
        subtitle={locEmp ? locEmp.full_name : undefined}
        onClose={() => setLocEmp(null)}
        testID="emp-location-sheet"
      >
        <LocModeBlock
          title="İş yeri / firma"
          hint="Girişte firma konumu kontrolü"
          prefix="company"
          mode={locCompany}
          onChange={(key, value) => setLocCompany((prev) => patchLocMode(prev, key, value))}
        />
        <LocModeBlock
          title="Dış görev"
          hint="Açık proje görevinde görev yeri kontrolü"
          prefix="field"
          mode={locField}
          onChange={(key, value) => setLocField((prev) => patchLocMode(prev, key, value))}
        />
        <Muted testID="emp-location-hint">Giriş görev/iş yeri yakınından; konumla otomatik de yazılır. Çıkış butonu her zaman açık, konumla da çıkış yazılabilir. Yönetici çıkış saatini düzeltirse personel onayı gerekir. Dış görevde konum dışına çıkınca tolerans kadar saat sonra yöneticiye haber gider — Haberim var / Kesinti olmasın / Kesinti olsun / Reddet.</Muted>
        <PrimaryButton title="Kaydet" testID="emp-location-save" color="#047857" loading={busy} onPress={saveLocSettings} />
      </B2BSheet>

      <B2BSheet
        visible={!!dutiesEmp}
        title="Atanan görevler"
        subtitle={dutiesEmp ? dutiesEmp.full_name : undefined}
        onClose={() => setDutiesEmp(null)}
        testID="emp-duties-sheet"
      >
        {dutiesEmp ? (() => {
          const board = employeeDutyBoard(dutiesEmp, cards[idOf(dutiesEmp)]);
          const dutyRows = (cards[idOf(dutiesEmp)]?.tasks || []) as AssignedDuty[];
          const currentDuty = dutyFromCurrent({
            tasks: dutyRows,
            current: board.current,
            workplace: dutiesEmp.workplace || cards[idOf(dutiesEmp)]?.workplace,
          });
          const pendingPhotos = pendingDutyPhotoCount(dutyRows);
          const patchDuty = (next?: AssignedDuty) => {
            if (!next?.id) return;
            const eid = idOf(dutiesEmp);
            setCards((prev) => {
              const card = prev[eid] || {};
              return {
                ...prev,
                [eid]: {
                  ...card,
                  tasks: (card.tasks || []).map((t) => (t.id === next.id ? { ...t, ...next } : t)),
                },
              };
            });
          };
          return (
            <View testID={`emp-duties-board-${idOf(dutiesEmp)}`} style={{ gap: 10 }}>
              <View
                testID="emp-duties-current"
                style={{
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: board.current ? "#EEF2FF" : colors.slate50,
                  borderWidth: 1,
                  borderColor: board.current ? "#C7D2FE" : colors.border,
                  gap: 4,
                }}
              >
                <Text style={{ fontWeight: "800", color: "#3730A3", fontSize: 12 }}>Şu anda yaptığı iş</Text>
                {currentDuty ? (
                  <>
                    {board.currentHint ? <Muted testID="emp-duties-current-hint">{board.currentHint}</Muted> : null}
                    <AssignedDutyCard
                      duty={currentDuty}
                      reviewPhotos
                      onChanged={patchDuty}
                      testID="emp-duties-current-card"
                    />
                  </>
                ) : (
                  <Muted testID="emp-duties-empty">Aktif görev yok.</Muted>
                )}
                {pendingPhotos ? (
                  <Muted testID="emp-duties-photo-pending">{pendingPhotos} iş fotoğrafı müşteri onayı bekliyor</Muted>
                ) : null}
              </View>
              {dutyRows.filter((t) => !currentDuty || (t.id || t.title) !== (currentDuty.id || currentDuty.title)).length ? (
                <View testID="emp-duties-cards" style={{ gap: 8 }}>
                  {dutyRows.filter((t) => !currentDuty || (t.id || t.title) !== (currentDuty.id || currentDuty.title)).map((t, i) => (
                    <AssignedDutyCard
                      key={t.id || String(i)}
                      duty={t}
                      index={i}
                      testID={`emp-duties-card-${t.id || i}`}
                      reviewPhotos
                      onChanged={patchDuty}
                    />
                  ))}
                </View>
              ) : board.open.filter((t) => !t.current).length ? (
                <View testID="emp-duties-open" style={{ gap: 8 }}>
                  <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13 }}>Diğer açık görevler ({board.open.filter((t) => !t.current).length})</Text>
                  {board.open.filter((t) => !t.current).map((t) => (
                    <View
                      key={t.id || t.title}
                      testID={`emp-duties-open-${t.id || t.title}`}
                      style={{ padding: 10, borderRadius: 12, backgroundColor: colors.slate50, borderWidth: 1, borderColor: colors.border, gap: 2 }}
                    >
                      <Text style={{ fontWeight: "700", color: colors.text }}>{t.title}</Text>
                      {t.lines.map((line) => (
                        <Muted key={line}>{line}</Muted>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}
              {board.done.length ? (
                <Muted testID="emp-duties-done">{board.done.length} tamamlanan görev</Muted>
              ) : null}
              {canEdit ? (
                <PrimaryButton
                  title="Yeni görev ata"
                  testID="emp-duties-assign"
                  color={colors.indigo}
                  onPress={() => {
                    const emp = dutiesEmp;
                    setDutiesEmp(null);
                    if (emp) openTaskAssign(emp);
                  }}
                />
              ) : null}
            </View>
          );
        })() : null}
      </B2BSheet>

      <B2BSheet
        visible={!!yevmiyeEmp}
        title={yevmiyeEditId ? "Yevmiye günü düzenle" : "Yevmiye günü"}
        subtitle={yevmiyeEmp ? `${yevmiyeEmp.full_name} · personel alacağı` : undefined}
        onClose={closeYevmiyeDays}
        testID="yevmiye-days-sheet"
      >
        <Muted testID="yevmiye-days-add-hint">
          {yevmiyeEditId
            ? "Bu kayıt güncellenir; diğer günler durur."
            : yevmiyeAddHint(yevmiyeHaveDays, parseYevmiyeDays(yevmiyeDays) || 0)}
        </Muted>
        <Field
          label="Kaç gün"
          testID="yevmiye-days-input"
          value={yevmiyeDays}
          onChangeText={setYevmiyeDays}
          keyboardType="number-pad"
          placeholder="Örn: 6"
        />
        <Field
          label="Yevmiye ücreti / gün"
          testID="yevmiye-days-wage"
          value={yevmiyeWage}
          onChangeText={setYevmiyeWage}
          keyboardType="decimal-pad"
          placeholder="Örn: 1500"
        />
        {parseYevmiyeDays(yevmiyeDays) && parseYevmiyeWage(yevmiyeWage) ? (
          <Muted testID="yevmiye-days-total">
            {yevmiyeDaysLine(yevmiyeEmp, parseYevmiyeDays(yevmiyeDays) || 0, parseYevmiyeWage(yevmiyeWage) || 0)} = {fmtMoney(dailyEarned({ ...yevmiyeEmp, daily_wage: parseYevmiyeWage(yevmiyeWage) || 0 }, parseYevmiyeDays(yevmiyeDays) || 0))}
          </Muted>
        ) : null}
        <Field
          label="Açıklama"
          testID="yevmiye-days-note"
          value={yevmiyeNote}
          onChangeText={setYevmiyeNote}
          placeholder="Opsiyonel"
        />
        <GroupedSelect
          label="Kasa / Banka / Ortak"
          testID="yevmiye-days-account"
          value={payAccount}
          onChange={setPayAccount}
          groups={payGroups}
          emptyLabel="Ödeme yok — personel alacağına yaz"
        />
        <PrimaryButton
          title={payAccount ? "Kaydet & Öde" : (yevmiyeEditId ? "Alacağı güncelle" : "Alacağa ekle")}
          testID="yevmiye-days-submit"
          color={colors.primaryHover}
          loading={busy}
          onPress={saveYevmiyeDays}
        />
        {yevmiyeEditId ? (
          <PrimaryButton
            title="Bu yevmiye kaydını sil"
            testID="yevmiye-days-delete"
            color={colors.danger}
            loading={busy}
            onPress={deleteYevmiyeEdit}
          />
        ) : null}
      </B2BSheet>

      <B2BSheet
        visible={!!ledgerEmp}
        title="Bakiye ödemesi"
        subtitle={ledgerEmp ? `${ledgerEmp.full_name} · kalan ${fmtMoney(remainingDue(balances[idOf(ledgerEmp)], unpaidPayrollTotal(idOf(ledgerEmp), payrolls)))}` : undefined}
        onClose={() => { setLedgerEmp(null); setLedgerAmount(""); setLedgerNote(""); }}
        testID="emp-ledger-sheet"
      >
        <Row>
          {(["alacak", "borc"] as LedgerSide[]).map((side) => (
            <Pressable
              key={side}
              testID={`emp-ledger-side-${side}`}
              onPress={() => {
                setLedgerSide(side);
                if (!ledgerEmp) return;
                const due = remainingDue(balances[idOf(ledgerEmp)], unpaidPayrollTotal(idOf(ledgerEmp), payrolls));
                const debt = Number(balances[idOf(ledgerEmp)]?.advances) || 0;
                setLedgerAmount(side === "borc" ? (debt > 0 ? String(debt) : "") : (due > 0 ? String(due) : ""));
              }}
              style={{
                flex: 1,
                minHeight: 40,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: ledgerSide === side ? (side === "borc" ? "#FECDD3" : "#6EE7B7") : colors.border,
                backgroundColor: ledgerSide === side ? (side === "borc" ? colors.rose50 : colors.emerald50) : colors.slate50,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontWeight: "800", color: side === "borc" ? "#BE123C" : colors.primaryHover }}>
                {side === "borc" ? "Borç" : "Alacak"}
              </Text>
            </Pressable>
          ))}
        </Row>
        <Muted testID="emp-ledger-hint">
          {ledgerSide === "borc"
            ? "Personel borcunu yazar — kalan alacaktan düşülür."
            : "Kalan alacak bakiyesini öder — personel alacağı düşer."}
        </Muted>
        <Field
          label="Tutar (₺)"
          testID="emp-ledger-amount"
          value={ledgerAmount}
          onChangeText={setLedgerAmount}
          keyboardType="decimal-pad"
          placeholder="Kalan bakiye"
        />
        <Field
          label="Açıklama"
          testID="emp-ledger-note"
          value={ledgerNote}
          onChangeText={setLedgerNote}
          placeholder={ledgerSide === "borc" ? "Borç açıklaması" : "Bakiye ödemesi"}
        />
        <GroupedSelect
          label="Kasa / Banka / Ortak"
          testID="emp-ledger-account"
          value={payAccount}
          onChange={setPayAccount}
          groups={payGroups}
        />
        <PrimaryButton
          title={ledgerSide === "borc" ? "Borcu öde" : "Bakiyeyi öde"}
          testID="emp-ledger-submit"
          color={ledgerSide === "borc" ? colors.danger : colors.primaryHover}
          loading={busy}
          onPress={saveLedger}
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
        title={payItem && isDailyPayroll(payItem) ? "Yevmiye ödemesi onayı" : "Maaş ödemesi onayı"}
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
        subtitle={taskEmp ? `${taskEmp.full_name} · atama bu personele · yapacağı işi seçin` : undefined}
        onClose={() => { setTaskEmp(null); setTaskDays(""); setTaskId(""); setTaskTitle(""); setTaskKind("field"); setTaskParkId(""); }}
        testID="task-assign-sheet"
      >
        {taskEmp && openEmployeeTasks(cards[idOf(taskEmp)]).length ? (
          <View testID="task-assign-existing" style={{ gap: 4, paddingBottom: 8 }}>
            <Muted>Mevcut görevler ({openEmployeeTasks(cards[idOf(taskEmp)]).length} açık)</Muted>
            {openEmployeeTasks(cards[idOf(taskEmp)]).slice(0, 6).map((t) => (
              <Muted key={t.id || t.title}>{t.title || "Görev"}{t.project_name ? ` · ${t.project_name}` : ""}{t.kind === "office" ? " · iç" : ""}</Muted>
            ))}
          </View>
        ) : null}
        <Row>
          {([
            ["office", "İç görev"],
            ["field", "Dış görev"],
          ] as const).map(([k, label]) => (
            <Pressable
              key={k}
              testID={`task-kind-${k}`}
              onPress={() => {
                setTaskKind(k);
                if (k === "office") setTaskDays("");
              }}
              style={{
                flex: 1,
                minHeight: 36,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: taskKind === k ? (k === "field" ? "#C7D2FE" : colors.border) : colors.border,
                backgroundColor: taskKind === k ? (k === "field" ? colors.indigo50 : colors.slate100) : colors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: 13, color: taskKind === k ? (k === "field" ? colors.indigo : colors.text) : colors.muted }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </Row>
        {taskKind === "field" ? (
          <>
            <Field
              label="Dış görev kaç gün?"
              testID="task-assign-days"
              value={taskDays}
              onChangeText={setTaskDays}
              keyboardType="number-pad"
              placeholder="Örn: 3"
            />
            {parseTaskDays(taskDays) ? (
              <Muted testID="task-assign-days-hint">
                {parseTaskDays(taskDays)} gün · bitiş {dueDateFromDays(todayIso(), parseTaskDays(taskDays) || 1)}
              </Muted>
            ) : (
              <Muted testID="task-assign-days-hint">Dış görevde kaç gün çalışacağını yazın; bitiş tarihi hesaplanır.</Muted>
            )}
          </>
        ) : (
          <Muted testID="task-assign-office-hint">İç görev ofiste / parkurda yapılır; konum kontrolü ücreti etkilemez.</Muted>
        )}
        {taskKind === "office" ? (
          workParks.length ? (
            <>
              <GroupedSelect
                label="Parkur"
                testID="task-park-select"
                value={taskParkId}
                onChange={setTaskParkId}
                groups={parkSelectGroups(workParks)}
                emptyLabel="Parkur seçin"
              />
              <Field
                label="Yapacağı iş (opsiyonel)"
                testID="task-title-input"
                value={taskTitle}
                onChangeText={setTaskTitle}
                placeholder="Boş bırakılırsa parkur adı yazılır"
              />
            </>
          ) : (
            <Muted testID="task-no-parks-hint">Henüz parkur yok. Firma Ayarları → İç görev parkurları’ndan ekleyin (ör. Makina parkuru).</Muted>
          )
        ) : (
          <>
        <GroupedSelect
          label="Proje"
          testID="task-project-select"
          value={taskProjectId}
          onChange={(v) => {
            setTaskProjectId(v);
            setTaskId("");
            setTaskTitle("");
            if (!v) return;
            get<ProjectWithTasks>(client, `/projects/${v}`)
              .then((full) => {
                if (!full) return;
                setProjects((prev) => prev.map((p) => (idOf(p) === v ? { ...p, ...full, tasks: full.tasks || p.tasks } : p)));
              })
              .catch(() => undefined);
          }}
          groups={projectSelectGroups(projects, { includeCompleted: taskShowCompleted, keepId: taskProjectId })}
          emptyLabel="Proje seçin"
        />
        {closedProjectCount(projects) ? (
          <Pressable
            testID="task-show-completed-btn"
            onPress={() => setTaskShowCompleted((v) => !v)}
            style={{ paddingVertical: 2, alignSelf: "flex-start" }}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>
              {taskShowCompleted
                ? "Tamamlananları gizle"
                : `Tamamlananları göster (${closedProjectCount(projects)})`}
            </Text>
          </Pressable>
        ) : null}
        <GroupedSelect
          label="Yapacağı iş"
          testID="task-existing-select"
          value={taskId}
          onChange={(v) => { setTaskId(v); if (v) setTaskTitle(""); }}
          groups={taskSelectGroups(projects.find((p) => idOf(p) === taskProjectId)?.tasks)}
          emptyLabel={taskProjectId ? "Yapılacak iş seçin" : "Önce proje seçin"}
        />
        {taskEmp && taskId ? (
          <Muted testID="task-assign-who">
            {taskEmp.full_name} bu işe atanacak
            {(() => {
              const t = (projects.find((p) => idOf(p) === taskProjectId)?.tasks || []).find((x) => (x.id || "") === taskId);
              return t?.title ? ` · ${t.title}` : "";
            })()}
          </Muted>
        ) : null}
        {!taskId ? (
          <Field
            label="Yeni iş adı"
            testID="task-title-input"
            value={taskTitle}
            onChangeText={setTaskTitle}
            placeholder="Listede yoksa yazın: keşif, montaj"
          />
        ) : null}
          </>
        )}
        <Muted testID="task-assign-field-hint">
          {(() => {
            if (taskKind === "office") {
              return "İç görev: giriş/çıkış iş merkezinden. Dış görevden geri dönünce ücret kesilmez; gün içi konum kontrolü ücreti etkilemez.";
            }
            const proj = projects.find((p) => idOf(p) === taskProjectId);
            const days = parseTaskDays(taskDays);
            const hint = !proj
              ? "Dış görev: giriş/çıkış görev yerinden. İş yerinde atanırsa çıkış dış görev yerini referans alır."
              : `${workplaceHint({
                kind: "task",
                task_title: taskTitle || "Görev",
                project_name: proj.name,
                has_coords: proj.latitude != null && proj.longitude != null,
                duration_days: days || undefined,
              }, true)} İş yerinde atanırsa çıkış dış görev yerini referans alır.`;
            return days ? `${hint} · ${days} gün` : hint;
          })()}
        </Muted>
        <PrimaryButton
          title={taskEmp ? `${taskEmp.full_name} bu işe ata` : "Bu personele ata"}
          testID="task-assign-save-btn"
          color={colors.indigo}
          loading={busy}
          onPress={saveTaskAssign}
        />
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
      title={employeeCardActionTitle(action, emp)}
      icon={employeeCardActionIcon(action.key)}
      color={tone.color}
      bg={tone.bg}
      testID={`emp-card-${action.key}-btn-${eid}`}
      onPress={() => handlers[action.key]?.(emp)}
    />
  );
}

function LocModeBlock({
  title,
  hint,
  prefix,
  mode,
  onChange,
}: {
  title: string;
  hint: string;
  prefix: string;
  mode: LocMode;
  onChange: (key: keyof LocMode, value: boolean | number | "") => void;
}) {
  return (
    <View
      testID={`emp-loc-mode-${prefix}`}
      style={{ gap: 6, padding: 10, borderRadius: 12, backgroundColor: colors.slate50, borderWidth: 1, borderColor: colors.border }}
    >
      <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13 }}>{title}</Text>
      <Muted>{hint} · {locModeSummary(mode)}</Muted>
      <Row>
        <Pressable
          testID={`emp-loc-${prefix}-enabled`}
          onPress={() => onChange("enabled", !mode.enabled)}
          style={{
            flex: 1,
            minHeight: 36,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: mode.enabled ? "#6EE7B7" : colors.border,
            backgroundColor: mode.enabled ? colors.emerald50 : colors.surface,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 6,
          }}
        >
          <Ionicons name={mode.enabled ? "checkbox" : "square-outline"} size={16} color={mode.enabled ? colors.primary : colors.muted} />
          <Text style={{ fontWeight: "700", fontSize: 12, color: mode.enabled ? colors.primaryHover : colors.muted }}>Konum açık</Text>
        </Pressable>
        <Pressable
          testID={`emp-loc-${prefix}-continuous`}
          onPress={() => mode.enabled && onChange("continuous", !mode.continuous)}
          style={{
            flex: 1,
            minHeight: 36,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: mode.enabled && mode.continuous ? "#A5B4FC" : colors.border,
            backgroundColor: mode.enabled && mode.continuous ? "#EEF2FF" : colors.surface,
            opacity: mode.enabled ? 1 : 0.5,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 6,
          }}
        >
          <Ionicons name={mode.continuous ? "checkbox" : "square-outline"} size={16} color={mode.continuous ? "#4338CA" : colors.muted} />
          <Text style={{ fontWeight: "700", fontSize: 12, color: mode.continuous ? "#3730A3" : colors.muted }}>Sürekli</Text>
        </Pressable>
      </Row>
      <Field
        label="Kontrol aralığı (dk)"
        testID={`emp-loc-${prefix}-interval`}
        value={String(mode.interval_minutes)}
        onChangeText={(v) => onChange("interval_minutes", v === "" ? "" : Number(v.replace(/\D/g, "").slice(0, 3)))}
        keyboardType="number-pad"
        placeholder="0 = sürekli"
      />
      {prefix === "field" ? (
        <Field
          label="Konum dışı çıkış toleransı (saat)"
          testID="emp-loc-field-exit-hours"
          value={String(mode.exit_tolerance_hours ?? 0)}
          onChangeText={(v) => onChange("exit_tolerance_hours", v === "" ? "" : Number(v.replace(/\D/g, "").slice(0, 2)))}
          keyboardType="number-pad"
          placeholder="0 = yok"
        />
      ) : null}
    </View>
  );
}

function pickEmployeeWorkplace(
  ...rows: Array<Workplace | null | undefined>
): Workplace | null {
  return rows.find((w) => w?.kind === "task") || rows.find((w) => !!w) || null;
}

function PayChip({
  title,
  icon,
  color,
  bg,
  onPress,
  testID,
}: {
  title: string;
  icon?: string;
  color: string;
  bg: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: "31.5%",
        width: "31.5%",
        maxWidth: "32%",
        minHeight: 56,
        paddingVertical: 6,
        paddingHorizontal: 4,
        borderRadius: 10,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      {icon ? <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color={color} /> : null}
      <Text style={{ fontWeight: "700", fontSize: 10, color, textAlign: "center" }} numberOfLines={2}>{title}</Text>
    </Pressable>
  );
}
