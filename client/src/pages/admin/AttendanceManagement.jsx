import { useCallback, useEffect, useState } from 'react';
import Modal from '../../components/common/Modal.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import { attendanceService } from '../../services/attendanceService.js';
import { employeeService } from '../../services/employeeService.js';
import ModulePage from '../shared/ModulePage.jsx';

/* ── helpers ──────────────────────────────────────────────────────────────── */
const fmt = (val) => (val ? new Date(val).toLocaleDateString('en-IN') : '–');
const fmtTime = (val) => (val ? new Date(val).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '–');
const fmtHours = (h) => (h != null ? `${Number(h).toFixed(2)} hr` : '–');

const minutesBetween = (start, end) => {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
};

const normalizeAttendanceRecord = (record) => {
  const now = new Date();
  const recordDate = record?.date ? new Date(record.date) : null;
  const effectiveNow = recordDate && !Number.isNaN(recordDate.getTime())
    ? (now > new Date(recordDate.setHours(23, 59, 59, 999)) ? new Date(recordDate) : now)
    : now;

  const sessions = Array.isArray(record?.sessions) ? record.sessions : [];
  const firstSession = sessions.length > 0 ? sessions[0] : null;
  const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

  const totalSessionMinutes = sessions.reduce((sum, session) => {
    if (!session?.loginTime) return sum;
    if (typeof session.durationMinutes === 'number' && session.durationMinutes > 0) {
      return sum + session.durationMinutes;
    }

    const endTime = session.logoutTime || effectiveNow;
    return sum + minutesBetween(session.loginTime, endTime);
  }, 0);

  const derivedWorkingHours = Number((Math.max(0, totalSessionMinutes - Number(record?.totalBreakMinutes || 0)) / 60).toFixed(2));

  return {
    ...record,
    sessions,
    loginTime: record?.loginTime || firstSession?.loginTime || null,
    logoutTime: record?.logoutTime || lastSession?.logoutTime || null,
    totalWorkingHours: record?.totalWorkingHours > 0 ? record.totalWorkingHours : derivedWorkingHours
  };
};

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'logged_in', label: 'Logged in' },
  { value: 'logged_out', label: 'Logged out' },
  { value: 'on_break', label: 'On break' },
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'missing_logout', label: 'Missing logout' }
];

const TIMING_FILTER_OPTIONS = [
  { value: '', label: 'All login / logout' },
  { value: 'late_login', label: 'Late logins only' },
  { value: 'early_logout', label: 'Early logouts only' }
];

/* ── Summary stat card ────────────────────────────────────────────────────── */
const SummaryCard = ({ label, value, colorClass }) => (
  <div className={`flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-4 shadow-sm`}>
    <span className={`text-xs font-bold uppercase tracking-wide ${colorClass}`}>{label}</span>
    <span className="text-3xl font-bold text-slate-900">{value ?? '–'}</span>
  </div>
);

