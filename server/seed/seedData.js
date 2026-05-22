import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Attendance from '../models/Attendance.js';
import DailyWorkUpdate from '../models/DailyWorkUpdate.js';
import Employee from '../models/Employee.js';
import LeaveRequest from '../models/LeaveRequest.js';
import Milestone from '../models/Milestone.js';
import Notification from '../models/Notification.js';
import Project from '../models/Project.js';
import ProjectMember from '../models/ProjectMember.js';
import Settings from '../models/Settings.js';
import Task from '../models/Task.js';
import Todo from '../models/Todo.js';
import User from '../models/User.js';
import { calculateWorkingHours, dateOnly } from '../utils/calculateHours.js';

const userSeeds = [
  ['Super Admin', 'superadmin@example.com', 'Admin@123', 'super_admin', 'SA-001', 'Executive', 'System Owner'],
  ['HR Admin', 'admin@example.com', 'Admin@123', 'admin', 'HR-001', 'Human Resources', 'HR Admin'],
  ['Project Manager', 'manager@example.com', 'Manager@123', 'manager', 'PM-001', 'Engineering', 'Project Manager'],
  ['Employee One', 'employee@example.com', 'Employee@123', 'employee', 'EMP-001', 'Engineering', 'Frontend Developer'],
  ['Employee Two', 'employee2@example.com', 'Employee@123', 'employee', 'EMP-002', 'Engineering', 'Backend Developer'],
  ['Employee Three', 'employee3@example.com', 'Employee@123', 'employee', 'EMP-003', 'Design', 'UI Designer'],
  ['Employee Four', 'employee4@example.com', 'Employee@123', 'employee', 'EMP-004', 'QA', 'QA Engineer'],
  ['Employee Five', 'employee5@example.com', 'Employee@123', 'employee', 'EMP-005', 'Operations', 'Ops Associate']
];

const resetCollections = async () => {
  await Promise.all([
    Attendance.deleteMany({}),
    DailyWorkUpdate.deleteMany({}),
    Employee.deleteMany({}),
    LeaveRequest.deleteMany({}),
    Milestone.deleteMany({}),
    Notification.deleteMany({}),
    Project.deleteMany({}),
    ProjectMember.deleteMany({}),
    Settings.deleteMany({}),
    Task.deleteMany({}),
    Todo.deleteMany({}),
    User.deleteMany({})
  ]);
};

