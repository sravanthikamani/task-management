import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import FormInput from '../../components/common/FormInput.jsx';
import { getDashboardPath, roleLabels, useAuth } from '../../context/AuthContext.jsx';

const Login = () => {
  const { isAuthenticated, login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ identifier: '', password: '', role: 'employee', remember: true });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to={getDashboardPath(user.role)} replace />;

  const update = (event) => {
    const { name, value, checked, type } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    const payload = {
      ...form,
      identifier: form.identifier.trim(),
      role: form.role.trim(),
      password: form.password.trim()
    };

    if (!payload.identifier || !payload.password) {
      setError('Email or employee ID and password are required');
      return;
    }

    if (payload.password.length < 6) {
      setError('Password must contain at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      const loggedInUser = await login(payload);
      navigate(location.state?.from?.pathname || getDashboardPath(loggedInUser.role), { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Use seeded credentials exactly as documented.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute left-0 top-0 h-72 w-72 -translate-x-20 -translate-y-20 rounded-full bg-blue-300/35 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 translate-x-20 translate-y-20 rounded-full bg-teal-300/30 blur-3xl" style={{ animation: 'float-glow 7s ease-in-out infinite' }} />
      <section className="surface-card-strong page-enter relative w-full max-w-md rounded-3xl p-7 shadow-soft md:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Welcome Back</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Employee Workspace</h1>
        <p className="mt-2 text-sm text-slate-600">Sign in with your role and workspace credentials.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          {error && <p className="rounded-xl border border-red-200 bg-red-50/85 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
          <FormInput label="Email or Employee ID" name="identifier" value={form.identifier} onChange={update} autoCapitalize="none" autoCorrect="off" />
          <div>
            <FormInput
              label="Password"
              name="password"
              type="password"
              value={form.password}
              onChange={update}
              autoCapitalize="none"
              autoCorrect="off"
              minLength={6}
            />
            <p className="mt-1 text-xs font-medium text-slate-500">Minimum password length is 6 characters.</p>
          </div>
          <FormInput
            as="select"
            label="Role"
            name="role"
            value={form.role}
            onChange={update}
            options={Object.entries(roleLabels).map(([value, label]) => ({ value, label }))}
          />
          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 font-semibold text-slate-600">
              <input checked={form.remember} name="remember" type="checkbox" onChange={update} />
              Remember me
            </label>
            <Link className="font-bold text-blue-700 transition hover:text-blue-800" to="/forgot-password">Forgot password?</Link>
          </div>
          <button className="btn-primary w-full" disabled={submitting} type="submit">{submitting ? 'Signing in...' : 'Login'}</button>
       <p>Testing</p> 
        </form>
      </section>
    </main>
  );
};

export default Login;