/* ── Detail Modal ─────────────────────────────────────────────────────────── */
const DetailModal = ({ record, onClose, onEdit, onMarkAbsent }) => {
  const emp = record.employeeId;
  const name = emp?.userId?.name || '–';
  const code = emp?.employeeCode || '–';
  const dept = emp?.department || '–';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/40 p-4">
      <section className="w-full max-w-xl rounded-md bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Attendance Detail</h2>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
        </div>

        {/* Employee info */}
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-4 text-sm">
          <div><span className="font-semibold text-slate-500">Name</span><p className="text-slate-900">{name}</p></div>
          <div><span className="font-semibold text-slate-500">Employee ID</span><p className="text-slate-900">{code}</p></div>
          <div><span className="font-semibold text-slate-500">Department</span><p className="text-slate-900">{dept}</p></div>
          <div><span className="font-semibold text-slate-500">Date</span><p className="text-slate-900">{fmt(record.date)}</p></div>
        </div>

        {/* Timestamps */}
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-1 font-semibold text-slate-500">Login Time</p>
            <p className="text-slate-900">{fmtTime(record.loginTime)}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-1 font-semibold text-slate-500">Logout Time</p>
            <p className="text-slate-900">{fmtTime(record.logoutTime)}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-1 font-semibold text-slate-500">Total Working Hours</p>
            <p className="text-slate-900">{fmtHours(record.totalWorkingHours)}</p>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-1 font-semibold text-slate-500">Total Break</p>
            <p className="text-slate-900">{record.totalBreakMinutes ? `${record.totalBreakMinutes} min` : '–'}</p>
          </div>
        </div>

        {/* Productive hours */}
        <div className="mb-4 rounded-md border border-slate-200 p-3 text-sm">
          <p className="mb-1 font-semibold text-slate-500">Total Productive Hours</p>
          <p className="text-slate-900">
            {record.loginTime && record.logoutTime
              ? fmtHours(record.totalWorkingHours)
              : '–'}
          </p>
        </div>

        {/* Break details */}
        {record.breaks?.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-sm font-semibold text-slate-600">Break Details</p>
            <div className="overflow-hidden rounded-md border border-slate-200 text-sm">
              <table className="w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">#</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Start</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">End</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {record.breaks.map((b, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-slate-700">{i + 1}</td>
                      <td className="px-3 py-2 text-slate-700">{fmtTime(b.startTime)}</td>
                      <td className="px-3 py-2 text-slate-700">{fmtTime(b.endTime)}</td>
                      <td className="px-3 py-2 text-slate-700">{b.durationMinutes} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Device / location */}
        <div className="mb-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          {record.ipAddress && (
            <div className="rounded-md border border-slate-200 p-3">
              <p className="mb-1 font-semibold text-slate-500">IP Address</p>
              <p className="break-all text-slate-900">{record.ipAddress}</p>
            </div>
          )}
          {record.deviceInfo && (
            <div className="rounded-md border border-slate-200 p-3 sm:col-span-2">
              <p className="mb-1 font-semibold text-slate-500">Device</p>
              <p className="truncate text-slate-900" title={record.deviceInfo}>{record.deviceInfo}</p>
            </div>
          )}
          {record.location && (
            <div className="rounded-md border border-slate-200 p-3">
              <p className="mb-1 font-semibold text-slate-500">Location</p>
              <p className="text-slate-900">{record.location}</p>
            </div>
          )}
        </div>

        {/* Status & remarks */}
        <div className="mb-5 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="mb-1 font-semibold text-slate-500">Status</p>
            <StatusBadge status={record.status} />
            {record.earlyLogout && <span className="ml-2 rounded bg-orange-50 px-2 py-0.5 text-xs font-bold text-orange-700">Early Logout</span>}
          </div>
          <div>
            <p className="mb-1 font-semibold text-slate-500">Remarks</p>
            <p className="text-slate-900">{record.remarks || '–'}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button className="btn-primary" type="button" onClick={() => onEdit(record)}>Edit Attendance</button>
          {record.status !== 'absent' && (
            <button
              className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100"
              type="button"
              onClick={() => onMarkAbsent(record)}
            >
              Mark Absent
            </button>
          )}
        </div>
      </section>
    </div>
  );
};

