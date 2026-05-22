import { useEffect, useMemo, useState } from 'react';
// Helper for attendance summary colors
const summaryColors = {
  present: '#2563eb', // blue
  leave: '#f59e42',  // orange
  absent: '#e11d48', // red
  hours: '#059669'   // green
};
import DashboardLayout from '../../components/layout/DashboardLayout.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { attendanceService } from '../../services/attendanceService.js';
import { dailyUpdateService } from '../../services/dailyUpdateService.js';
import { dashboardService } from '../../services/dashboardService.js';
import { notificationService } from '../../services/notificationService.js';
import { projectService } from '../../services/projectService.js';
import { taskService } from '../../services/taskService.js';

const statusLabel = {
  not_logged_in: 'Not logged in',
  logged_in: 'Logged in',
  on_break: 'On break',
  logged_out: 'Logged out',
  late: 'Logged in',
  absent: 'Not logged in'
};

const prettyDate = (value) => (value ? new Date(value).toLocaleDateString() : '-');

const prettyTime = (value) => {
  if (!value) return '-';

  // Keep preformatted values untouched.
  if (typeof value === 'string' && /\b\d{1,2}:\d{2}\s?(AM|PM)\b/i.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });
};

// Format minutes as 'X hrs Y mins'
const formatMinutesToHoursMins = (mins) => {
  const m = Number(mins) || 0;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0 && rem > 0) return `${h}hrs ${rem} mins`;
  if (h > 0) return `${h}hrs`;
  return `${rem} mins`;
};

const priorityRank = { urgent: 4, high: 3, medium: 2, low: 1 };
const employeeNotificationSections = [
  {
    key: 'deadline_reminder',
    title: 'Deadline Reminders',
    subtypes: ['task_deadline_reminder', 'task_deadline_approaching', 'project_deadline_approaching', 'project_deadline_update', 'deadline_reminder'],
    toneClass: 'employee-notification-dot-deadline'
  },
  {
    key: 'admin_comments',
    title: 'Admin Comments',
    subtypes: ['leave_admin_remarks', 'task_comment_added', 'admin_comment', 'manager_comment', 'comment_added'],
    toneClass: 'employee-notification-dot-admin'
  },
  {
    key: 'task',
    title: 'Task Notifications',
    subtypes: ['task_assigned', 'task_deadline_reminder', 'task_comment_added', 'task_approved', 'task_reopened'],
    toneClass: 'employee-notification-dot-task'
  },
  {
    key: 'project',
    title: 'Project Notifications',
    subtypes: ['project_added', 'project_deadline_update', 'project_status_changed'],
    toneClass: 'employee-notification-dot-muted'
  },
  {
    key: 'attendance',
    title: 'Attendance Notifications',
    subtypes: ['missing_logout_reminder', 'late_login_notice', 'daily_update_reminder'],
    toneClass: 'employee-notification-dot-muted'
  },
  {
    key: 'leave',
    title: 'Leave Notifications',
    subtypes: ['leave_approved', 'leave_rejected', 'leave_admin_remarks'],
    toneClass: 'employee-notification-dot-muted'
  }
];

const toMinutes = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const taskStatusLabel = (status = '', priority = '') => {
  const normalizedPriority = String(priority || '').toLowerCase();
  const normalizedStatus = String(status || '').toLowerCase();

  if (normalizedPriority === 'urgent') return 'Urgent';
  if (normalizedStatus === 'in_progress') return 'In Progress';
  if (normalizedStatus === 'in_review') return 'Review';
  if (normalizedStatus === 'completed') return 'Done';
  return 'Todo';
};

const taskStatusToneClass = (status = '', priority = '') => {
  const normalizedPriority = String(priority || '').toLowerCase();
  const normalizedStatus = String(status || '').toLowerCase();

  if (normalizedPriority === 'urgent') return 'employee-today-pill-urgent';
  if (normalizedStatus === 'in_progress') return 'employee-today-pill-progress';
  if (normalizedStatus === 'in_review') return 'employee-today-pill-review';
  if (normalizedStatus === 'completed') return 'employee-today-pill-done';
  return 'employee-today-pill-todo';
};

