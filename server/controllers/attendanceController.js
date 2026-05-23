import asyncHandler from 'express-async-handler';
import Attendance from '../models/Attendance.js';
import Employee from '../models/Employee.js';
import LeaveRequest from '../models/LeaveRequest.js';
import Settings from '../models/Settings.js';
import { calculateWorkingHours, dateOnly, minutesBetween } from '../utils/calculateHours.js';
import { getAppDateAtHourMinute, getAppDateKey, getAppDayRange } from '../utils/attendanceDate.js';

const parseHourMinute = (value, fallback = '09:30') => {
  const source = typeof value === 'string' && value.includes(':') ? value : fallback;
  const [rawHour, rawMinute] = source.split(':').map((token) => Number(token));

  const hour = Number.isFinite(rawHour) ? rawHour : Number(fallback.split(':')[0]);
  const minute = Number.isFinite(rawMinute) ? rawMinute : Number(fallback.split(':')[1]);

  return [Math.min(23, Math.max(0, hour)), Math.min(59, Math.max(0, minute))];
};

const dateAtTime = (baseDate, timeValue, fallback = '09:30') => {
  const [hour, minute] = parseHourMinute(timeValue, fallback);
  return getAppDateAtHourMinute(baseDate, hour, minute);
};

const resolveLateThreshold = (employee, settings) => (
  employee?.shiftStartTime
  || employee?.lateLoginRule
  || settings?.attendanceSettings?.lateLoginLimit
  || settings?.lateLoginLimit
  || '09:30'
);

const isLateByShift = (loginTime, attendanceDate, threshold) => {
  if (!loginTime) return false;

  const login = new Date(loginTime);
  if (Number.isNaN(login.getTime())) return false;

  const thresholdDate = dateAtTime(attendanceDate || login, threshold, '09:30');
  return login > thresholdDate;
};

const getEffectiveNowForRecord = (attendance, now = new Date()) => {
  const recordDate = attendance?.date ? new Date(attendance.date) : null;
  if (!recordDate || Number.isNaN(recordDate.getTime())) {
    return now;
  }

  const dayEnd = new Date(recordDate);
  dayEnd.setHours(23, 59, 59, 999);
  return now > dayEnd ? dayEnd : now;
};

const getDayRange = (value = new Date()) => {
  const { start, end } = getAppDayRange(value);
  return { start, end };
};

const getAttendanceSessions = (attendance) => {
  if (Array.isArray(attendance?.sessions) && attendance.sessions.length > 0) {
    return attendance.sessions;
  }

  if (attendance?.loginTime) {
    return [{
      loginTime: attendance.loginTime,
      logoutTime: attendance.logoutTime || undefined,
      durationMinutes: attendance.logoutTime ? minutesBetween(attendance.loginTime, attendance.logoutTime) : 0
    }];
  }

  return [];
};

const calculateSessionMinutes = (sessions, referenceNow = new Date()) => sessions.reduce((sum, session) => {
  if (!session?.loginTime) {
    return sum;
  }

  if (typeof session.durationMinutes === 'number' && session.durationMinutes > 0) {
    return sum + session.durationMinutes;
  }

  const sessionEnd = session.logoutTime || referenceNow;
  return sum + minutesBetween(session.loginTime, sessionEnd);
}, 0);

const deriveAttendanceTimes = (attendance, now = new Date()) => {
  const sessions = getAttendanceSessions(attendance);
  const firstSession = sessions.length > 0 ? sessions[0] : null;
  const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  const referenceNow = getEffectiveNowForRecord(attendance, now);
  const totalMinutes = Math.max(0, calculateSessionMinutes(sessions, referenceNow) - Number(attendance?.totalBreakMinutes || 0));
  const derivedHours = Number((totalMinutes / 60).toFixed(2));

  return {
    sessions,
    loginTime: attendance?.loginTime || firstSession?.loginTime || null,
    logoutTime: attendance?.logoutTime || lastSession?.logoutTime || null,
    totalWorkingHours: attendance?.totalWorkingHours > 0 ? attendance.totalWorkingHours : derivedHours
  };
};

