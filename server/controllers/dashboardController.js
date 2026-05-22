import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Attendance from '../models/Attendance.js';
import Employee from '../models/Employee.js';
import Task from '../models/Task.js';
import Project from '../models/Project.js';
import ProjectMember from '../models/ProjectMember.js';
import Notification from '../models/Notification.js';
import LeaveRequest from '../models/LeaveRequest.js';
import DailyWorkUpdate from '../models/DailyWorkUpdate.js';
import Todo from '../models/Todo.js';
import { dateOnly } from '../utils/calculateHours.js';
import { getAppDayRange } from '../utils/attendanceDate.js';

const startOfDay = (date = new Date()) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};

const endOfDay = (date = new Date()) => {
  const value = startOfDay(date);
  value.setDate(value.getDate() + 1);
  return value;
};

const getSessions = (record) => {
  const sessions = Array.isArray(record?.sessions) ? record.sessions : [];
  if (sessions.length > 0) return sessions;

  // Backward compatibility for legacy records.
  if (record?.loginTime) {
    return [{
      loginTime: record.loginTime,
      logoutTime: record.logoutTime || null,
      durationMinutes: Number(record?.totalWorkingHours || 0) > 0
        ? Math.round(Number(record.totalWorkingHours) * 60)
        : 0
    }];
  }

  return [];
};

const getFirstSession = (record) => {
  const sessions = getSessions(record);
  return sessions.length > 0 ? sessions[0] : null;
};

const getLastSession = (record) => {
  const sessions = getSessions(record);
  return sessions.length > 0 ? sessions[sessions.length - 1] : null;
};

const deriveWorkingHours = (record) => {
  if (Number(record?.totalWorkingHours || 0) > 0) {
    return Number(record.totalWorkingHours);
  }

  const sessions = getSessions(record);
  const totalMinutes = sessions.reduce((sum, session) => {
    if (typeof session?.durationMinutes === 'number' && session.durationMinutes > 0) {
      return sum + session.durationMinutes;
    }

    if (!session?.loginTime || !session?.logoutTime) {
      return sum;
    }

    const start = new Date(session.loginTime);
    const end = new Date(session.logoutTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return sum;
    }

    return sum + Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  }, 0);

  return Number((Math.max(0, totalMinutes - Number(record?.totalBreakMinutes || 0)) / 60).toFixed(2));
};

const projectStatusGroup = (project) => {
  const today = startOfDay();
  const deadline = project.deadline ? new Date(project.deadline) : null;
  const isOverdue = Boolean(deadline && deadline < today && !['completed', 'cancelled', 'archived'].includes(project.status));

  if (isOverdue) return 'overdue';
  if (project.status === 'on_hold') return 'on_hold';
  if (['planning', 'not_started', 'active'].includes(project.status)) return 'active';
  return project.status || 'active';
};

const buildEmployeeProjectCard = (member, stats = { totalTasks: 0, completedTasks: 0 }) => {
  const project = member.projectId;
  if (!project?._id) return null;

  const progressPercentage = stats.totalTasks ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0;

  return {
    _id: project._id,
    projectCode: project.projectCode,
    name: project.name,
    description: project.description || project.requirements || '',
    startDate: project.startDate,
    deadline: project.deadline,
    department: project.department,
    role: member.role || 'member',
    status: projectStatusGroup(project),
    actualStatus: project.status,
    assignedDate: member.assignedDate || member.createdAt,
    progressPercentage,
    taskSummary: {
      total: stats.totalTasks || 0,
      completed: stats.completedTasks || 0
    }
  };
};