const run = async () => {
  await connectDB();
  await resetCollections();

  const employees = [];
  const userByEmail = {};

  for (const [name, email, passwordHash, role, employeeCode, department, designation] of userSeeds) {
    const user = await User.create({ name, email, passwordHash, role, status: 'active' });
    const employee = await Employee.create({
      userId: user._id,
      employeeCode,
      phone: '9876543210',
      address: 'Workspace City',
      department,
      designation,
      reportingManagerId: employees[2]?._id,
      joiningDate: new Date('2025-01-15'),
      employmentType: 'full-time',
      weeklyOffDays: ['Saturday', 'Sunday']
    });
    employees.push(employee);
    userByEmail[email] = user;
  }

  await Settings.create({
    companyName: 'Asiduo Workspace',
    companyAddress: 'Bengaluru, India',
    contactEmail: 'hr@example.com'
  });

  const projects = await Project.insertMany([
    {
      projectCode: 'PRJ-001',
      name: 'Employee Workspace Portal',
      clientName: 'Internal',
      description: 'Core HR and productivity platform.',
      department: 'Engineering',
      startDate: new Date('2026-04-01'),
      deadline: new Date('2026-06-30'),
      estimatedHours: 420,
      priority: 'urgent',
      status: 'active',
      createdBy: userByEmail['superadmin@example.com']._id,
      managerId: employees[2]._id
    },
    {
      projectCode: 'PRJ-002',
      name: 'Client Support Dashboard',
      clientName: '3Energy',
      description: 'Operational dashboard for support workflows.',
      department: 'Engineering',
      startDate: new Date('2026-04-10'),
      deadline: new Date('2026-07-15'),
      estimatedHours: 260,
      priority: 'high',
      status: 'active',
      createdBy: userByEmail['manager@example.com']._id,
      managerId: employees[2]._id
    },
    {
      projectCode: 'PRJ-003',
      name: 'Design System Refresh',
      clientName: 'Internal',
      description: 'Reusable UI system and brand cleanup.',
      department: 'Design',
      startDate: new Date('2026-05-01'),
      deadline: new Date('2026-08-01'),
      estimatedHours: 180,
      priority: 'medium',
      status: 'planning',
      createdBy: userByEmail['manager@example.com']._id,
      managerId: employees[2]._id
    }
  ]);

  await ProjectMember.insertMany(
    projects.flatMap((project) => [employees[2], employees[3], employees[4], employees[5]].map((employee) => ({
      projectId: project._id,
      employeeId: employee._id,
      role: employee._id.equals(employees[2]._id) ? 'manager' : 'member'
    })))
  );

  await Milestone.insertMany(projects.map((project, index) => ({
    projectId: project._id,
    title: `Milestone ${index + 1}`,
    description: 'First delivery checkpoint',
    dueDate: new Date('2026-06-01'),
    responsibleEmployeeId: employees[2]._id,
    status: index === 0 ? 'in_progress' : 'pending'
  })));

  const taskStatuses = ['to_do', 'in_progress', 'under_review', 'completed', 'reopened'];
  const tasks = [];
  for (let index = 0; index < 10; index += 1) {
    tasks.push(await Task.create({
      taskCode: `TSK-${String(index + 1).padStart(3, '0')}`,
      projectId: projects[index % projects.length]._id,
      title: `Workspace task ${index + 1}`,
      description: 'Seeded task for project and employee workflow testing.',
      assignedTo: employees[3 + (index % 5)]._id,
      assignedBy: userByEmail['manager@example.com']._id,
      department: employees[3 + (index % 5)].department,
      priority: ['low', 'medium', 'high', 'urgent'][index % 4],
      startDate: new Date('2026-05-01'),
      dueDate: new Date(`2026-05-${String(10 + index).padStart(2, '0')}`),
      estimatedHours: 8 + index,
      status: taskStatuses[index % taskStatuses.length],
      completedAt: taskStatuses[index % taskStatuses.length] === 'completed' ? new Date() : undefined,
      approvedBy: taskStatuses[index % taskStatuses.length] === 'completed' ? userByEmail['manager@example.com']._id : undefined
    }));
  }

  const today = dateOnly();
  const login = new Date(today);
  login.setHours(9, 35, 0, 0);
  const logout = new Date(today);
  logout.setHours(18, 20, 0, 0);

  await Attendance.insertMany(employees.slice(3).map((employee, index) => {
    const isCompletedDay = index < 2;
    const isLoggedInDay = index < 4;

    const sessions = isLoggedInDay
      ? [{
          loginTime: login,
          logoutTime: isCompletedDay ? logout : undefined,
          durationMinutes: isCompletedDay
            ? Math.max(0, Math.round((logout.getTime() - login.getTime()) / 60000))
            : 0
        }]
      : [];

    return {
      employeeId: employee._id,
      date: today,
      sessions,
      totalBreakMinutes: isCompletedDay ? 45 : 0,
      totalWorkingHours: isCompletedDay ? calculateWorkingHours(login, logout, 45) : 0,
      status: isCompletedDay ? 'logged_out' : isLoggedInDay ? 'logged_in' : 'absent',
      remarks: 'Seed attendance'
    };
  }));

  await Todo.insertMany(tasks.slice(0, 5).map((task, index) => ({
    employeeId: task.assignedTo,
    projectId: task.projectId,
    taskId: task._id,
    title: `Follow up ${index + 1}`,
    description: 'Seed todo linked to assigned work.',
    priority: task.priority,
    dueDate: task.dueDate,
    status: index === 0 ? 'completed' : 'pending',
    completedAt: index === 0 ? new Date() : undefined
  })));

  await DailyWorkUpdate.insertMany(tasks.slice(0, 3).map((task, index) => ({
    employeeId: task.assignedTo,
    projectId: task.projectId,
    taskId: task._id,
    date: today,
    workDescription: `Worked on ${task.title}`,
    timeSpent: 3 + index,
    completedWork: 'Completed planned implementation slice',
    pendingWork: 'Review and cleanup',
    blockers: index === 1 ? 'Waiting on API clarification' : '',
    tomorrowPlan: 'Continue assigned milestone work',
    status: 'submitted'
  })));

  await LeaveRequest.create({
    employeeId: employees[4]._id,
    leaveType: 'Casual Leave',
    fromDate: new Date('2026-05-12'),
    toDate: new Date('2026-05-13'),
    numberOfDays: 2,
    reason: 'Personal work',
    status: 'pending'
  });

  await Notification.insertMany([
    {
      userId: userByEmail['employee@example.com']._id,
      title: 'Task assigned',
      message: 'A new workspace task was assigned to you.',
      type: 'task',
      referenceId: tasks[0]._id
    },
    {
      userId: userByEmail['admin@example.com']._id,
      title: 'Leave requested',
      message: 'Employee Two requested leave.',
      type: 'leave'
    },
    {
      userId: userByEmail['manager@example.com']._id,
      title: 'Review pending',
      message: 'A task is waiting for manager review.',
      type: 'task',
      referenceId: tasks[2]._id
    }
  ]);

  console.log('Seed data created successfully.');
  console.log('Super Admin: superadmin@example.com / Admin@123');
  console.log('Admin: admin@example.com / Admin@123');
  console.log('Project Manager: manager@example.com / Manager@123');
  console.log('Employee: employee@example.com / Employee@123');

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