const normalizeAttendanceRecord = (record, options = {}) => {
  const source = typeof record.toObject === 'function' ? record.toObject() : record;
  const derived = deriveAttendanceTimes(source, options.now || new Date());
  const currentStatus = source?.status || 'not_logged_in';
  const lateThreshold = resolveLateThreshold(options.employee, options.settings);
  const lateByShift = ['logged_in', 'logged_out', 'late'].includes(currentStatus)
    && isLateByShift(derived.loginTime, source?.date || derived.loginTime, lateThreshold);

  let normalizedStatus = currentStatus;
  if (lateByShift) {
    normalizedStatus = 'late';
  } else if (currentStatus === 'late') {
    normalizedStatus = derived.logoutTime ? 'logged_out' : 'logged_in';
  }

  return {
    ...source,
    sessions: derived.sessions,
    loginTime: derived.loginTime,
    logoutTime: derived.logoutTime,
    totalWorkingHours: derived.totalWorkingHours,
    status: normalizedStatus
  };
};

const dedupeAttendanceByDay = (records = [], options = {}) => {
  const byDay = new Map();

  records.forEach((record) => {
    const normalized = normalizeAttendanceRecord(record, options);
    const recordDate = new Date(normalized?.date || normalized?.loginTime || normalized?.createdAt);
    if (Number.isNaN(recordDate.getTime())) {
      return;
    }

    const dayKey = getAppDateKey(recordDate);
    if (!dayKey) {
      return;
    }
    const current = byDay.get(dayKey);
    if (!current) {
      byDay.set(dayKey, normalized);
      return;
    }

    const currentUpdated = new Date(current.updatedAt || current.createdAt || current.date || 0).getTime();
    const nextUpdated = new Date(normalized.updatedAt || normalized.createdAt || normalized.date || 0).getTime();
    if (nextUpdated > currentUpdated) {
      byDay.set(dayKey, normalized);
    }
  });

  return [...byDay.values()].sort((left, right) => {
    const leftDate = new Date(left.date || left.createdAt || 0).getTime();
    const rightDate = new Date(right.date || right.createdAt || 0).getTime();
    return rightDate - leftDate;
  });
};

const requireEmployee = (req) => {
  if (!req.employee) {
    throw new Error('Employee profile required for attendance');
  }
  return req.employee;
};

export const attendanceLogin = asyncHandler(async (req, res) => {
  const employee = requireEmployee(req);
  const { start, end } = getDayRange();
  const attendance = await Attendance.findOne({ employeeId: employee._id, date: { $gte: start, $lt: end } }).sort({ date: -1, createdAt: -1 })
    || new Attendance({ employeeId: employee._id, date: start });

  // If last session is open (no logout), block new login
  const lastSession = attendance.sessions.length > 0 ? attendance.sessions[attendance.sessions.length - 1] : null;
  if (lastSession && !lastSession.logoutTime) {
    res.status(409);
    throw new Error('Already logged in. Please logout before new login.');
  }

  const settings = await Settings.findOne();
  const now = new Date();
  const lateThreshold = resolveLateThreshold(employee, settings);
  const lateDate = dateAtTime(start, lateThreshold, '09:30');

  attendance.sessions.push({ loginTime: now });
  attendance.status = now > lateDate ? 'late' : 'logged_in';
  attendance.ipAddress = req.ip;
  attendance.deviceInfo = req.headers['user-agent'] || '';
  await attendance.save();

  res.status(201).json({ attendance });
});

