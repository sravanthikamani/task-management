import asyncHandler from 'express-async-handler';
import LeaveRequest from '../models/LeaveRequest.js';
import Notification from '../models/Notification.js';
import Employee from '../models/Employee.js';
import { ROLES } from '../middleware/roleMiddleware.js';

const leaveDays = (fromDate, toDate) => {
  const start = new Date(fromDate);
  const end = new Date(toDate);
  return Math.floor((end - start) / 86400000) + 1;
};

const isAdmin = (role) => [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(role);

const startOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const applyRange = (query, fromDate, toDate) => {
  if (!fromDate && !toDate) return;
  query.fromDate = {
    $gte: fromDate ? startOfDay(fromDate) : startOfDay('1970-01-01'),
    $lte: toDate ? endOfDay(toDate) : endOfDay(new Date())
  };
};

const parseYear = (value) => {
  const currentYear = new Date().getFullYear();
  const parsed = Number(value || currentYear);
  if (!Number.isInteger(parsed) || parsed < 1970 || parsed > 3000) return currentYear;
  return parsed;
};

const leaveBalanceForEmployee = async (employeeId, year = new Date().getFullYear()) => {
  const start = new Date(year, 0, 1, 0, 0, 0, 0);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  const totalLeave = Number(process.env.DEFAULT_ANNUAL_LEAVE_DAYS || 24);

  const [approvedLeaves, pendingLeaves] = await Promise.all([
    LeaveRequest.aggregate([
      {
        $match: {
          employeeId,
          status: 'approved',
          fromDate: { $lte: end },
          toDate: { $gte: start }
        }
      },
      {
        $group: {
          _id: null,
          usedLeave: { $sum: { $ifNull: ['$numberOfDays', 0] } }
        }
      }
    ]),
    LeaveRequest.aggregate([
      {
        $match: {
          employeeId,
          status: 'pending',
          fromDate: { $lte: end },
          toDate: { $gte: start }
        }
      },
      {
        $group: {
          _id: null,
          pendingLeave: { $sum: { $ifNull: ['$numberOfDays', 0] } }
        }
      }
    ])
  ]);

  const usedLeave = Number(approvedLeaves[0]?.usedLeave || 0);
  const pendingLeave = Number(pendingLeaves[0]?.pendingLeave || 0);

  return {
    year,
    totalLeave,
    usedLeave,
    remainingLeave: Math.max(totalLeave - usedLeave, 0),
    pendingLeave
  };
};

export const getLeaveSummary = asyncHandler(async (req, res) => {
  const todayStart = startOfDay();
  const todayEnd = endOfDay();

  const [pendingLeaveRequests, approvedLeaves, rejectedLeaves, employeesOnLeaveToday] = await Promise.all([
    LeaveRequest.countDocuments({ status: 'pending' }),
    LeaveRequest.countDocuments({ status: 'approved' }),
    LeaveRequest.countDocuments({ status: 'rejected' }),
    LeaveRequest.distinct('employeeId', {
      status: 'approved',
      fromDate: { $lte: todayEnd },
      toDate: { $gte: todayStart }
    }).then((employeeIds) => employeeIds.length)
  ]);

  res.json({
    summary: {
      pendingLeaveRequests,
      approvedLeaves,
      rejectedLeaves,
      employeesOnLeaveToday
    }
  });
});

export const getLeaves = asyncHandler(async (req, res) => {
  const { status, employeeId, leaveType, fromDate, toDate } = req.query;
  const query = isAdmin(req.user.role) ? {} : { employeeId: req.employee?._id };

  if (isAdmin(req.user.role) && employeeId) query.employeeId = employeeId;
  if (status) query.status = status;
  if (leaveType) query.leaveType = leaveType;
  applyRange(query, fromDate, toDate);

  const leaves = await LeaveRequest.find(query)
    .populate({
      path: 'employeeId',
      select: 'employeeCode department designation joiningDate userId',
      populate: { path: 'userId', select: 'name email' }
    })
    .populate('approvedBy', 'name email')
    .sort({ createdAt: -1 });

  res.json({ leaves });
});

export const createLeave = asyncHandler(async (req, res) => {
  if (!req.employee) {
    res.status(400);
    throw new Error('Employee profile required');
  }

  const leaveType = String(req.body.leaveType || '').trim();
  const reason = String(req.body.reason || '').trim();
  const fromDate = req.body.fromDate ? new Date(req.body.fromDate) : null;
  const toDate = req.body.toDate ? new Date(req.body.toDate) : null;

  if (!leaveType || !reason || !fromDate || !toDate || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    res.status(400);
    throw new Error('Leave type, from date, to date, and reason are required');
  }

  if (toDate < fromDate) {
    res.status(400);
    throw new Error('Leave to date cannot be before from date');
  }

  const leave = await LeaveRequest.create({
    leaveType,
    fromDate,
    toDate,
    reason,
    attachmentName: String(req.body.attachmentName || '').trim(),
    attachmentUrl: String(req.body.attachmentUrl || '').trim(),
    employeeId: req.employee._id,
    numberOfDays: leaveDays(fromDate, toDate)
  });
  res.status(201).json({ leave });
});

export const getLeaveBalance = asyncHandler(async (req, res) => {
  const year = parseYear(req.query.year);
  let employeeId = req.employee?._id;

  if (isAdmin(req.user.role) && req.query.employeeId) {
    employeeId = req.query.employeeId;
  }

  if (!employeeId) {
    res.status(400);
    throw new Error('Employee profile required');
  }

  const balance = await leaveBalanceForEmployee(employeeId, year);
  res.json({ balance });
});

export const getLeaveById = asyncHandler(async (req, res) => {
  const leave = await LeaveRequest.findById(req.params.id)
    .populate({
      path: 'employeeId',
      select: 'employeeCode department designation joiningDate email phone userId',
      populate: { path: 'userId', select: 'name email' }
    })
    .populate('approvedBy', 'name email');

  if (!leave) {
    res.status(404);
    throw new Error('Leave request not found');
  }

  const employeeId = String(leave.employeeId?._id || leave.employeeId);
  const isOwner = req.employee?._id && String(req.employee._id) === employeeId;

  if (!isAdmin(req.user.role) && !isOwner) {
    res.status(403);
    throw new Error('Forbidden: insufficient role');
  }

  const previousLeaves = await LeaveRequest.find({
    employeeId,
    _id: { $ne: leave._id },
    fromDate: { $lt: leave.fromDate }
  })
    .sort({ fromDate: -1 })
    .limit(10)
    .select('leaveType fromDate toDate numberOfDays status reason adminRemarks createdAt');

  res.json({ leave, previousLeaves });
});

const updateLeaveDecision = async (req, status) => {
  const leave = await LeaveRequest.findById(req.params.id);
  if (!leave) {
    req.res.status(404);
    throw new Error('Leave request not found');
  }

  leave.status = status;
  leave.adminRemarks = req.body.adminRemarks || '';
  leave.approvedBy = req.user._id;
  await leave.save();

  const employee = await Employee.findById(leave.employeeId);
  if (employee) {
    await Notification.findOneAndUpdate(
      { userId: employee.userId, eventKey: `leave:${status}:${leave._id}` },
      {
        $setOnInsert: {
          userId: employee.userId,
          title: `Leave ${status}`,
          message: `Your leave request was ${status}.`,
          type: 'leave',
          subtype: status === 'approved' ? 'leave_approved' : 'leave_rejected',
          referenceId: leave._id,
          actionPath: '/employee/leaves',
          eventKey: `leave:${status}:${leave._id}`
        }
      },
      { upsert: true }
    );

    if (String(leave.adminRemarks || '').trim()) {
      await Notification.findOneAndUpdate(
        { userId: employee.userId, eventKey: `leave:remarks:${status}:${leave._id}` },
        {
          $setOnInsert: {
            userId: employee.userId,
            title: 'Admin remarks',
            message: `Admin remarks: ${leave.adminRemarks}`,
            type: 'leave',
            subtype: 'leave_admin_remarks',
            referenceId: leave._id,
            actionPath: '/employee/leaves',
            eventKey: `leave:remarks:${status}:${leave._id}`
          }
        },
        { upsert: true }
      );
    }
  }
  return leave;
};

export const approveLeave = asyncHandler(async (req, res) => {
  res.json({ leave: await updateLeaveDecision(req, 'approved') });
});

export const rejectLeave = asyncHandler(async (req, res) => {
  res.json({ leave: await updateLeaveDecision(req, 'rejected') });
});