export const getDashboardSummary = asyncHandler(async (req, res) => {
  const today = startOfDay();

  // 1. Get all employees
  const totalEmployees = await Employee.countDocuments();
  
  // 2. Get today's attendance
  const todayAttendance = await Attendance.find({ date: today })
    .populate('employeeId')
    .lean();

  const activeEmployeesToday = todayAttendance.filter(a => a.status !== 'absent' && a.status !== 'on_leave').length;
  const loggedInCount = todayAttendance.filter((record) => {
    const firstSession = getFirstSession(record);
    return Boolean(firstSession?.loginTime || record?.loginTime);
  }).length;
  const loggedOutCount = todayAttendance.filter((record) => {
    const lastSession = getLastSession(record);
    return Boolean(lastSession?.logoutTime || record?.logoutTime);
  }).length;
  const absentCount = todayAttendance.filter(a => a.status === 'absent').length;

  // 3. Get all projects
  const totalProjects = await Project.countDocuments();
  const activeProjects = await Project.countDocuments({ status: 'active' });

  // 4. Get all tasks
  const allTasks = await Task.find()
    .populate('assignedTo')
    .populate('projectId')
    .lean();

  const pendingTasks = allTasks.filter(t => !['completed', 'overdue'].includes(t.status)).length;
  const completedTasks = allTasks.filter(t => t.status === 'completed').length;
  const overdueTasks = allTasks.filter(t => t.status === 'overdue' || (t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'completed')).length;
  const highPriorityTasks = allTasks.filter(t => t.priority === 'urgent' || t.priority === 'high').length;

  // 5. Today's assigned tasks
  const todayTasks = allTasks.filter(t => {
    const createdDate = new Date(t.createdAt);
    return createdDate >= today && createdDate < endOfDay();
  });

  // 6. Employees not logged in
  const notLoggedInEmployees = await Employee.find()
    .lean()
    .then(employees => {
      const loggedInIds = new Set(todayAttendance.map(a => a.employeeId._id?.toString()));
      return employees.filter(e => !loggedInIds.has(e._id.toString()));
    });

  // 7. Tasks nearing deadline (next 3 days)
  const threeDaysFromNow = new Date(today);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
  
  const tasksNearingDeadline = allTasks.filter(t => {
    if (!t.dueDate || t.status === 'completed') return false;
    const dueDate = new Date(t.dueDate);
    return dueDate >= today && dueDate <= threeDaysFromNow;
  });

  // 8. Pending leave requests
  const pendingLeaveRequests = await LeaveRequest.find({ status: 'pending' })
    .populate('employeeId')
    .lean();

  // 9. Incomplete daily updates
  const incompleteUpdates = await DailyWorkUpdate.find({ date: today, status: 'draft' })
    .populate('employeeId')
    .lean();

  // 10. Get projects with status overview
  const projectsOverview = await Project.find()
    .select('_id name projectCode status deadline priority assignedTo')
    .populate('managerId', 'userId')
    .lean()
    .limit(10);

  // Count tasks per project for overview
  const projectsWithTaskCounts = await Promise.all(
    projectsOverview.map(async (project) => {
      const totalTasks = await Task.countDocuments({ projectId: project._id });
      const completedTasks = await Task.countDocuments({ projectId: project._id, status: 'completed' });
      const pendingTasks = totalTasks - completedTasks;
      return {
        ...project,
        totalTasks,
        completedTasks,
        pendingTasks
      };
    })
  );

  // 11. Notifications
  const allNotifications = await Notification.find()
    .populate('userId')
    .sort({ createdAt: -1 })
    .lean()
    .limit(10);

  res.json({
    summary: {
      totalEmployees,
      activeEmployeesToday,
      loggedInCount,
      loggedOutCount,
      absentCount,
      totalProjects,
      activeProjects,
      pendingTasks,
      completedTasks,
      overdueTasks,
      highPriorityTasks,
      todayTasksCount: todayTasks.length
    },
    attendance: {
      today: todayAttendance.slice(0, 10),
      notLoggedIn: notLoggedInEmployees.slice(0, 10)
    },
    projects: projectsWithTaskCounts,
    tasks: {
      today: todayTasks.slice(0, 10),
      nearingDeadline: tasksNearingDeadline.slice(0, 10),
      highPriority: allTasks.filter(t => (t.priority === 'urgent' || t.priority === 'high') && t.status !== 'completed').slice(0, 10)
    },
    alerts: {
      notLoggedIn: notLoggedInEmployees.length,
      tasksNearingDeadline: tasksNearingDeadline.length,
      pendingLeaveRequests: pendingLeaveRequests.length,
      incompleteUpdates: incompleteUpdates.length,
      leaveRequests: pendingLeaveRequests.slice(0, 5),
      incompleteUpdatesList: incompleteUpdates.slice(0, 5)
    },
    notifications: allNotifications
  });
});

export const getAttendanceOverview = asyncHandler(async (req, res) => {
  const today = startOfDay();
  const attendance = await Attendance.find({ date: today })
    .populate({
      path: 'employeeId',
      select: 'userId',
      populate: {
        path: 'userId',
        select: 'name email'
      }
    })
    .lean()
    .limit(50);

  const formattedAttendance = attendance.map((record) => {
    const firstSession = getFirstSession(record);
    const lastSession = getLastSession(record);

    return {
      _id: record._id,
      employee: record.employeeId?.userId?.name || 'Unknown',
      loginTime: firstSession?.loginTime || record.loginTime || null,
      logoutTime: lastSession?.logoutTime || record.logoutTime || null,
      totalWorkingHours: deriveWorkingHours(record).toFixed(2),
      status: record.status
    };
  });

  res.json({
    attendance: formattedAttendance,
    total: attendance.length
  });
});