export const attendanceLogout = asyncHandler(async (req, res) => {
  const employee = requireEmployee(req);
  const { start, end } = getDayRange();
  const attendance = await Attendance.findOne({ employeeId: employee._id, date: { $gte: start, $lt: end } }).sort({ date: -1, createdAt: -1 });

  if (!attendance || attendance.sessions.length === 0) {
    res.status(400);
    throw new Error('Login is required before logout');
  }
  const lastSession = attendance.sessions[attendance.sessions.length - 1];
  if (!lastSession || lastSession.logoutTime) {
    res.status(409);
    throw new Error('No active session to logout');
  }

  const now = new Date();
  const settings = await Settings.findOne();
  const earlyEndTime = employee.shiftEndTime || settings?.attendanceSettings?.workEndTime || settings?.workEndTime || '18:30';
  const shiftEnd = dateAtTime(start, earlyEndTime, '18:30');

  lastSession.logoutTime = now;
  lastSession.durationMinutes = Math.max(0, Math.round((now - new Date(lastSession.loginTime)) / 60000));
  attendance.earlyLogout = now < shiftEnd;
  attendance.status = 'logged_out';
  // Sum all session durations for totalWorkingHours
  const totalSessionMinutes = attendance.sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  attendance.totalWorkingHours = Number(((totalSessionMinutes - (attendance.totalBreakMinutes || 0)) / 60).toFixed(2));
  await attendance.save();

  res.json({ attendance });
});

export const breakStart = asyncHandler(async (req, res) => {
  const employee = requireEmployee(req);
  const { start, end } = getDayRange();
  const attendance = await Attendance.findOne({ employeeId: employee._id, date: { $gte: start, $lt: end } }).sort({ date: -1, createdAt: -1 });
  if (!attendance?.loginTime || attendance.logoutTime) {
    res.status(400);
    throw new Error('Break can start only after login and before logout');
  }
  if (attendance.breakStartTime && !attendance.breakEndTime) {
    res.status(409);
    throw new Error('Break already started');
  }
  attendance.breakStartTime = new Date();
  attendance.breakEndTime = undefined;
  attendance.status = 'on_break';
  await attendance.save();
  res.json({ attendance });
});

export const breakEnd = asyncHandler(async (req, res) => {
  const employee = requireEmployee(req);
  const { start, end } = getDayRange();
  const attendance = await Attendance.findOne({ employeeId: employee._id, date: { $gte: start, $lt: end } }).sort({ date: -1, createdAt: -1 });
  if (!attendance?.breakStartTime || attendance.breakEndTime) {
    res.status(400);
    throw new Error('Break start is required before break end');
  }
  const breakEndedAt = new Date();
  attendance.breakEndTime = breakEndedAt;
  const mins = minutesBetween(attendance.breakStartTime, breakEndedAt);
  attendance.totalBreakMinutes += mins;
  attendance.breaks.push({ startTime: attendance.breakStartTime, endTime: breakEndedAt, durationMinutes: mins });
  attendance.status = 'logged_in';
  await attendance.save();
  res.json({ attendance });
});

export const getTodayAttendance = asyncHandler(async (req, res) => {
  const employee = requireEmployee(req);
  const { start, end } = getDayRange();
  const attendance = await Attendance.findOne({ employeeId: employee._id, date: { $gte: start, $lt: end } }).sort({ date: -1, createdAt: -1 });
  const settings = await Settings.findOne();
  const normalized = attendance ? normalizeAttendanceRecord(attendance, { employee, settings }) : null;

  res.json({ attendance: normalized, status: normalized?.status || 'not_logged_in' });
});

export const getAttendanceHistory = asyncHandler(async (req, res) => {
  const employee = requireEmployee(req);
  const records = await Attendance.find({ employeeId: employee._id }).sort({ date: -1 });
  const settings = await Settings.findOne();

  res.json({ records: dedupeAttendanceByDay(records, { employee, settings }) });
});

