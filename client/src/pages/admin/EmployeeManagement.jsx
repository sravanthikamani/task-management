import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../../components/common/DataTable.jsx';
import SearchFilterBar from '../../components/common/SearchFilterBar.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import ModulePage from '../shared/ModulePage.jsx';
import { employeeService } from '../../services/employeeService.js';

const ActionIcon = ({ title, children, tone = 'slate' }) => {
  const toneClasses = {
    blue: 'text-blue-700 hover:border-blue-200 hover:bg-blue-50',
    amber: 'text-amber-700 hover:border-amber-200 hover:bg-amber-50',
    red: 'text-red-700 hover:border-red-200 hover:bg-red-50',
    slate: 'text-slate-700 hover:border-slate-300 hover:bg-slate-100'
  };

  return (
    <span
      aria-label={title}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white transition ${toneClasses[tone]}`}
      title={title}
    >
      {children}
    </span>
  );
};

const EmployeeManagement = () => {
  const [employees, setEmployees] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [searchName, setSearchName] = useState('');
  const [searchEmployeeId, setSearchEmployeeId] = useState('');
  const [filters, setFilters] = useState({ department: '', designation: '', status: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadEmployees = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await employeeService.list({
        searchName: searchName || undefined,
        searchEmployeeId: searchEmployeeId || undefined,
        department: filters.department || undefined,
        designation: filters.designation || undefined,
        status: filters.status || undefined
      });
      setEmployees(data.employees || []);
    } catch (err) {
      setEmployees([]);
      setError('Unable to load employees. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
  }, [searchName, searchEmployeeId, filters.department, filters.designation, filters.status]);

  useEffect(() => {
    employeeService.list().then(({ data }) => setAllEmployees(data.employees || [])).catch(() => setAllEmployees([]));
  }, []);

  const departments = useMemo(() => [...new Set(allEmployees.map((employee) => employee.department).filter(Boolean))], [allEmployees]);
  const designations = useMemo(() => [...new Set(allEmployees.map((employee) => employee.designation).filter(Boolean))], [allEmployees]);

  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleDelete = async (employeeId, employeeName) => {
    const confirmed = window.confirm(`Delete ${employeeName || 'this employee'}? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      await employeeService.remove(employeeId);
      await loadEmployees();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to delete employee.');
    }
  };

  const handleToggleStatus = async (employeeId, currentStatus) => {
    const nextStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      await employeeService.status(employeeId, nextStatus);
      await loadEmployees();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to update employee status.');
    }
  };

  return (
    <ModulePage title="Employee Management" actions={<Link className="btn-primary" to="/admin/employees/add">Add employee</Link>}>
      <SearchFilterBar search={searchName} setSearch={setSearchName}>
        <input
          className="form-field md:max-w-xs"
          placeholder="Search by employee ID"
          value={searchEmployeeId}
          onChange={(event) => setSearchEmployeeId(event.target.value)}
        />
        <select className="form-field md:max-w-xs" value={filters.department} onChange={(event) => setFilter('department', event.target.value)}>
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department} value={department}>{department}</option>
          ))}
        </select>
        <select className="form-field md:max-w-xs" value={filters.designation} onChange={(event) => setFilter('designation', event.target.value)}>
          <option value="">All designations</option>
          {designations.map((designation) => (
            <option key={designation} value={designation}>{designation}</option>
          ))}
        </select>
        <select className="form-field md:max-w-xs" value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </SearchFilterBar>
      {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <DataTable
        empty={loading ? 'Loading employees...' : 'No employees found.'}
        columns={[
          { key: 'employeeCode', label: 'Employee ID' },
          { key: 'name', label: 'Employee name', render: (row) => row.userId?.name || '-' },
          { key: 'email', label: 'Work email', render: (row) => row.userId?.email },
          { key: 'phone', label: 'Phone number', render: (row) => row.phone || '-' },
          { key: 'designation', label: 'Designation' },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.userId?.status} /> },
          {
            key: 'actions',
            label: 'Action buttons',
            render: (row) => (
              <div className="grid grid-cols-4 gap-2">
                <Link aria-label="View profile" title="View profile" to={`/admin/employees/${row._id}`}>
                  <ActionIcon title="View profile" tone="blue">
                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </ActionIcon>
                </Link>
                <Link aria-label="Edit details" title="Edit details" to={`/admin/employees/${row._id}/edit`}>
                  <ActionIcon title="Edit details">
                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="m12 20 9-9-3-3-9 9-2 5 5-2Z" />
                      <path d="M16 5 19 8" />
                    </svg>
                  </ActionIcon>
                </Link>
                <Link aria-label="Assign project" title="Assign project" to={`/admin/assign-projects?employeeId=${row._id}`}>
                  <ActionIcon title="Assign project">
                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                      <rect height="7" width="7" x="3" y="3" rx="1" />
                      <rect height="7" width="7" x="14" y="3" rx="1" />
                      <rect height="7" width="7" x="14" y="14" rx="1" />
                      <path d="M7 10v4a4 4 0 0 0 4 4h3" />
                    </svg>
                  </ActionIcon>
                </Link>
                <Link aria-label="Assign task" title="Assign task" to={`/admin/assign-tasks?employeeId=${row._id}`}>
                  <ActionIcon title="Assign task">
                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M9 11 12 14 22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                  </ActionIcon>
                </Link>
                <Link aria-label="View attendance" title="View attendance" to={`/admin/attendance?employeeId=${row._id}`}>
                  <ActionIcon title="View attendance">
                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                  </ActionIcon>
                </Link>
                <button
                  aria-label={row.userId?.status === 'active' ? 'Deactivate employee' : 'Activate employee'}
                  className="inline-flex"
                  title={row.userId?.status === 'active' ? 'Deactivate' : 'Activate'}
                  type="button"
                  onClick={() => handleToggleStatus(row._id, row.userId?.status)}
                >
                  <ActionIcon title={row.userId?.status === 'active' ? 'Deactivate' : 'Activate'} tone="amber">
                    {row.userId?.status === 'active' ? (
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    ) : (
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </ActionIcon>
                </button>
                <button
                  aria-label="Delete employee"
                  className="inline-flex"
                  title="Delete"
                  type="button"
                  onClick={() => handleDelete(row._id, row.userId?.name)}
                >
                  <ActionIcon title="Delete" tone="red">
                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </ActionIcon>
                </button>
              </div>
            )
          }
        ]}
        rows={employees}
      />
    </ModulePage>
  );
};

export default EmployeeManagement;
