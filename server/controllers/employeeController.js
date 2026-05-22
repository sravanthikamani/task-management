import asyncHandler from 'express-async-handler';
import Employee from '../models/Employee.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import ProjectMember from '../models/ProjectMember.js';
import Task from '../models/Task.js';
import DailyWorkUpdate from '../models/DailyWorkUpdate.js';
import { getAppDateKey, getAppDayRange } from '../utils/attendanceDate.js';

const minutesBetween = (start, end) => {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
};

const parseHourMinute = (value, fallback = '09:30') => {
  const source = typeof value === 'string' && value.includes(':') ? value : fallback;
  const [rawHour, rawMinute] = source.split(':').map((token) => Number(token));

  const hour = Number.isFinite(rawHour) ? rawHour : Number(fallback.split(':')[0]);
  const minute = Number.isFinite(rawMinute) ? rawMinute : Number(fallback.split(':')[1]);

  return [Math.min(23, Math.max(0, hour)), Math.min(59, Math.max(0, minute))];
};

const dateAtTime = (baseDate, timeValue, fallback = '09:30') => {
  const [hour, minute] = parseHourMinute(timeValue, fallback);
  const value = new Date(baseDate);
  value.setHours(hour, minute, 0, 0);
  return value;
};

const resolveLateThreshold = (employee) => employee?.shiftStartTime || employee?.lateLoginRule || '09:30';

const isLateByShift = (loginTime, attendanceDate, threshold) => {
  if (!loginTime) return false;

  const login = new Date(loginTime);
  if (Number.isNaN(login.getTime())) return false;

  const thresholdDate = dateAtTime(attendanceDate || login, threshold, '09:30');
  return login > thresholdDate;
};

const getEffectiveNowForRecord = (record, now = new Date()) => {
  const recordDate = record?.date ? new Date(record.date) : null;
  if (!recordDate || Number.isNaN(recordDate.getTime())) {
    return now;
  }

  const dayEnd = new Date(recordDate);
  dayEnd.setHours(23, 59, 59, 999);
  return now > dayEnd ? dayEnd : now;
};

const normalizeAttendanceRecord = (record, employee = null) => {
  if (!record) return null;

  const source = typeof record.toObject === 'function' ? record.toObject() : record;
  const effectiveNow = getEffectiveNowForRecord(source, new Date());
  const sessions = Array.isArray(source.sessions) ? source.sessions : [];
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

  const fallbackHours = Number((Math.max(0, totalSessionMinutes - Number(source.totalBreakMinutes || 0)) / 60).toFixed(2));
  const derivedLoginTime = source.loginTime || firstSession?.loginTime || null;
  const derivedLogoutTime = source.logoutTime || lastSession?.logoutTime || null;
  const currentStatus = source.status || 'not_logged_in';
  const lateByShift = ['logged_in', 'logged_out', 'late'].includes(currentStatus)
    && isLateByShift(derivedLoginTime, source?.date || derivedLoginTime, resolveLateThreshold(employee));

  let normalizedStatus = currentStatus;
  if (lateByShift) {
    normalizedStatus = 'late';
  } else if (currentStatus === 'late') {
    normalizedStatus = derivedLogoutTime ? 'logged_out' : 'logged_in';
  }

  return {
    ...source,
    loginTime: derivedLoginTime,
    logoutTime: derivedLogoutTime,
    totalWorkingHours: source.totalWorkingHours > 0 ? source.totalWorkingHours : fallbackHours,
    status: normalizedStatus
  };
};