export const getProjectOverview = asyncHandler(async (req, res) => {
  const projects = await Project.find()
    .populate('managerId', 'userId')
    .lean()
    .sort({ createdAt: -1 })
    .limit(20);

  const projectsWithDetails = await Promise.all(
    projects.map(async (project) => {
      const totalTasks = await Task.countDocuments({ projectId: project._id });
      const completedTasks = await Task.countDocuments({ projectId: project._id, status: 'completed' });
      const pendingTasks = totalTasks - completedTasks;
      const assignedEmployees = await Task.distinct('assignedTo', { projectId: project._id });

      return {
        _id: project._id,
        name: project.name,
        projectCode: project.projectCode,
        status: project.status,
        priority: project.priority,
        deadline: project.deadline ? new Date(project.deadline).toLocaleDateString() : 'No deadline',
        assignedEmployeeCount: assignedEmployees.length,
        totalTasks,
        completedTasks,
        pendingTasks,
        progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
      };
    })
  );

  res.json({
    projects: projectsWithDetails,
    total: projectsWithDetails.length
  });
});

export const getEmployeeProjects = asyncHandler(async (req, res) => {
  if (!req.employee) {
    res.status(400);
    throw new Error('Employee profile required');
  }

  const { status } = req.query;
  const projectMembers = await ProjectMember.find({ employeeId: req.employee._id })
    .populate('projectId', 'projectCode name description requirements startDate deadline department status')
    .lean();

  const projectIds = [...new Set(projectMembers.map((member) => member.projectId?._id).filter(Boolean).map((projectId) => String(projectId)))];
  const taskStats = projectIds.length
    ? await Task.aggregate([
        { $match: { projectId: { $in: projectIds.map((projectId) => new mongoose.Types.ObjectId(projectId)) } } },
        {
          $group: {
            _id: '$projectId',
            totalTasks: { $sum: 1 },
            completedTasks: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
          }
        }
      ])
    : [];

  const statsByProject = new Map(taskStats.map((item) => [String(item._id), item]));
  const projects = projectMembers
    .map((member) => buildEmployeeProjectCard(member, statsByProject.get(String(member.projectId?._id)) || { totalTasks: 0, completedTasks: 0 }))
    .filter(Boolean)
    .sort((left, right) => new Date(left.deadline || left.startDate || 0) - new Date(right.deadline || right.startDate || 0));

  const summary = projects.reduce((accumulator, project) => {
    accumulator.total += 1;
    accumulator[project.status] = (accumulator[project.status] || 0) + 1;
    return accumulator;
  }, { total: 0, active: 0, completed: 0, overdue: 0, on_hold: 0 });

  const filteredProjects = status && status !== 'all'
    ? projects.filter((project) => project.status === status)
    : projects;

  res.json({
    projects: filteredProjects,
    summary
  });
});

export const getTaskOverview = asyncHandler(async (req, res) => {
  const today = startOfDay();

  const todayTasks = await Task.find({
    createdAt: { $gte: today, $lt: endOfDay() }
  })
    .populate('assignedTo', 'userId')
    .populate('projectId', 'name')
    .lean();

  const allTasks = await Task.find()
    .populate('assignedTo', 'userId')
    .populate('projectId', 'name')
    .lean();

  const pendingTasks = allTasks.filter(t => !['completed', 'overdue'].includes(t.status));
  const completedTasks = allTasks.filter(t => t.status === 'completed');
  const overdueTasks = allTasks.filter(t => t.status === 'overdue' || (t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'completed'));
  const highPriorityTasks = allTasks.filter(t => (t.priority === 'urgent' || t.priority === 'high') && t.status !== 'completed');

  const formatTasks = (tasks) =>
    tasks.slice(0, 10).map(t => ({
      _id: t._id,
      title: t.title,
      taskCode: t.taskCode,
      assignedTo: t.assignedTo?.userId?.name || 'Unassigned',
      project: t.projectId?.name || 'No Project',
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'No deadline'
    }));

  res.json({
    today: formatTasks(todayTasks),
    pending: formatTasks(pendingTasks),
    completed: formatTasks(completedTasks),
    overdue: formatTasks(overdueTasks),
    highPriority: formatTasks(highPriorityTasks),
    stats: {
      todayCount: todayTasks.length,
      pendingCount: pendingTasks.length,
      completedCount: completedTasks.length,
      overdueCount: overdueTasks.length,
      highPriorityCount: highPriorityTasks.length
    }
  });
});