export const getAdminAttendance = asyncHandler(async (req, res) => {
  const { employeeId, status, fromDate, toDate, search, department, lateLogin, earlyLogout } = req.query;
  const query = {};

  if (employeeId) query.employeeId = employeeId;
  if (status) query.status = status;
  if (lateLogin === 'true') query.status = 'late';
  if (earlyLogout === 'true') query.earlyLogout = true;

  if (fromDate || toDate) {
    query.date = {};
    if (fromDate) {
      const from = new Date(fromDate);
      if (!Number.isNaN(from.getTime())) query.date.$gte = from;
    }
    if (toDate) {
      const to = new Date(toDate);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        query.date.$lte = to;
      }
    }
    if (!Object.keys(query.date).length) delete query.date;
  }

  let records = await Attendance.find(query)
    .populate({ path: 'employeeId', select: 'employeeCode department designation', populate: { path: 'userId', select: 'name email' } })
    .sort({ date: -1 });

  if (search) {
    const normalized = String(search).toLowerCase().trim();
    records = records.filter((record) =>
      record.employeeId?.employeeCode?.toLowerCase().includes(normalized) ||
      record.employeeId?.userId?.name?.toLowerCase().includes(normalized) ||
      record.employeeId?.userId?.email?.toLowerCase().includes(normalized)
    );
  }

  if (department) {
    const normalized = String(department).toLowerCase().trim();
    records = records.filter((record) => record.employeeId?.department?.toLowerCase() === normalized);
  }

  res.json({ records: records.map(normalizeAttendanceRecord) });
});

export const getAttendanceSummary = asyncHandler(async (req, res) => {
  const targetDate = req.query.date ? new Date(req.query.date) : new Date();
  const day = dateOnly(targetDate);
  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);

  // If employeeId is present, filter by employee
  const { employeeId } = req.query;
  let records = [];
  let totalEmployees = 1;
  let employee = null;
  const settings = await Settings.findOne();
  if (employeeId) {
    // Per-employee summary for the week
    employee = await Employee.findById(employeeId);
    const startOfWeek = new Date(day);
    startOfWeek.setDate(day.getDate() - day.getDay()); // Sunday
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    records = await Attendance.find({ employeeId, date: { $gte: startOfWeek, $lt: endOfWeek } });
    totalEmployees = 1;
  } else {
    // Admin summary for all employees for a single day
    totalEmployees = await (await import('../models/Employee.js')).default.countDocuments();
    records = await Attendance.find({ date: { $gte: day, $lt: nextDay } });
  }

  // Calculate stats
  let present = 0, onLeave = 0, lateLogin = 0, earlyLogoutCount = 0, absent = 0, notMarked = 0, totalWorkingHours = 0;
  if (employeeId) {
    const normalizedRecords = records.map((record) => normalizeAttendanceRecord(record, { employee, settings }));
    const dayNameToIndex = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };

    const configuredOffDays = Array.isArray(employee?.weeklyOffDays) ? employee.weeklyOffDays : [];
    const offDayIndexes = configuredOffDays
      .map((dayName) => dayNameToIndex[String(dayName || '').toLowerCase().trim()])
      .filter((index) => Number.isInteger(index));

    // Fallback to weekend off-days when employee profile has no explicit weekly-off setting.
    const effectiveOffDayIndexes = offDayIndexes.length > 0 ? offDayIndexes : [0, 6];
    const isWorkingDay = (date) => !effectiveOffDayIndexes.includes(date.getDay());

    const startOfWeek = new Date(day);
    startOfWeek.setDate(day.getDate() - day.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    const workingDateKeys = new Set();
    for (let cursor = new Date(startOfWeek); cursor < endOfWeek; cursor.setDate(cursor.getDate() + 1)) {
      const current = new Date(cursor);
      if (isWorkingDay(current)) {
        workingDateKeys.add(current.toISOString().slice(0, 10));
      }
    }

    // Per-employee weekly summary
    present = normalizedRecords.filter((r) => ['logged_in', 'on_break', 'logged_out', 'late'].includes(r.status)).length;
    onLeave = normalizedRecords.filter((r) => r.status === 'on_leave').length;
    lateLogin = normalizedRecords.filter((r) => r.status === 'late').length;
    earlyLogoutCount = normalizedRecords.filter((r) => r.earlyLogout).length;
    absent = normalizedRecords.filter((r) => r.status === 'absent').length;
    const workingDayRecords = normalizedRecords.filter((record) => {
      const recordDate = new Date(record.date || record.loginTime || record.createdAt);
      if (Number.isNaN(recordDate.getTime())) return false;
      return workingDateKeys.has(recordDate.toISOString().slice(0, 10));
    });

    const totalWorkingDays = workingDateKeys.size;
    const minimumWorkingHours = Number(settings?.attendanceSettings?.minimumWorkingHours ?? settings?.minimumWorkingHours ?? 8);

    const overlappingApprovedLeaves = await LeaveRequest.find({
      employeeId,
      status: 'approved',
      fromDate: { $lte: new Date(endOfWeek.getTime() - 1) },
      toDate: { $gte: startOfWeek }
    }).select('fromDate toDate');

    const approvedLeaveDateKeys = new Set();
    overlappingApprovedLeaves.forEach((leave) => {
      const leaveStart = new Date(leave.fromDate);
      const leaveEnd = new Date(leave.toDate);
      if (Number.isNaN(leaveStart.getTime()) || Number.isNaN(leaveEnd.getTime())) return;

      for (const cursor = new Date(leaveStart); cursor <= leaveEnd; cursor.setDate(cursor.getDate() + 1)) {
        const current = new Date(cursor);
        const key = current.toISOString().slice(0, 10);
        if (workingDateKeys.has(key)) {
          approvedLeaveDateKeys.add(key);
        }
      }
    });

    const attendedDateKeys = new Set(
      workingDayRecords
        .filter((record) => ['logged_in', 'on_break', 'logged_out', 'late'].includes(record.status))
        .map((record) => new Date(record.date || record.loginTime || record.createdAt))
        .filter((recordDate) => !Number.isNaN(recordDate.getTime()))
        .map((recordDate) => recordDate.toISOString().slice(0, 10))
    );

    totalWorkingHours = workingDayRecords.reduce((sum, r) => sum + (r.totalWorkingHours || 0), 0);
    const leaveDays = [...approvedLeaveDateKeys].filter((dayKey) => !attendedDateKeys.has(dayKey)).length;
    const inferredAbsentDays = [...workingDateKeys].filter((dayKey) => !attendedDateKeys.has(dayKey) && !approvedLeaveDateKeys.has(dayKey)).length;
    notMarked = inferredAbsentDays;

    res.json({
      summary: {
        present: attendedDateKeys.size,
        leaves: leaveDays,
        absents: inferredAbsentDays,
        lateLogin: workingDayRecords.filter((r) => r.status === 'late').length,
        earlyLogout: workingDayRecords.filter((r) => r.earlyLogout).length,
        workingHours: Number(totalWorkingHours.toFixed(2)),
        totalDays: totalWorkingDays,
        maxWorkingHours: Number((minimumWorkingHours * totalWorkingDays).toFixed(2))
      }
    });
    return;
  } else {
    // Admin summary for a single day
    present = records.filter((r) => ['logged_in', 'on_break', 'logged_out', 'late'].includes(r.status)).length;
    onLeave = records.filter((r) => r.status === 'on_leave').length;
    lateLogin = records.filter((r) => r.status === 'late').length;
    earlyLogoutCount = records.filter((r) => r.earlyLogout).length;
    absent = records.filter((r) => r.status === 'absent').length;
    notMarked = totalEmployees - records.length;
    res.json({
      totalEmployees,
      present,
      absent: absent + notMarked,
      lateLogin,
      earlyLogout: earlyLogoutCount,
      onLeave
    });
  }
});