const taskTimeLabel = (deadline, index) => {
  if (deadline) {
    const date = new Date(deadline);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  const fallback = [10, 13, 15, 17];
  const hour = fallback[index % fallback.length];
  return new Date(2000, 0, 1, hour, 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const isSameDate = (left, right) => {
  const l = new Date(left);
  const r = new Date(right);
  return l.getFullYear() === r.getFullYear() && l.getMonth() === r.getMonth() && l.getDate() === r.getDate();
};

const isPresentStatus = (status) => ['logged_in', 'logged_out', 'on_break', 'late'].includes(status);

const deriveHoursFromRecord = (record) => {
  if (Number(record?.totalWorkingHours || 0) > 0) {
    return Number(record.totalWorkingHours);
  }

  const sessions = Array.isArray(record?.sessions) ? record.sessions : [];
  const now = new Date();
  const recordDate = record?.date ? new Date(record.date) : null;
  const effectiveNow = recordDate && !Number.isNaN(recordDate.getTime())
    ? (now > new Date(recordDate.setHours(23, 59, 59, 999)) ? new Date(recordDate) : now)
    : now;

  const minutes = sessions.reduce((sum, session) => {
    if (!session?.loginTime) return sum;
    if (typeof session.durationMinutes === 'number' && session.durationMinutes > 0) {
      return sum + session.durationMinutes;
    }

    const sessionEnd = session.logoutTime ? new Date(session.logoutTime) : effectiveNow;
    const sessionStart = new Date(session.loginTime);
    if (Number.isNaN(sessionStart.getTime()) || Number.isNaN(sessionEnd.getTime())) return sum;

    return sum + Math.max(0, Math.round((sessionEnd.getTime() - sessionStart.getTime()) / 60000));
  }, 0);

  return Number((Math.max(0, minutes - Number(record?.totalBreakMinutes || 0)) / 60).toFixed(2));
};

const businessDaysInMonth = (year, month) => {
  const days = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= days; d += 1) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
};

const EmployeeDashboard = () => {

  // Weekly summary state
  const [weekSummary, setWeekSummary] = useState(null);

  const getStartOfWeek = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day); // Sunday as start
    return d;
  };

  const getEndOfWeek = (date) => {
    const d = getStartOfWeek(date);
    d.setDate(d.getDate() + 7);
    return d;
  };

  const loadWeeklySummary = async () => {
    const now = new Date();
    const weekStart = getStartOfWeek(now);
    const weekEnd = getEndOfWeek(now);

    const res = await attendanceService.history();
    const records = res.data?.records || [];

    const weekRecords = records.filter((item) => {
      const itemDate = new Date(item.date);
      const dayOfWeek = itemDate.getDay();
      return !Number.isNaN(itemDate.getTime()) && itemDate >= weekStart && itemDate < weekEnd && dayOfWeek !== 0 && dayOfWeek !== 6;
    });

    const present = weekRecords.filter((r) => isPresentStatus(r.status)).length;
    const leaves = weekRecords.filter((r) => r.status === 'on_leave').length;
    const absents = weekRecords.filter((r) => r.status === 'absent').length;
    const lateDays = weekRecords.filter((r) => r.status === 'late').length;
    const workingHours = weekRecords.reduce((sum, r) => sum + deriveHoursFromRecord(r), 0);
    const totalDays = 5;

    setWeekSummary({
      present,
      leaves,
      absents,
      lateDays,
      workingHours: Number(workingHours.toFixed(2)),
      totalDays,
      maxWorkingHours: 40,
      weekLabel: `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${new Date(weekEnd - 1).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
    });
  };

  // Fetch weekly summary on mount
  useEffect(() => {
    loadWeeklySummary()
      .catch(() => setWeekSummary(null));
  }, []);
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState('');
  const [dailyForm, setDailyForm] = useState({
    workDescription: '',
    timeSpent: '',
    blockers: '',
    tomorrowPlan: ''
  });
  const [message, setMessage] = useState('');
  const [checkedTaskIds, setCheckedTaskIds] = useState(() => new Set());

  const syncTodayAttendance = async () => {
    try {
      const todayRes = await attendanceService.today();
      const todayAttendance = todayRes.data?.attendance || null;
      const todayStatus = todayRes.data?.status || todayAttendance?.status || 'not_logged_in';

      setData((current) => {
        if (!current) return current;

        const mergedLoginLogout = {
          ...(current.loginLogout || {}),
          ...(todayAttendance || {}),
          status: todayStatus
        };

        return {
          ...current,
          welcome: {
            ...(current.welcome || {}),
            currentStatus: todayStatus
          },
          loginLogout: mergedLoginLogout
        };
      });
    } catch {
      // Keep existing dashboard state when background sync fails.
    }
  };

  const buildFallbackDashboard = async () => {
    const [attendanceRes, tasksRes, projectsRes, updatesRes, notificationsRes] = await Promise.all([
      attendanceService.today(),
      taskService.list(),
      projectService.list(),
      dailyUpdateService.list(),
      notificationService.list()
    ]);

    const today = new Date();
    const attendanceRecord = attendanceRes.data?.attendance;
    const fallbackSessions = Array.isArray(attendanceRecord?.sessions) ? attendanceRecord.sessions : [];
    const fallbackFirstSession = fallbackSessions.length > 0 ? fallbackSessions[0] : null;
    const fallbackLastSession = fallbackSessions.length > 0 ? fallbackSessions[fallbackSessions.length - 1] : null;
    const tasks = tasksRes.data?.tasks || [];
    const projects = projectsRes.data?.projects || [];
    const notifications = notificationsRes.data?.notifications || [];
    const updates = updatesRes.data?.updates || [];

    const todayUpdate = updates.find((update) => update.date && isSameDate(update.date, today)) || null;

    return {
      welcome: {
        employeeName: user?.name || '-',
        currentDate: today,
        currentStatus: attendanceRes.data?.status || 'not_logged_in'
      },
      loginLogout: {
        status: attendanceRecord?.status || attendanceRes.data?.status || 'not_logged_in',
        loginTime: attendanceRecord?.loginTime || fallbackFirstSession?.loginTime || null,
        logoutTime: attendanceRecord?.logoutTime || fallbackLastSession?.logoutTime || null,
        sessions: attendanceRecord?.sessions || [],
        breakStartTime: attendanceRecord?.breakStartTime || null,
        breakEndTime: attendanceRecord?.breakEndTime || null,
        breaks: attendanceRecord?.breaks || [],
        totalWorkingHours: attendanceRecord?.totalWorkingHours || 0,
        totalBreakMinutes: attendanceRecord?.totalBreakMinutes || 0
      },
      todayTasks: tasks.slice(0, 20).map((task) => ({
        _id: task._id,
        title: task.title,
        projectName: task.projectId?.name || 'No project',
        priority: task.priority,
        deadline: task.dueDate,
        status: task.status
      })),
      assignedProjects: projects.slice(0, 20).map((project) => {
        const currentMember = (project.assignedEmployees || []).find((member) => member.name === user?.name);
        const total = project.taskSummary?.total || 0;
        const completed = project.taskSummary?.completed || 0;
        return {
          _id: project._id,
          name: project.name,
          role: currentMember?.role || 'member',
          deadline: project.deadline,
          status: project.status,
          progress: total ? Math.round((completed / total) * 100) : 0,
          totalTasks: total,
          completedTasks: completed
        };
      }),
      todayWorkUpdate: todayUpdate,
      notifications: {
        all: notifications,
        newTaskAssigned: notifications.filter((item) => item.type === 'task').slice(0, 10),
        deadlineReminder: notifications
          .filter((item) => item.subtype?.includes('deadline') || item.message?.toLowerCase().includes('due'))
          .slice(0, 10),
        adminComments: notifications
          .filter((item) => ['system', 'leave', 'daily_update'].includes(item.type))
          .slice(0, 10),
        projectUpdates: notifications.filter((item) => item.type === 'project').slice(0, 10)
      }
    };
  };

  const loadDashboard = async () => {
    setLoading(true);
    setMessage('');

    const applyPayload = (payload, todayAttendance = null, todayStatus = null) => {
      const mergedLoginLogout = {
        ...(payload.loginLogout || {}),
        ...(todayAttendance || {})
      };

      const mergedPayload = {
        ...payload,
        welcome: {
          ...(payload.welcome || {}),
          currentStatus: todayStatus || todayAttendance?.status || payload?.welcome?.currentStatus || 'not_logged_in'
        },
        loginLogout: {
          ...mergedLoginLogout,
          status: todayStatus || todayAttendance?.status || mergedLoginLogout.status || 'not_logged_in'
        }
      };

      setData(mergedPayload);
      setDailyForm((prev) => ({
        workDescription: mergedPayload.todayWorkUpdate?.workDescription || prev.workDescription,
        timeSpent: mergedPayload.todayWorkUpdate?.timeSpent ?? prev.timeSpent,
        blockers: mergedPayload.todayWorkUpdate?.blockers || prev.blockers,
        tomorrowPlan: mergedPayload.todayWorkUpdate?.tomorrowPlan || prev.tomorrowPlan
      }));
    };

    const loadFallback = async () => {
      const [fallbackPayload, todayRes] = await Promise.all([
        buildFallbackDashboard(),
        attendanceService.today()
      ]);

      applyPayload(
        fallbackPayload,
        todayRes.data?.attendance || null,
        todayRes.data?.status || null
      );
    };

    try {
      const [{ data: payload }, todayRes] = await Promise.all([
        dashboardService.getEmployeeOverview(),
        attendanceService.today()
      ]);

      applyPayload(
        payload,
        todayRes.data?.attendance || null,
        todayRes.data?.status || null
      );
    } catch (error) {
      try {
        await loadFallback();
      } catch (fallbackError) {
        setMessage(fallbackError?.response?.data?.message || 'Unable to load dashboard data.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      syncTodayAttendance();
    };

    const intervalId = window.setInterval(() => {
      syncTodayAttendance();
    }, 20000);

    window.addEventListener('focus', handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const attendance = data?.loginLogout || {};
  const currentStatus = attendance.status || 'not_logged_in';
  // Calculate total working hours from all sessions
  const allSessions = attendance.sessions || [];
  const totalSessionMinutes = allSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

  const taskStats = useMemo(() => {
    const list = data?.todayTasks || [];
    return {
      total: list.length,
      inProgress: list.filter((task) => task.status === 'in_progress').length,
      completed: list.filter((task) => task.status === 'completed').length
    };
  }, [data?.todayTasks]);

  const sortedTodayTasks = useMemo(() => {
    const list = [...(data?.todayTasks || [])];
    return list.sort((left, right) => {
      const leftRank = priorityRank[String(left.priority || '').toLowerCase()] || 0;
      const rightRank = priorityRank[String(right.priority || '').toLowerCase()] || 0;
      if (leftRank !== rightRank) return rightRank - leftRank;
      const leftDeadline = left.deadline ? new Date(left.deadline).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDeadline = right.deadline ? new Date(right.deadline).getTime() : Number.MAX_SAFE_INTEGER;
      return leftDeadline - rightDeadline;
    });
  }, [data?.todayTasks]);

  const weeklyTaskMetrics = useMemo(() => {
    const list = data?.todayTasks || [];
    const total = list.length;
    const completed = list.filter((task) => task.status === 'completed').length;
    const inReview = list.filter((task) => task.status === 'in_review').length;
    const overdue = list.filter((task) => {
      if (!task.deadline || task.status === 'completed') return false;
      const deadlineDate = new Date(task.deadline);
      return !Number.isNaN(deadlineDate.getTime()) && deadlineDate.getTime() < Date.now();
    }).length;
    const completedRate = total ? Math.round((completed / total) * 100) : 0;
    const inReviewRate = total ? Math.round((inReview / total) * 100) : 0;
    const overdueRate = total ? Math.round((overdue / total) * 100) : 0;

    return {
      completedRate,
      inReviewRate,
      overdueRate,
      activeProjects: (data?.assignedProjects || []).length,
      projectNames: (data?.assignedProjects || []).slice(0, 3).map((project) => project.name)
    };
  }, [data?.assignedProjects, data?.todayTasks]);

  const notificationCards = useMemo(() => {
    const notifications = data?.notifications || {};
    const fallbackList = [
      ...(notifications.newTaskAssigned || []),
      ...(notifications.deadlineReminder || []),
      ...(notifications.adminComments || []),
      ...(notifications.projectUpdates || []),
      ...(notifications.attendanceUpdates || []),
      ...(notifications.leaveUpdates || [])
    ];

    const allNotifications = (notifications.all && notifications.all.length > 0)
      ? notifications.all
      : fallbackList;

    const grouped = employeeNotificationSections.reduce((accumulator, section) => ({ ...accumulator, [section.key]: [] }), {});

    allNotifications.forEach((notification) => {
      const lowerMsg = String(notification?.message || '').toLowerCase();

      const section =
        employeeNotificationSections.find((item) => item.subtypes.includes(notification?.subtype))
        || ((lowerMsg.includes('due') || lowerMsg.includes('deadline'))
          ? employeeNotificationSections.find((item) => item.key === 'deadline_reminder')
          : null)
        || ((notification?.type === 'system' || notification?.type === 'daily_update' || lowerMsg.includes('comment'))
          ? employeeNotificationSections.find((item) => item.key === 'admin_comments')
          : null)
        || employeeNotificationSections.find((item) => item.key === notification?.type)
        || (notification?.type === 'daily_update' ? employeeNotificationSections.find((item) => item.key === 'attendance') : null);

      if (section) {
        grouped[section.key].push(notification);
      }
    });

    return employeeNotificationSections.map((section) => ({
      key: section.key,
      title: section.title,
      toneClass: section.toneClass,
      count: (grouped[section.key] || []).length,
      message: (grouped[section.key] || [])[0]?.message || 'No alerts in this section.'
    }));
  }, [data?.notifications]);

  const unreadCount = useMemo(() => {
    const list = data?.notifications?.all || [];
    if (list.length === 0) return 0;

    const hasReadMeta = list.some((item) => typeof item?.isRead === 'boolean' || typeof item?.read === 'boolean' || item?.readAt);
    if (!hasReadMeta) {
      return list.slice(0, 4).length;
    }

    return list.filter((item) => item?.isRead === false || item?.read === false || !item?.readAt).length;
  }, [data?.notifications?.all]);

  const toggleTaskChecked = (taskId) => {
    setCheckedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const attendanceGraph = useMemo(() => {
    const loginMin = toMinutes(attendance.loginTime);
    const logoutMin = toMinutes(attendance.logoutTime);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    if (loginMin == null) return null;

    // The total span is strictly login → logout (or now)
    const endMin = logoutMin != null ? logoutMin : Math.max(loginMin + 1, nowMin);
    const totalSpan = Math.max(1, endMin - loginMin);

    // Convert an absolute minute value to a % within the login→end bar
    const pct = (min) => clamp(((min - loginMin) / totalSpan) * 100, 0, 100);

    // Collect break segments from breaks[] array
    const rawBreaks = Array.isArray(attendance.breaks) ? attendance.breaks : [];
    const breakSegs = rawBreaks
      .map((item) => ({ start: toMinutes(item.startTime), end: toMinutes(item.endTime) }))
      .filter((item) => item.start != null && item.end != null && item.end > item.start);

    // Also handle an open (current) break
    const openStart = toMinutes(attendance.breakStartTime);
    const openEnd = toMinutes(attendance.breakEndTime);
    if (openStart != null && openStart >= loginMin) {
      const resolvedEnd = (openEnd != null && openEnd > openStart)
        ? openEnd
        : currentStatus === 'on_break' ? Math.min(nowMin, endMin) : null;
      if (resolvedEnd != null && resolvedEnd > openStart) {
        breakSegs.push({ start: openStart, end: resolvedEnd });
      }
    }

    const breakPct = breakSegs.map((seg) => ({
      left: pct(seg.start),
      width: Math.max(1, pct(seg.end) - pct(seg.start))
    }));

    const totalBreakMin = breakSegs.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
    const totalWorkMin = totalSpan - totalBreakMin;

    return {
      loginTime: prettyTime(attendance.loginTime),
      logoutTime: logoutMin != null ? prettyTime(attendance.logoutTime) : prettyTime(new Date()),
      logoutLabel: logoutMin != null ? 'Logout' : 'Now',
      isLive: logoutMin == null,
      totalWorkMin,
      totalBreakMin,
      breakPct,
    };
  }, [attendance.breakEndTime, attendance.breakStartTime, attendance.breaks, attendance.loginTime, attendance.logoutTime, currentStatus]);

  const totalWorkingMinutes = useMemo(() => {
    if (totalSessionMinutes > 0) return totalSessionMinutes;

    if (attendanceGraph?.totalWorkMin > 0) {
      return attendanceGraph.totalWorkMin;
    }

    const hoursBasedMinutes = Math.round((Number(attendance.totalWorkingHours || 0) * 60));
    return Math.max(0, hoursBasedMinutes);
  }, [attendance.totalWorkingHours, attendanceGraph?.totalWorkMin, totalSessionMinutes]);

  const runAttendanceAction = async (kind) => {
    setActionBusy(kind);
    setMessage('');
    try {
      if (kind === 'login') await attendanceService.login();
      if (kind === 'logout') await attendanceService.logout();
      if (kind === 'breakStart') await attendanceService.breakStart();
      if (kind === 'breakEnd') await attendanceService.breakEnd();
      await loadDashboard();
      await loadWeeklySummary();
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Attendance action failed.');
    } finally {
      setActionBusy('');
    }
  };

  const submitDailyUpdate = async (event) => {
    event.preventDefault();
    setActionBusy('dailyUpdate');
    setMessage('');
    try {
      await dailyUpdateService.create({
        date: new Date().toISOString(),
        workDescription: dailyForm.workDescription,
        timeSpent: Number(dailyForm.timeSpent) || 0,
        blockers: dailyForm.blockers,
        tomorrowPlan: dailyForm.tomorrowPlan,
        pendingWork: dailyForm.tomorrowPlan,
        status: 'submitted'
      });
      setMessage('Daily work update submitted.');
      await loadDashboard();
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Unable to submit daily update.');
    } finally {
      setActionBusy('');
    }
  };

  if (loading && !data) {
    return (
      <DashboardLayout title="Daily overview">
        <div className="employee-page employee-dashboard-page">
          <p className="employee-message rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading dashboard...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Daily work overview">
      <div className="employee-page employee-dashboard-page">
        {!!message && <div className="employee-message mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</div>}


      {/* Modern Welcome + KPI Row */}

      <div className="employee-dashboard-header-row">
        <div className="employee-dashboard-greeting">
          <h1 className="employee-dashboard-greeting-title">
            Good morning, {data?.welcome?.employeeName || user?.name || '-'} <span className="employee-dashboard-wave">👋</span>
          </h1>
          <div className="employee-dashboard-greeting-sub">Here's what's happening today, {prettyDate(data?.welcome?.currentDate || new Date())}.</div>
        </div>
      </div>


      <div className="employee-dashboard-kpi-row">
        {/* Active Tasks */}
        <div className="employee-kpi-card employee-kpi-active">
          <span className="employee-kpi-icon employee-kpi-icon-active">
            {/* Outlined clipboard with check, larger and more accurate */}
            <svg width="38" height="38" fill="none" viewBox="0 0 38 38">
              <rect x="7" y="7" width="24" height="24" rx="8" fill="#EEF4FF"/>
              <rect x="14" y="13" width="12" height="14" rx="3" stroke="#2563eb" strokeWidth="2"/>
              <rect x="17" y="10.5" width="6" height="3" rx="1.5" stroke="#2563eb" strokeWidth="1.5"/>
              <path d="M17.8 22.5l2.2 2.2 4-4" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <div className="employee-kpi-main">{taskStats.total}</div>
          <div className="employee-kpi-label">Active Tasks</div>
          <span className="employee-kpi-trend" style={{ color: '#2563eb' }}>{taskStats.total > 0 ? `↗ +${taskStats.total}` : '↗ 0'}</span>
        </div>
        {/* Completed */}
        <div className="employee-kpi-card employee-kpi-completed">
          <span className="employee-kpi-icon employee-kpi-icon-completed">
            {/* Outlined check in circle, larger */}
            <svg width="38" height="38" fill="none" viewBox="0 0 38 38">
              <rect x="7" y="7" width="24" height="24" rx="8" fill="#E6FBF4"/>
              <circle cx="19" cy="19" r="7" stroke="#059669" strokeWidth="2" fill="none"/>
              <path d="M16.5 19.5l2 2 3.5-3.5" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <div className="employee-kpi-main">{taskStats.completed}</div>
          <div className="employee-kpi-label">Completed</div>
          <span className="employee-kpi-trend" style={{ color: '#059669' }}>{taskStats.completed > 0 ? `↗ +${taskStats.completed}` : '↗ 0'}</span>
        </div>
        {/* In Review */}
        <div className="employee-kpi-card employee-kpi-review">
          <span className="employee-kpi-icon employee-kpi-icon-review">
            {/* Outlined clock icon, larger */}
            <svg width="38" height="38" fill="none" viewBox="0 0 38 38">
              <rect x="7" y="7" width="24" height="24" rx="8" fill="#E6F0FB"/>
              <circle cx="19" cy="19" r="7" stroke="#2563eb" strokeWidth="2" fill="none"/>
              <path d="M19 15.5v4l2.2 1.5" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </span>
          <div className="employee-kpi-main">5</div>
          <div className="employee-kpi-label">In Review</div>
          <span className="employee-kpi-trend" style={{ color: '#2563eb' }}>↗ +5</span>
        </div>
        {/* Overdue */}
        <div className="employee-kpi-card employee-kpi-overdue">
          <span className="employee-kpi-icon employee-kpi-icon-overdue">
            {/* Outlined alert in circle, larger */}
            <svg width="38" height="38" fill="none" viewBox="0 0 38 38">
              <rect x="7" y="7" width="24" height="24" rx="8" fill="#FEEEEF"/>
              <circle cx="19" cy="19" r="7" stroke="#e11d48" strokeWidth="2" fill="none"/>
              <circle cx="19" cy="22" r="1.3" fill="#e11d48"/>
              <path d="M19 16v3" stroke="#e11d48" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </span>
          <div className="employee-kpi-main">2</div>
          <div className="employee-kpi-label">Overdue</div>
          <span className="employee-kpi-trend" style={{ color: '#e11d48' }}>↗ +2</span>
        </div>
      </div>

      <div className="mt-6 grid gap-6">
        {/* Login/Logout + Summary Card Row */}
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-soft flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-[320px]">
            <h3 className="text-lg font-bold text-ink">Login / Logout Section</h3>
            <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary employee-attendance-action employee-attendance-login" disabled={actionBusy === 'login' || ['logged_in', 'on_break', 'logged_out', 'late'].includes(currentStatus)} onClick={() => runAttendanceAction('login')} type="button">Login</button>
            <button className="btn-secondary employee-attendance-action employee-attendance-logout" disabled={actionBusy === 'logout' || !['logged_in', 'on_break', 'late'].includes(currentStatus)} onClick={() => runAttendanceAction('logout')} type="button">Logout</button>
            <button className="btn-secondary employee-attendance-action employee-attendance-break" disabled={actionBusy === 'breakStart' || !['logged_in', 'late'].includes(currentStatus)} onClick={() => runAttendanceAction('breakStart')} type="button">Break start</button>
            <button className="btn-secondary employee-attendance-action employee-attendance-break-end" disabled={actionBusy === 'breakEnd' || currentStatus !== 'on_break'} onClick={() => runAttendanceAction('breakEnd')} type="button">Break end</button>
          </div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Live status: <span className="employee-live-status">{statusLabel[currentStatus] || currentStatus}</span></p>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
              <p><span className="text-slate-500">Today's sessions:</span> <span className="font-semibold text-ink">{allSessions.length > 0 ? allSessions.map((s, i) => `${prettyTime(s.loginTime)} - ${s.logoutTime ? prettyTime(s.logoutTime) : '...'}`).join(', ') : '-'}</span></p>
              <p><span className="text-slate-500">Total working hours:</span> <span className="font-semibold text-ink">{formatMinutesToHoursMins(totalWorkingMinutes)}</span></p>
              <p><span className="text-slate-500">Break time (min):</span> <span className="font-semibold text-ink">{attendance.totalBreakMinutes ?? 0}</span></p>
            </div>
            <div className="employee-attendance-graph mt-4">
              <p className="employee-attendance-graph-title">Day activity graph</p>
              {attendanceGraph ? (
                <>
                  {/* ── Bar ── */}
                  <div className="employee-attendance-bar-track" role="img" aria-label="Login to logout timeline">
                    {/* work fill (whole bar = blue) */}
                    <span className="employee-attendance-bar-work" />
                    {/* break overlays (amber) */}
                    {attendanceGraph.breakPct.map((seg, index) => (
                      <span
                        className="employee-attendance-bar-break"
                        key={`break-${index}`}
                        style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                      />
                    ))}
                    {/* live pulse at right edge when not logged out */}
                    {attendanceGraph.isLive && <span className="employee-attendance-bar-live" />}
                  </div>

                  {/* ── Time labels ── */}
                  <div className="employee-attendance-bar-labels">
                    <span className="employee-attendance-bar-label-login">
                      <span className="employee-attendance-label-dot employee-attendance-label-dot-login" />
                      Login · {attendanceGraph.loginTime}
                    </span>
                    <span className="employee-attendance-bar-label-logout">
                      {attendanceGraph.logoutLabel} · {attendanceGraph.logoutTime}
                      <span className="employee-attendance-label-dot employee-attendance-label-dot-logout" />
                    </span>
                  </div>

                  {/* ── Legend ── */}
                  <div className="employee-attendance-bar-legend">
                    <span className="employee-attendance-legend-chip employee-attendance-legend-work">
                      <span className="employee-attendance-legend-swatch employee-attendance-legend-work-swatch" />
                      Work · {formatMinutesToHoursMins(attendanceGraph.totalWorkMin)}
                    </span>
                    {attendanceGraph.totalBreakMin > 0 && (
                      <span className="employee-attendance-legend-chip employee-attendance-legend-break">
                        <span className="employee-attendance-legend-swatch employee-attendance-legend-break-swatch" />
                        Break · {attendanceGraph.totalBreakMin}m
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">No activity recorded for today yet. The graph appears after first login.</p>
              )}
            </div>

          </div>
          {/* Summary Card */}
          <div className="flex-1 min-w-[320px] flex items-center">
            <div className="w-full rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
              <h4 className="text-base font-bold mb-2 text-ink">This Week's Attendance</h4>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{weekSummary?.weekLabel || ''}</p>
              {!weekSummary ? (
                <div className="text-slate-400 text-sm">Loading...</div>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">Present days</span>
                    <span className="font-bold" style={{ color: summaryColors.present }}>{weekSummary.present || 0}</span>
                  </div>
                  <div className="w-full h-2 rounded bg-slate-100 mb-3">
                    <div style={{ width: `${Math.min(100, (weekSummary.present / (weekSummary.totalDays || 5)) * 100)}%`, background: summaryColors.present }} className="h-2 rounded transition-all" />
                  </div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">Leaves</span>
                    <span className="font-bold" style={{ color: summaryColors.leave }}>{weekSummary.leaves || 0}</span>
                  </div>
                  <div className="w-full h-2 rounded bg-slate-100 mb-3">
                    <div style={{ width: `${Math.min(100, (weekSummary.leaves / (weekSummary.totalDays || 5)) * 100)}%`, background: summaryColors.leave }} className="h-2 rounded transition-all" />
                  </div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">Absents</span>
                    <span className="font-bold" style={{ color: summaryColors.absent }}>{weekSummary.absents || 0}</span>
                  </div>
                  <div className="w-full h-2 rounded bg-slate-100 mb-3">
                    <div style={{ width: `${Math.min(100, (weekSummary.absents / (weekSummary.totalDays || 5)) * 100)}%`, background: summaryColors.absent }} className="h-2 rounded transition-all" />
                  </div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">Late days</span>
                    <span className="font-bold" style={{ color: summaryColors.leave }}>{weekSummary.lateDays || 0}</span>
                  </div>
                  <div className="w-full h-2 rounded bg-slate-100 mb-3">
                    <div style={{ width: `${Math.min(100, (weekSummary.lateDays / (weekSummary.totalDays || 5)) * 100)}%`, background: summaryColors.leave }} className="h-2 rounded transition-all" />
                  </div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">Working hours</span>
                    <span className="font-bold" style={{ color: summaryColors.hours }}>{weekSummary.workingHours || 0}</span>
                  </div>
                  <div className="w-full h-2 rounded bg-slate-100 mb-1">
                    <div style={{ width: `${Math.min(100, (weekSummary.workingHours / (weekSummary.maxWorkingHours || 40)) * 100)}%`, background: summaryColors.hours }} className="h-2 rounded transition-all" />
                  </div>
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>Total working days: {weekSummary.totalDays || 5}</span>
                    <span>Max hrs: {weekSummary.maxWorkingHours || 176}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="employee-today-wrap rounded-[1.2rem] border border-slate-200 bg-white p-5 shadow-soft">
          <div className="employee-today-grid">
            <div className="employee-today-list-panel">
              <div className="flex items-start justify-between gap-3">
                <h3 className="employee-today-title text-ink">Today's Tasks</h3>
                <a className="employee-link text-sm font-semibold text-blue-700" href="/employee/tasks">View all</a>
              </div>

              <div className="mt-4 space-y-1">
                {sortedTodayTasks.length === 0 && <p className="text-sm text-slate-500">No tasks assigned.</p>}
                {sortedTodayTasks.slice(0, 4).map((task, index) => {
                  // Determine tag (project or personal)
                  const isPersonal = !task.projectName || task.projectName === 'No project';
                  const tagLabel = isPersonal ? 'Personal' : task.projectName;
                  const tagClass = isPersonal
                    ? 'bg-slate-100 text-slate-600 border border-slate-200'
                    : 'bg-blue-50 text-blue-700 border border-blue-200';
                  return (
                    <article className="employee-today-row" key={task._id}>
                      <input
                        aria-label={`Mark task ${task.title} as checked`}
                        checked={checkedTaskIds.has(task._id)}
                        className="employee-today-check"
                        onChange={() => toggleTaskChecked(task._id)}
                        type="checkbox"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[1.05rem] font-semibold text-slate-950">{task.title}</p>
                        <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-semibold ${tagClass}`}>{tagLabel}</span>
                      </div>
                      <span className={`employee-today-pill ${taskStatusToneClass(task.status, task.priority)} ml-2`}>{taskStatusLabel(task.status, task.priority)}</span>
                      <time className="employee-today-time">{taskTimeLabel(task.deadline, index)}</time>
                    </article>
                  );
                })}
              </div>
            </div>

            <aside className="employee-today-week-panel">
              <h4 className="employee-today-week-title">This week</h4>

              <div className="employee-week-stat-block">
                <div className="employee-week-stat-line"><span>Tasks completed</span><span>{weeklyTaskMetrics.completedRate}%</span></div>
                <div className="employee-week-bar"><span className="employee-week-fill employee-week-fill-completed" style={{ width: `${weeklyTaskMetrics.completedRate}%` }} /></div>
              </div>

              <div className="employee-week-stat-block">
                <div className="employee-week-stat-line"><span>In review</span><span>{weeklyTaskMetrics.inReviewRate}%</span></div>
                <div className="employee-week-bar"><span className="employee-week-fill employee-week-fill-review" style={{ width: `${weeklyTaskMetrics.inReviewRate}%` }} /></div>
              </div>

              <div className="employee-week-stat-block">
                <div className="employee-week-stat-line"><span>Overdue</span><span>{weeklyTaskMetrics.overdueRate}%</span></div>
                <div className="employee-week-bar"><span className="employee-week-fill employee-week-fill-overdue" style={{ width: `${weeklyTaskMetrics.overdueRate}%` }} /></div>
              </div>

              <div className="employee-week-active-projects">
                <p className="employee-week-active-title">{weeklyTaskMetrics.activeProjects} active projects</p>
                <p className="employee-week-active-copy">
                  {weeklyTaskMetrics.projectNames.length > 0
                    ? `You're contributing across ${weeklyTaskMetrics.projectNames.join(', ')}.`
                    : 'You currently have no active projects assigned.'}
                </p>
              </div>
            </aside>
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="employee-workupdate-card rounded-md border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="employee-workupdate-title text-ink">Today's Work Update</h3>
          <form className="employee-workupdate-form mt-4" onSubmit={submitDailyUpdate}>
            <div>
              <label className="employee-workupdate-label" htmlFor="dailyWorkDescription">What did you work on today?</label>
              <textarea className="employee-workupdate-input employee-workupdate-textarea" id="dailyWorkDescription" name="workDescription" onChange={(event) => setDailyForm((prev) => ({ ...prev, workDescription: event.target.value }))} placeholder="Describe your primary tasks..." rows={3} value={dailyForm.workDescription} />
            </div>
            <div>
              <label className="employee-workupdate-label" htmlFor="dailyTimeSpent">Time spent (hours)</label>
              <input className="employee-workupdate-input" id="dailyTimeSpent" name="timeSpent" min="0" onChange={(event) => setDailyForm((prev) => ({ ...prev, timeSpent: event.target.value }))} placeholder="e.g. 8" step="0.5" type="number" value={dailyForm.timeSpent} />
            </div>
            <div>
              <label className="employee-workupdate-label" htmlFor="dailyBlockers">Issues/blockers</label>
              <textarea className="employee-workupdate-input employee-workupdate-textarea" id="dailyBlockers" name="blockers" onChange={(event) => setDailyForm((prev) => ({ ...prev, blockers: event.target.value }))} placeholder="Any hurdles encountered..." rows={2} value={dailyForm.blockers} />
            </div>
            <div>
              <label className="employee-workupdate-label" htmlFor="dailyTomorrowPlan">Tomorrow's plan</label>
              <textarea className="employee-workupdate-input employee-workupdate-textarea" id="dailyTomorrowPlan" name="tomorrowPlan" onChange={(event) => setDailyForm((prev) => ({ ...prev, tomorrowPlan: event.target.value }))} placeholder="Next steps and goals..." rows={2} value={dailyForm.tomorrowPlan} />
            </div>
            <button className="employee-workupdate-submit" disabled={actionBusy === 'dailyUpdate'} type="submit">Submit daily update</button>
          </form>
        </section>

        <section className="employee-notifications-card rounded-md border border-slate-200 bg-white p-5 shadow-soft">
          <div className="employee-notifications-head">
            <h3 className="employee-notifications-title text-ink">Notifications</h3>
            <span className="employee-notifications-unread">{unreadCount} unread</span>
          </div>

          <div className="employee-notifications-list">
            {notificationCards.map((item) => (
              <article className="employee-notification-item" key={item.key}>
                <span className={`employee-notification-dot ${item.toneClass}`} />
                <div className="employee-notification-content">
                  <div className="employee-notification-item-head">
                    <p className="employee-notification-item-title">{item.title}</p>
                    <span className="employee-notification-item-count">{item.count}</span>
                  </div>
                  <p className="employee-notification-item-copy">{item.message}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
      </div>
    </DashboardLayout>
  );
};

export default EmployeeDashboard;
