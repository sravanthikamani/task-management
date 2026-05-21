import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';

const buildAuthResponse = (user) => ({
  token: generateToken(user._id),
  user: {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    jobTitle: user.jobTitle
  }
});

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, department, jobTitle, phone } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    res.status(409);
    throw new Error('User already exists');
  }

  const user = await User.create({
    name,
    email,
    password,
    role,
    department,
    jobTitle,
    phone
  });

  res.status(201).json(buildAuthResponse(user));
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '').trim();

  if (!normalizedEmail || !normalizedPassword) {
    res.status(400);
    throw new Error('Email and password are required');
  }

  if (normalizedPassword.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters long');
  }

  const user = await User.findOne({ email: normalizedEmail }).select('+password');

  if (!user) {
    res.status(401);
    throw new Error('Invalid email');
  }

  if (!(await user.matchPassword(normalizedPassword))) {
    res.status(401);
    throw new Error('Invalid password');
  }

  if (user.status !== 'active') {
    res.status(403);
    throw new Error('Account is inactive');
  }

  res.json(buildAuthResponse(user));
});

export const getMe = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});