const dedupeAttendanceHistoryByDay = (records = [], employee = null) => {
  const byDay = new Map();

  records.forEach((record) => {
    const normalized = normalizeAttendanceRecord(record, employee);
    const recordDate = new Date(normalized?.date || normalized?.loginTime || normalized?.createdAt);
    if (Number.isNaN(recordDate.getTime())) {
      return;
    }

    const dayKey = getAppDateKey(recordDate);
    if (!dayKey) {
      return;
    }
    const existing = byDay.get(dayKey);
    if (!existing) {
      byDay.set(dayKey, normalized);
      return;
    }

    const existingUpdated = new Date(existing.updatedAt || existing.createdAt || existing.date || 0).getTime();
    const nextUpdated = new Date(normalized.updatedAt || normalized.createdAt || normalized.date || 0).getTime();
    if (nextUpdated > existingUpdated) {
      byDay.set(dayKey, normalized);
    }
  });

  return [...byDay.values()].sort((left, right) => {
    const leftDate = new Date(left.date || left.createdAt || 0).getTime();
    const rightDate = new Date(right.date || right.createdAt || 0).getTime();
    return rightDate - leftDate;
  });
};

const selfProfilePayload = (employee, user) => ({
  _id: employee._id,
  employeeCode: employee.employeeCode,
  phone: employee.phone || '',
  address: employee.address || '',
  photoUrl: employee.photoUrl || '',
  department: employee.department,
  designation: employee.designation,
  joiningDate: employee.joiningDate,
  reportingManager: employee.reportingManagerId
    ? {
        _id: employee.reportingManagerId._id,
        employeeCode: employee.reportingManagerId.employeeCode,
        name: employee.reportingManagerId.userId?.name || '',
        email: employee.reportingManagerId.userId?.email || '',
        designation: employee.reportingManagerId.designation || ''
      }
    : null,
  user: {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    notificationPreferences: {
      inAppNotifications: user.notificationPreferences?.inAppNotifications ?? true,
      emailNotifications: user.notificationPreferences?.emailNotifications ?? true,
      taskUpdates: user.notificationPreferences?.taskUpdates ?? true,
      leaveUpdates: user.notificationPreferences?.leaveUpdates ?? true
    }
  }
});

const populateEmployee = (query) =>
  query
    .populate('userId', 'name email role status')
    .populate({
      path: 'reportingManagerId',
      select: 'employeeCode designation userId',
      populate: { path: 'userId', select: 'name email' }
    });

export const getEmployees = asyncHandler(async (req, res) => {
  const { search, searchName, searchEmployeeId, department, designation, status } = req.query;
  const employeeQuery = {};

  if (department) employeeQuery.department = department;
  if (designation) employeeQuery.designation = designation;

  let employees = await populateEmployee(Employee.find(employeeQuery).sort({ createdAt: -1 })).lean();

  if (status) employees = employees.filter((employee) => employee.userId?.status === status);

  const normalizedEmployeeId = (searchEmployeeId || '').toLowerCase().trim();
  const normalizedName = (searchName || '').toLowerCase().trim();
  const normalizedSearch = (search || '').toLowerCase().trim();

  if (normalizedEmployeeId) {
    employees = employees.filter((employee) => employee.employeeCode.toLowerCase().includes(normalizedEmployeeId));
  }

  if (normalizedName) {
    employees = employees.filter((employee) => employee.userId?.name?.toLowerCase().includes(normalizedName));
  }

  if (normalizedSearch) {
    employees = employees.filter(
      (employee) =>
        employee.employeeCode.toLowerCase().includes(normalizedSearch) ||
        employee.userId?.name?.toLowerCase().includes(normalizedSearch) ||
        employee.email?.toLowerCase().includes(normalizedSearch) ||
        employee.userId?.email?.toLowerCase().includes(normalizedSearch)
    );
  }

  res.json({ employees });
});

export const createEmployee = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    workEmail,
    temporaryPassword,
    role = 'employee',
    status = 'active',
    employeeCode,
    department,
    designation
  } = req.body;

  const loginEmail = workEmail || email;

  if (['admin', 'super_admin'].includes(role) && req.user.role !== 'super_admin') {
    res.status(403);
    throw new Error('Only Super Admin can add admin users');
  }

  if (!name || !email || !loginEmail || !temporaryPassword || !employeeCode || !department || !designation) {
    res.status(400);
    throw new Error('Name, email, work email, password, employee ID, department, and designation are required');
  }

  if (temporaryPassword.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  const exists = await User.findOne({ email: loginEmail });
  const codeExists = await Employee.findOne({ employeeCode });
  if (exists || codeExists) {
    res.status(409);
    throw new Error('Employee email or employee ID already exists');
  }

  const user = await User.create({ name, email: loginEmail, passwordHash: temporaryPassword, role, status });
  const employee = await Employee.create({ ...req.body, email, userId: user._id });
  res.status(201).json({ employee: await populateEmployee(Employee.findById(employee._id)) });
});