export const getAlerts = asyncHandler(async (req, res) => {
  const today = startOfDay();

  // Employees not logged in
  const todayAttendance = await Attendance.find({ date: today }).select('employeeId').lean();
  const loggedInIds = new Set(todayAttendance.map(a => a.employeeId?.toString()));
  const notLoggedInEmployees = await Employee.find()
    .select('_id userId')
    .populate('userId', 'name email')
    .lean()
    .then(employees => employees.filter(e => !loggedInIds.has(e._id.toString())));

  // Tasks nearing deadline
  const threeDaysFromNow = new Date(today);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
  const tasksNearingDeadline = await Task.find({
    dueDate: { $gte: today, $lte: threeDaysFromNow },
    status: { $ne: 'completed' }
  })
    .populate('projectId', 'name')
    .populate('assignedTo', 'userId')
    .lean();

  // Overdue projects
  const overdueProjects = await Project.find({
    deadline: { $lt: today },
    status: { $ne: 'completed' }
  })
    .select('name projectCode deadline status')
    .lean();

  // Pending leave requests
  const pendingLeaveRequests = await LeaveRequest.find({ status: 'pending' })
    .populate('employeeId', 'userId')
    .populate('employeeId.userId', 'name')
    .lean();

  // Incomplete daily updates
  const incompleteUpdates = await DailyWorkUpdate.find({
    date: today,
    status: 'draft'
  })
    .populate('employeeId', 'userId')
    .populate('employeeId.userId', 'name')
    .lean();

  res.json({
    alerts: {
      notLoggedIn: {
        count: notLoggedInEmployees.length,
        employees: notLoggedInEmployees.slice(0, 10).map(e => ({
          _id: e._id,
          name: e.userId?.name || 'Unknown',
          email: e.userId?.email || 'N/A'
        }))
      },
      tasksNearingDeadline: {
        count: tasksNearingDeadline.length,
        tasks: tasksNearingDeadline.slice(0, 10).map(t => ({
          _id: t._id,
          title: t.title,
          taskCode: t.taskCode,
          project: t.projectId?.name,
          dueDate: new Date(t.dueDate).toLocaleDateString(),
          assignedTo: t.assignedTo?.userId?.name
        }))
      },
      overdueProjects: {
        count: overdueProjects.length,
        projects: overdueProjects.slice(0, 10).map(p => ({
          _id: p._id,
          name: p.name,
          projectCode: p.projectCode,
          deadline: new Date(p.deadline).toLocaleDateString()
        }))
      },
      leaveRequests: {
        count: pendingLeaveRequests.length,
        requests: pendingLeaveRequests.slice(0, 10).map(lr => ({
          _id: lr._id,
          employee: lr.employeeId?.userId?.name,
          fromDate: new Date(lr.fromDate).toLocaleDateString(),
          toDate: new Date(lr.toDate).toLocaleDateString(),
          leaveType: lr.leaveType
        }))
      },
      incompleteUpdates: {
        count: incompleteUpdates.length,
        employees: incompleteUpdates.slice(0, 10).map(u => ({
          _id: u._id,
          employeeId: u.employeeId?._id,
          employee: u.employeeId?.userId?.name,
          date: new Date(u.date).toLocaleDateString()
        }))
      }
    }
  });
});

