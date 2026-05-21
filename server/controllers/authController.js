import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import generateToken from '../utils/generateToken.js';

const publicUser = async (user) => {
  const employee = await Employee.findOne({ userId: user._id }).lean();
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    employee
  };
};

export const login = asyncHandler(async (req, res) => {
  const { identifier, email, password, role } = req.body;
  const lookup = (email || identifier || '').trim();
  const selectedRole = (role || '').trim();
  const normalizedPassword = String(password || '').trim();

  if (!lookup || !normalizedPassword) {
    res.status(400);
    throw new Error('Email or employee ID and password are required');
  }

  if (normalizedPassword.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters long');
  }

  let user = await User.findOne({ email: lookup.toLowerCase() }).select('+passwordHash');

  if (!user) {
    const employee = await Employee.findOne({
      employeeCode: { $regex: `^${lookup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    }).populate('userId', '+passwordHash');
    user = employee?.userId;
  }

  if (!user) {
    res.status(401);
    throw new Error(lookup.includes('@') ? 'Invalid email' : 'Invalid employee ID');
  }

  if (!(await user.matchPassword(normalizedPassword))) {
    res.status(401);
    throw new Error('Invalid password');
  }

  if (selectedRole && user.role !== selectedRole) {
    res.status(403);
    throw new Error('Selected role does not match this account');
  }

  if (user.status !== 'active') {
    res.status(403);
    throw new Error('Account is inactive');
  }

  res.json({
    token: generateToken(user._id),
    user: await publicUser(user)
  });
});

export const logout = asyncHandler(async (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  res.json({ message: 'Password reset flow placeholder. Connect email service before production.' });
});

export const getMe = asyncHandler(async (req, res) => {
  res.json({ user: await publicUser(req.user) });
});
