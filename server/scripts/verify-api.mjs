const API_BASE = process.env.VERIFY_API_BASE_URL || 'http://localhost:5000/api';

const credentials = {
  admin: {
    email: process.env.VERIFY_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.VERIFY_ADMIN_PASSWORD || 'Admin@123'
  },
  manager: {
    email: process.env.VERIFY_MANAGER_EMAIL || 'manager@example.com',
    password: process.env.VERIFY_MANAGER_PASSWORD || 'Manager@123'
  },
  employee: {
    email: process.env.VERIFY_EMPLOYEE_EMAIL || 'employee3@example.com',
    password: process.env.VERIFY_EMPLOYEE_PASSWORD || 'Employee@123'
  }
};

const failures = [];
const passes = [];

const toUrl = (path) => `${API_BASE}${path}`;

const request = async (method, path, { token, body, okStatuses = [200, 201] } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(toUrl(path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!okStatuses.includes(response.status)) {
    const message = payload?.message || payload?.raw || `HTTP ${response.status}`;
    throw new Error(`${method} ${path} failed (${response.status}): ${message}`);
  }

  return payload;
};

const check = async (name, fn) => {
  try {
    await fn();
    passes.push(name);
    console.log(`OK   ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
  }
};

const run = async () => {
  console.log(`API verification starting against ${API_BASE}`);

  const sessions = {};

  await check('health', async () => {
    const health = await request('GET', '/health', { okStatuses: [200] });
    if (health?.status !== 'ok') {
      throw new Error('Health endpoint did not return status=ok');
    }
  });

  await check('auth admin login', async () => {
    sessions.admin = await request('POST', '/auth/login', {
      body: credentials.admin,
      okStatuses: [200]
    });
    if (!sessions.admin?.token) {
      throw new Error('Admin token missing in login response');
    }
  });

  await check('auth manager login', async () => {
    sessions.manager = await request('POST', '/auth/login', {
      body: credentials.manager,
      okStatuses: [200]
    });
    if (!sessions.manager?.token) {
      throw new Error('Manager token missing in login response');
    }
  });

  await check('auth employee login', async () => {
    sessions.employee = await request('POST', '/auth/login', {
      body: credentials.employee,
      okStatuses: [200]
    });
    if (!sessions.employee?.token) {
      throw new Error('Employee token missing in login response');
    }
  });

  const adminToken = sessions.admin?.token;
  const managerToken = sessions.manager?.token;
  const employeeToken = sessions.employee?.token;
  const employeeId = sessions.employee?.user?.employee?._id;

  await check('admin dashboard summary', async () => {
    await request('GET', '/dashboard/summary', { token: adminToken });
  });

  await check('admin dashboard attendance', async () => {
    await request('GET', '/dashboard/attendance', { token: adminToken });
  });

  await check('admin dashboard projects', async () => {
    await request('GET', '/dashboard/projects', { token: adminToken });
  });

  await check('admin dashboard tasks', async () => {
    await request('GET', '/dashboard/tasks', { token: adminToken });
  });

  await check('admin dashboard alerts', async () => {
    await request('GET', '/dashboard/alerts', { token: adminToken });
  });

  await check('admin employee profile', async () => {
    if (!employeeId) {
      throw new Error('Employee id missing in employee login payload');
    }
    await request('GET', `/employees/${employeeId}/profile`, { token: adminToken });
  });

  await check('manager projects list', async () => {
    await request('GET', '/projects', { token: managerToken });
  });

  await check('manager task summary', async () => {
    await request('GET', '/tasks/summary', { token: managerToken });
  });

  await check('manager tasks under review', async () => {
    await request('GET', '/tasks?status=under_review', { token: managerToken });
  });

  await check('manager review tasks history', async () => {
    await request('GET', '/tasks/completed-history?status=under_review', { token: managerToken });
  });

  await check('manager daily updates', async () => {
    await request('GET', '/daily-updates', { token: managerToken });
  });

  await check('employee today attendance', async () => {
    await request('GET', '/attendance/today', { token: employeeToken });
  });

  await check('employee attendance history', async () => {
    await request('GET', '/attendance/history', { token: employeeToken });
  });

  await check('employee dashboard overview', async () => {
    await request('GET', '/dashboard/employee-overview', { token: employeeToken });
  });

  await check('employee tasks list', async () => {
    await request('GET', '/tasks', { token: employeeToken });
  });

  await check('employee projects list', async () => {
    await request('GET', '/projects', { token: employeeToken });
  });

  await check('employee notifications list', async () => {
    await request('GET', '/notifications', { token: employeeToken });
  });

  let createdTodoId = null;
  await check('employee todo write flow', async () => {
    const unique = `API verify temp ${Date.now()}`;

    const created = await request('POST', '/todos', {
      token: employeeToken,
      body: {
        title: unique,
        description: 'temporary verification todo',
        priority: 'low'
      },
      okStatuses: [201]
    });

    createdTodoId = created?.todo?._id;
    if (!createdTodoId) {
      throw new Error('Todo create response missing todo id');
    }

    const listAfterCreate = await request('GET', '/todos', { token: employeeToken });
    const existsAfterCreate = Array.isArray(listAfterCreate?.todos)
      && listAfterCreate.todos.some((todo) => String(todo?._id) === String(createdTodoId));

    if (!existsAfterCreate) {
      throw new Error('Created todo not found in follow-up list');
    }

    await request('DELETE', `/todos/${createdTodoId}`, {
      token: employeeToken,
      okStatuses: [200]
    });

    const listAfterDelete = await request('GET', '/todos', { token: employeeToken });
    const existsAfterDelete = Array.isArray(listAfterDelete?.todos)
      && listAfterDelete.todos.some((todo) => String(todo?._id) === String(createdTodoId));

    if (existsAfterDelete) {
      throw new Error('Todo still exists after delete');
    }
  });

  if (createdTodoId) {
    await check('employee todo cleanup guard', async () => {
      await request('DELETE', `/todos/${createdTodoId}`, {
        token: employeeToken,
        okStatuses: [200, 404]
      });
    });
  }

  console.log('');
  console.log(`Checks passed: ${passes.length}`);
  console.log(`Checks failed: ${failures.length}`);

  if (failures.length > 0) {
    console.log('');
    console.log('Failed checks:');
    failures.forEach((item) => {
      console.log(`- ${item.name}: ${item.message}`);
    });
    process.exit(1);
  }

  console.log('API verification completed successfully.');
};

run().catch((error) => {
  console.error('Verification script crashed:', error.message);
  process.exit(1);
});