/* ── Edit Modal ───────────────────────────────────────────────────────────── */
const EditModal = ({ record, onClose, onSave }) => {
  const [form, setForm] = useState({
    loginTime: record.loginTime ? new Date(record.loginTime).toISOString().slice(0, 16) : '',
    logoutTime: record.logoutTime ? new Date(record.logoutTime).toISOString().slice(0, 16) : '',
    status: record.status || '',
    remarks: record.remarks || '',
    location: record.location || ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        loginTime: form.loginTime ? new Date(form.loginTime).toISOString() : undefined,
        logoutTime: form.logoutTime ? new Date(form.logoutTime).toISOString() : undefined,
        status: form.status,
        remarks: form.remarks,
        location: form.location
      };
      await onSave(record._id, payload);
      onClose();
    } catch {
      setError('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit Attendance" onClose={onClose}>
      {error && <p className="mb-3 rounded bg-red-50 p-2 text-xs font-semibold text-red-700">{error}</p>}
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Login Time</label>
          <input className="form-field w-full" type="datetime-local" value={form.loginTime} onChange={(e) => set('loginTime', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Logout Time</label>
          <input className="form-field w-full" type="datetime-local" value={form.logoutTime} onChange={(e) => set('logoutTime', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Status</label>
          <select className="form-field w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
            {STATUS_OPTIONS.filter((o) => o.value).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Location</label>
          <input className="form-field w-full" type="text" value={form.location} onChange={(e) => set('location', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Remarks</label>
          <textarea className="form-field w-full" rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

/* ── Mark Absent Modal ────────────────────────────────────────────────────── */
const MarkAbsentModal = ({ record, onClose, onConfirm }) => {
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onConfirm(record, remarks);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Mark Absent" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-700">
        Mark <strong>{record.employeeId?.userId?.name || record.employeeId?.employeeCode}</strong> as absent on <strong>{fmt(record.date)}</strong>?
      </p>
      <div className="mb-4">
        <label className="mb-1 block text-xs font-semibold text-slate-600">Remarks (optional)</label>
        <textarea className="form-field w-full" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      <div className="flex justify-end gap-3">
        <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
        <button
          className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
          type="button"
          disabled={saving}
          onClick={handleConfirm}
        >
          {saving ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </Modal>
  );
};

/* ── Main page ────────────────────────────────────────────────────────────── */
const AttendanceManagement = () => {
  const [records, setRecords] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: new Date().toISOString().slice(0, 10),
    department: '',
    timing: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [detailRecord, setDetailRecord] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [absentRecord, setAbsentRecord] = useState(null);

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  const buildParams = useCallback(() => ({
    search: search || undefined,
    status: filters.status || undefined,
    fromDate: filters.fromDate || undefined,
    toDate: filters.toDate || undefined,
    department: filters.department || undefined,
    lateLogin: filters.timing === 'late_login' ? 'true' : undefined,
    earlyLogout: filters.timing === 'early_logout' ? 'true' : undefined
  }), [search, filters]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await attendanceService.admin(buildParams());
      setRecords((data.records || []).map(normalizeAttendanceRecord));
    } catch {
      setRecords([]);
      setError('Unable to load attendance records.');
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  const loadSummary = useCallback(async () => {
    try {
      const dateParam = filters.fromDate || new Date().toISOString().slice(0, 10);
      const { data } = await attendanceService.summary({ date: dateParam });
      setSummary(data);
    } catch {
      setSummary(null);
    }
  }, [filters.fromDate]);

  useEffect(() => { loadRecords(); }, [loadRecords]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  useEffect(() => {
    employeeService.list().then(({ data }) => {
      const emps = data.employees || [];
      const depts = [...new Set(emps.map((e) => e.department).filter(Boolean))].sort();
      setDepartments(depts);
    }).catch(() => {});
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data } = await attendanceService.export(buildParams());
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'attendance.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleSave = async (id, payload) => {
    await attendanceService.update(id, payload);
    await loadRecords();
    await loadSummary();
    if (detailRecord?._id === id) {
      const updated = records.find((r) => r._id === id);
      if (updated) setDetailRecord(updated);
    }
  };

  const handleMarkAbsent = async (record, remarks) => {
    await attendanceService.markAbsent({
      employeeId: record.employeeId?._id,
      date: record.date,
      remarks
    });
    await loadRecords();
    await loadSummary();
  };

  return (
    <ModulePage
      title="Attendance Management"
      actions={
        <button
          className="btn-primary ml-auto"
          type="button"
          disabled={exporting}
          onClick={handleExport}
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      }
    >
      {/* ── Summary ── */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Total Employees" value={summary?.totalEmployees} colorClass="text-slate-600" />
        <SummaryCard label="Present Today" value={summary?.present} colorClass="text-emerald-600" />
        <SummaryCard label="Absent" value={summary?.absent} colorClass="text-red-600" />
        <SummaryCard label="Late Login" value={summary?.lateLogin} colorClass="text-orange-600" />
        <SummaryCard label="Early Logout" value={summary?.earlyLogout} colorClass="text-amber-600" />
        <SummaryCard label="On Leave" value={summary?.onLeave} colorClass="text-blue-600" />
      </section>

      {/* ── Filters ── */}
      <div className="mb-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="overflow-x-auto">
          <div className="grid min-w-[980px] grid-cols-[minmax(220px,1.4fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_minmax(170px,0.95fr)_minmax(140px,0.8fr)_minmax(140px,0.8fr)] gap-2.5 items-center">
            <input
              className="form-field w-full"
              placeholder="Search by name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="form-field w-full" value={filters.department} onChange={(e) => setFilter('department', e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="form-field w-full" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="form-field w-full" value={filters.timing} onChange={(e) => setFilter('timing', e.target.value)}>
              {TIMING_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <label className="text-xs font-semibold text-slate-500">From</label>
              <input className="form-field w-full min-w-0" type="date" value={filters.fromDate} onChange={(e) => setFilter('fromDate', e.target.value)} />
            </div>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <label className="text-xs font-semibold text-slate-500">To</label>
              <input className="form-field w-full min-w-0" type="date" value={filters.toDate} onChange={(e) => setFilter('toDate', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Error ── */}
      {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

      {/* ── Table ── */}
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['Date', 'Employee Name', 'Employee ID', 'Department', 'Login', 'Logout', 'Working Hours', 'Status', 'Remarks', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-bold text-slate-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td className="px-4 py-6 text-center text-slate-500" colSpan={10}>Loading attendance…</td></tr>
              )}
              {!loading && records.length === 0 && (
                <tr><td className="px-4 py-6 text-center text-slate-500" colSpan={10}>No attendance records found.</td></tr>
              )}
              {!loading && records.map((row, idx) => (
                <tr
                  key={row._id || idx}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setDetailRecord(row)}
                >
                  <td className="px-4 py-3 text-slate-700">{fmt(row.date)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{row.employeeId?.userId?.name || '–'}</td>
                  <td className="px-4 py-3 text-slate-700">{row.employeeId?.employeeCode || '–'}</td>
                  <td className="px-4 py-3 text-slate-700">{row.employeeId?.department || '–'}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtTime(row.loginTime)}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {fmtTime(row.logoutTime)}
                    {row.earlyLogout && <span className="ml-1 rounded bg-orange-50 px-1 py-0.5 text-[10px] font-bold text-orange-600">Early</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{fmtHours(row.totalWorkingHours)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="max-w-[140px] truncate px-4 py-3 text-slate-500" title={row.remarks}>{row.remarks || '–'}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      <button
                        className="text-xs font-semibold text-blue-700 hover:underline"
                        type="button"
                        onClick={() => setEditRecord(row)}
                      >Edit</button>
                      <button
                        className="text-xs font-semibold text-red-600 hover:underline"
                        type="button"
                        onClick={() => setAbsentRecord(row)}
                      >Absent</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modals ── */}
      {detailRecord && (
        <DetailModal
          record={detailRecord}
          onClose={() => setDetailRecord(null)}
          onEdit={(r) => { setDetailRecord(null); setEditRecord(r); }}
          onMarkAbsent={(r) => { setDetailRecord(null); setAbsentRecord(r); }}
        />
      )}
      {editRecord && (
        <EditModal
          record={editRecord}
          onClose={() => setEditRecord(null)}
          onSave={handleSave}
        />
      )}
      {absentRecord && (
        <MarkAbsentModal
          record={absentRecord}
          onClose={() => setAbsentRecord(null)}
          onConfirm={handleMarkAbsent}
        />
      )}
    </ModulePage>
  );
};

export default AttendanceManagement;
