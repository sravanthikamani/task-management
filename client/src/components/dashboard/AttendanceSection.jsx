import StatusBadge from '../common/StatusBadge.jsx';
import DataTable from '../common/DataTable.jsx';

const formatTime = (value) => {
  if (!value || value === '-') return '-';

  // Keep preformatted values untouched.
  if (typeof value === 'string' && /\b\d{1,2}:\d{2}\s?(AM|PM)\b/i.test(value)) {
    return value;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
};

const minutesFromSessions = (row) => {
  const now = Date.now();
  const rowDate = row?.date ? new Date(row.date) : null;
  const cappedNow = rowDate && !Number.isNaN(rowDate.getTime())
    ? Math.min(now, new Date(rowDate.setHours(23, 59, 59, 999)).getTime())
    : now;
  const sessions = Array.isArray(row.sessions) ? row.sessions : [];
  const sessionMinutes = sessions.reduce((sum, session) => {
    if (typeof session?.durationMinutes === 'number' && session.durationMinutes > 0) {
      return sum + session.durationMinutes;
    }
    if (session?.loginTime && session?.logoutTime) {
      const start = new Date(session.loginTime);
      const end = new Date(session.logoutTime);
      const diff = Math.max(0, Math.round((end - start) / 60000));
      return sum + diff;
    }
    if (session?.loginTime) {
      const start = new Date(session.loginTime);
      const diff = Math.max(0, Math.round((cappedNow - start.getTime()) / 60000));
      return sum + diff;
    }
    return sum;
  }, 0);

  if (sessions.length === 0 && row.loginTime) {
    const start = new Date(row.loginTime);
    const end = row.logoutTime ? new Date(row.logoutTime) : new Date(cappedNow);
    const diff = Math.max(0, Math.round((end - start) / 60000));
    return Math.max(0, diff - Number(row.totalBreakMinutes || 0));
  }

  return Math.max(0, sessionMinutes - Number(row.totalBreakMinutes || 0));
};

const formatHours = (row) => {
  let minutes = 0;

  if (typeof row.totalWorkingHours === 'number' && row.totalWorkingHours > 0) {
    minutes = Math.round(row.totalWorkingHours * 60);
  } else {
    minutes = minutesFromSessions(row);
  }

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
};

const AttendanceSection = ({ attendance }) => {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-4 font-bold text-slate-950">Today's Attendance Overview</h3>
      <DataTable
        columns={[
          { 
            key: 'employee', 
            label: 'Employee', 
            render: (row) => row.employee || row.employeeId?.userId?.name || '-' 
          },
          { 
            key: 'loginTime', 
            label: 'Login', 
            render: (row) => formatTime(row.loginTime) 
          },
          { 
            key: 'logoutTime', 
            label: 'Logout', 
            render: (row) => formatTime(row.logoutTime) 
          },
          { 
            key: 'totalWorkingHours', 
            label: 'Hours', 
            render: (row) => formatHours(row)
          },
          { 
            key: 'status', 
            label: 'Status', 
            render: (row) => <StatusBadge status={row.status} /> 
          }
        ]}
        rows={attendance || []}
      />
    </section>
  );
};

export default AttendanceSection;