export const getEmployeeDashboardOverview = asyncHandler(async (req, res) => {
  if (!req.employee) {
    res.status(400);
    throw new Error('Employee profile required');
  }

  const { start: today, end: nextDay } = getAppDayRange(new Date());

  const [attendance, tasks, projectMembers, todos, dailyUpdate, notifications] = await Promise.all([
    Attendance.findOne({ employeeId: req.employee._id, date: { $gte: today, $lt: nextDay } }).sort({ date: -1, createdAt: -1 }),
    Task.find({ assignedTo: req.employee._id })
      .populate('projectId', 'name deadline')
      .sort({ dueDate: 1, createdAt: -1 })
      .lean(),
    ProjectMember.find({ employeeId: req.employee._id }).populate('projectId', 'name deadline status').lean(),
    Todo.find({ employeeId: req.employee._id })
      .populate('projectId', 'name')
      .populate('taskId', 'title')
      .sort({ dueDate: 1, createdAt: -1 })
      .lean(),
    DailyWorkUpdate.findOne({ employeeId: req.employee._id, date: { $gte: today, $lt: nextDay } })
      .populate('projectId', 'name')
      .populate('taskId', 'title')
      .lean(),
    Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20).lean()
  ]);

  const sessions = Array.isArray(attendance?.sessions) ? attendance.sessions : [];
  const normalizedSessions = (() => {
    if (sessions.length > 0) return sessions;
    if (!attendance?.loginTime) return [];

    const login = new Date(attendance.loginTime);
    const logout = attendance.logoutTime ? new Date(attendance.logoutTime) : null;
    const end = logout || new Date();
    const durationMinutes = Number.isNaN(login.getTime())
      ? 0
      : Math.max(0, Math.round((end - login) / 60000));

    return [{
      loginTime: attendance.loginTime,
      logoutTime: attendance.logoutTime || null,
      durationMinutes
    }];
  })();

  const firstSession = normalizedSessions.length > 0 ? normalizedSessions[0] : null;
  const lastSession = normalizedSessions.length > 0 ? normalizedSessions[normalizedSessions.length - 1] : null;

  const projectIds = [...new Set(projectMembers.map((member) => member.projectId?._id).filter(Boolean).map((id) => String(id)))];
  const projectTaskStats = await Promise.all(
    projectIds.map(async (projectId) => {
      const [totalTasks, completedTasks] = await Promise.all([
        Task.countDocuments({ projectId }),
        Task.countDocuments({ projectId, status: 'completed' })
      ]);
      return { projectId: String(projectId), totalTasks, completedTasks };
    })
  );

  const projectStatsById = new Map(
    projectTaskStats.map((stat) => [stat.projectId, stat])
  );

  const assignedProjects = projectMembers
    .map((member) => {
      const project = member.projectId;
      if (!project?._id) return null;

      const stats = projectStatsById.get(String(project._id)) || { totalTasks: 0, completedTasks: 0 };
      const progress = stats.totalTasks ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0;

      return {
        _id: project._id,
        name: project.name,
        role: member.role || 'member',
        deadline: project.deadline,
        status: project.status,
        progress,
        totalTasks: stats.totalTasks,
        completedTasks: stats.completedTasks
      };
    })
    .filter(Boolean);

  const taskItems = tasks.slice(0, 20).map((task) => ({
    _id: task._id,
    title: task.title,
    projectName: task.projectId?.name || 'No project',
    priority: task.priority,
    deadline: task.dueDate,
    status: task.status
  }));

  const todoGroups = {
    personal: todos.filter((todo) => !todo.projectId && !todo.taskId),
    project: todos.filter((todo) => todo.projectId && !todo.taskId),
    task: todos.filter((todo) => todo.taskId)
  };

  const categorizedNotifications = {
    newTaskAssigned: notifications.filter((item) => item.type === 'task').slice(0, 10),
    deadlineReminder: notifications
      .filter((item) => item.subtype?.includes('deadline') || item.message?.toLowerCase().includes('due'))
      .slice(0, 10),
    adminComments: notifications
      .filter((item) => ['system', 'leave', 'daily_update'].includes(item.type))
      .slice(0, 10),
    projectUpdates: notifications.filter((item) => item.type === 'project').slice(0, 10)
  };

  res.json({
    welcome: {
      employeeName: req.user.name,
      currentDate: today,
      currentStatus: attendance?.status || 'not_logged_in'
    },
    loginLogout: {
      status: attendance?.status || 'not_logged_in',
      loginTime: attendance?.loginTime || firstSession?.loginTime || null,
      logoutTime: attendance?.logoutTime || lastSession?.logoutTime || null,
      sessions: normalizedSessions,
      breakStartTime: attendance?.breakStartTime || null,
      breakEndTime: attendance?.breakEndTime || null,
      breaks: attendance?.breaks || [],
      totalWorkingHours: attendance?.totalWorkingHours || 0,
      totalBreakMinutes: attendance?.totalBreakMinutes || 0
    },
    todayTasks: taskItems,
    assignedProjects,
    todos: {
      all: todos,
      ...todoGroups
    },
    todayWorkUpdate: dailyUpdate || null,
    notifications: {
      all: notifications,
      ...categorizedNotifications
    }
  });
});