export const getEmployeeById = asyncHandler(async (req, res) => {
  const employee = await populateEmployee(Employee.findById(req.params.id));
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  res.json({ employee });
});

export const updateEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  Object.assign(employee, req.body);
  await employee.save();

  if (req.body.role && ['admin', 'super_admin'].includes(req.body.role) && req.user.role !== 'super_admin') {
    res.status(403);
    throw new Error('Only Super Admin can assign admin roles');
  }

  if (req.body.name || req.body.workEmail || req.body.role || req.body.status) {
    await User.findByIdAndUpdate(employee.userId, {
      ...(req.body.name && { name: req.body.name }),
      ...(req.body.workEmail && { email: req.body.workEmail }),
      ...(req.body.role && { role: req.body.role }),
      ...(req.body.status && { status: req.body.status })
    });
  }

  res.json({ employee: await populateEmployee(Employee.findById(employee._id)) });
});

export const deleteEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }
  await User.findByIdAndDelete(employee.userId);
  await employee.deleteOne();
  res.json({ message: 'Employee deleted' });
});

export const updateEmployeeStatus = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  await User.findByIdAndUpdate(employee.userId, { status: req.body.status });
  res.json({ employee: await populateEmployee(Employee.findById(employee._id)) });
});

export const getEmployeeProfile = asyncHandler(async (req, res) => {
  const employee = await populateEmployee(Employee.findById(req.params.id));
  if (!employee) {
    res.status(404);
    throw new Error('Employee not found');
  }

  const employeeId = employee._id;
  const { start: todayStart, end: todayEnd } = getAppDayRange();

  const [todayAttendance, attendanceHistory, projectMembers, tasks, dailyUpdates] = await Promise.all([
    Attendance.findOne({ employeeId, date: { $gte: todayStart, $lt: todayEnd } }).sort({ date: -1 }),
    Attendance.find({ employeeId }).sort({ date: -1 }).limit(60),
    ProjectMember.find({ employeeId })
      .populate({ path: 'projectId', select: 'name projectCode deadline status department startDate' })
      .sort({ createdAt: -1 }),
    Task.find({ assignedTo: employeeId })
      .populate('projectId', 'name projectCode')
      .sort({ createdAt: -1 }),
    DailyWorkUpdate.find({ employeeId })
      .populate('projectId', 'name')
      .populate('taskId', 'title')
      .sort({ date: -1 })
      .limit(30)
  ]);

  res.json({
    employee,
    todayAttendance: normalizeAttendanceRecord(todayAttendance, employee),
    attendanceHistory: dedupeAttendanceHistoryByDay(attendanceHistory, employee),
    projects: projectMembers
      .filter((pm) => pm.projectId)
      .map((pm) => ({
        _id: pm.projectId._id,
        name: pm.projectId.name,
        projectCode: pm.projectId.projectCode,
        deadline: pm.projectId.deadline,
        status: pm.projectId.status,
        department: pm.projectId.department,
        startDate: pm.projectId.startDate,
        memberRole: pm.role,
        assignedDate: pm.assignedDate || pm.createdAt
      })),
    tasks,
    dailyUpdates
  });
});

export const getMyProfile = asyncHandler(async (req, res) => {
  if (!req.employee || !req.user) {
    res.status(404);
    throw new Error('Employee profile not found for this account');
  }

  const employee = await Employee.findById(req.employee._id).populate({
    path: 'reportingManagerId',
    select: 'employeeCode designation userId',
    populate: { path: 'userId', select: 'name email' }
  });

  if (!employee) {
    res.status(404);
    throw new Error('Employee profile not found');
  }

  const user = await User.findById(req.user._id).select('name email role status notificationPreferences');
  res.json({ profile: selfProfilePayload(employee, user) });
});