export const markAbsent = asyncHandler(async (req, res) => {
  const { employeeId, date, remarks } = req.body;
  if (!employeeId || !date) {
    res.status(400);
    throw new Error('employeeId and date are required');
  }
  const day = dateOnly(new Date(date));
  const attendance = await Attendance.findOneAndUpdate(
    { employeeId, date: day },
    { $set: { employeeId, date: day, status: 'absent', remarks: remarks || '' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ attendance });
});

export const exportAttendance = asyncHandler(async (req, res) => {
  const { employeeId, status, fromDate, toDate, department } = req.query;
  const query = {};

  if (employeeId) query.employeeId = employeeId;
  if (status) query.status = status;

  if (fromDate || toDate) {
    query.date = {};
    if (fromDate) {
      const from = new Date(fromDate);
      if (!Number.isNaN(from.getTime())) query.date.$gte = from;
    }
    if (toDate) {
      const to = new Date(toDate);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        query.date.$lte = to;
      }
    }
    if (!Object.keys(query.date).length) delete query.date;
  }

  let records = await Attendance.find(query)
    .populate({ path: 'employeeId', select: 'employeeCode department designation', populate: { path: 'userId', select: 'name email' } })
    .sort({ date: -1 });

  if (department) {
    const normalized = String(department).toLowerCase().trim();
    records = records.filter((r) => r.employeeId?.department?.toLowerCase() === normalized);
  }

  const formatTime = (val) => (val ? new Date(val).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
  const formatDate = (val) => (val ? new Date(val).toLocaleDateString('en-IN') : '');

  const headers = ['Date', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Login Time', 'Logout Time', 'Total Working Hours', 'Break Minutes', 'Status', 'Early Logout', 'Remarks'];
  const rows = records.map((record) => {
    const r = normalizeAttendanceRecord(record);
    return [
      formatDate(r.date),
      r.employeeId?.employeeCode || '',
      r.employeeId?.userId?.name || '',
      r.employeeId?.department || '',
      r.employeeId?.designation || '',
      formatTime(r.loginTime),
      formatTime(r.logoutTime),
      r.totalWorkingHours ?? '',
      r.totalBreakMinutes ?? '',
      r.status || '',
      r.earlyLogout ? 'Yes' : 'No',
      r.remarks || ''
    ];
  });

  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
  res.send(csv);
});

export const updateAttendance = asyncHandler(async (req, res) => {
  const attendance = await Attendance.findById(req.params.id);
  if (!attendance) {
    res.status(404);
    throw new Error('Attendance not found');
  }

  const { loginTime, logoutTime, status, remarks, location } = req.body;
  const hasLoginTime = Object.prototype.hasOwnProperty.call(req.body, 'loginTime');
  const hasLogoutTime = Object.prototype.hasOwnProperty.call(req.body, 'logoutTime');

  if (status !== undefined) attendance.status = status;
  if (remarks !== undefined) attendance.remarks = remarks;
  if (location !== undefined) attendance.location = location;

  if (hasLoginTime || hasLogoutTime) {
    const sessions = getAttendanceSessions(attendance).map((session) => ({
      loginTime: session.loginTime,
      logoutTime: session.logoutTime,
      durationMinutes: session.durationMinutes || 0
    }));

    if (hasLoginTime && loginTime) {
      const parsedLogin = new Date(loginTime);
      if (Number.isNaN(parsedLogin.getTime())) {
        res.status(400);
        throw new Error('Invalid login time');
      }

      if (sessions.length === 0) {
        sessions.push({ loginTime: parsedLogin, logoutTime: undefined, durationMinutes: 0 });
      } else {
        sessions[0].loginTime = parsedLogin;
      }
    }

    if (hasLogoutTime) {
      if (!logoutTime) {
        if (sessions.length > 0) {
          sessions[sessions.length - 1].logoutTime = undefined;
          sessions[sessions.length - 1].durationMinutes = 0;
        }
      } else {
        const parsedLogout = new Date(logoutTime);
        if (Number.isNaN(parsedLogout.getTime())) {
          res.status(400);
          throw new Error('Invalid logout time');
        }
        if (sessions.length === 0) {
          res.status(400);
          throw new Error('Login time is required before logout time');
        }
        sessions[sessions.length - 1].logoutTime = parsedLogout;
      }
    }

    sessions.forEach((session) => {
      session.durationMinutes = session.logoutTime
        ? minutesBetween(session.loginTime, session.logoutTime)
        : 0;
    });

    if (sessions.some((session) => session.logoutTime && new Date(session.logoutTime) < new Date(session.loginTime))) {
      res.status(400);
      throw new Error('Logout time must be after login time');
    }

    attendance.sessions = sessions;
  }

  const derived = deriveAttendanceTimes(attendance);
  attendance.totalWorkingHours = attendance.status === 'logged_out'
    ? derived.totalWorkingHours
    : Number(attendance.totalWorkingHours || 0);

  await attendance.save();

  res.json({ attendance: normalizeAttendanceRecord(attendance) });
});