export const updateMyProfile = asyncHandler(async (req, res) => {
  if (!req.employee || !req.user) {
    res.status(404);
    throw new Error('Employee profile not found for this account');
  }

  const allowedEmployeeFields = ['phone', 'address', 'photoUrl'];
  const allowedUserFields = ['name', 'email'];

  const employeeUpdates = {};
  allowedEmployeeFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      employeeUpdates[field] = String(req.body[field] || '').trim();
    }
  });

  const userUpdates = {};
  if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
    userUpdates.name = String(req.body.name || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'email')) {
    userUpdates.email = String(req.body.email || '').trim().toLowerCase();
  }

  if (Object.keys(userUpdates).length && userUpdates.email) {
    const existing = await User.findOne({ email: userUpdates.email, _id: { $ne: req.user._id } });
    if (existing) {
      res.status(409);
      throw new Error('Email is already in use by another account');
    }
  }

  if (Object.keys(userUpdates).length && !userUpdates.name && Object.prototype.hasOwnProperty.call(userUpdates, 'name')) {
    res.status(400);
    throw new Error('Name is required');
  }

  if (Object.keys(userUpdates).length && !userUpdates.email && Object.prototype.hasOwnProperty.call(userUpdates, 'email')) {
    res.status(400);
    throw new Error('Email is required');
  }

  if (Object.keys(employeeUpdates).length) {
    await Employee.findByIdAndUpdate(req.employee._id, employeeUpdates, { new: true, runValidators: true });
  }

  if (Object.keys(userUpdates).length) {
    await User.findByIdAndUpdate(req.user._id, userUpdates, { new: true, runValidators: true });
  }

  const employee = await Employee.findById(req.employee._id).populate({
    path: 'reportingManagerId',
    select: 'employeeCode designation userId',
    populate: { path: 'userId', select: 'name email' }
  });
  const user = await User.findById(req.user._id).select('name email role status notificationPreferences');

  res.json({ profile: selfProfilePayload(employee, user) });
});

export const changeMyPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const normalizedCurrent = String(currentPassword || '');
  const normalizedNext = String(newPassword || '');
  const normalizedConfirm = String(confirmPassword || '');

  if (!normalizedCurrent || !normalizedNext || !normalizedConfirm) {
    res.status(400);
    throw new Error('Current password, new password, and confirm password are required');
  }

  if (normalizedNext.length < 6) {
    res.status(400);
    throw new Error('New password must be at least 6 characters');
  }

  if (normalizedNext !== normalizedConfirm) {
    res.status(400);
    throw new Error('New password and confirm password must match');
  }

  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!user || !(await user.matchPassword(normalizedCurrent))) {
    res.status(400);
    throw new Error('Current password is incorrect');
  }

  user.passwordHash = normalizedNext;
  await user.save();

  res.json({ message: 'Password changed successfully' });
});

export const updateMyNotificationPreferences = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const current = user.notificationPreferences || {};
  user.notificationPreferences = {
    inAppNotifications:
      req.body.inAppNotifications === undefined ? (current.inAppNotifications ?? true) : Boolean(req.body.inAppNotifications),
    emailNotifications:
      req.body.emailNotifications === undefined ? (current.emailNotifications ?? true) : Boolean(req.body.emailNotifications),
    taskUpdates: req.body.taskUpdates === undefined ? (current.taskUpdates ?? true) : Boolean(req.body.taskUpdates),
    leaveUpdates: req.body.leaveUpdates === undefined ? (current.leaveUpdates ?? true) : Boolean(req.body.leaveUpdates)
  };

  await user.save();

  res.json({
    notificationPreferences: {
      inAppNotifications: user.notificationPreferences.inAppNotifications,
      emailNotifications: user.notificationPreferences.emailNotifications,
      taskUpdates: user.notificationPreferences.taskUpdates,
      leaveUpdates: user.notificationPreferences.leaveUpdates
    }
  });
});
