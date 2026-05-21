import { useEffect, useMemo, useState } from 'react';
import DataTable from '../../components/common/DataTable.jsx';
import Modal from '../../components/common/Modal.jsx';
import StatCard from '../../components/common/StatCard.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import { employeeService } from '../../services/employeeService.js';
import { leaveService } from '../../services/leaveService.js';
import ModulePage from '../shared/ModulePage.jsx';

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '-');

const toDateStart = (value) => {
	const date = new Date(value);
	date.setHours(0, 0, 0, 0);
	return date;
};

const toDateEnd = (value) => {
	const date = new Date(value);
	date.setHours(23, 59, 59, 999);
	return date;
};

const computeSummaryFromLeaves = (allLeaves = []) => {
	const now = new Date();
	const todayStart = toDateStart(now);
	const todayEnd = toDateEnd(now);

	const onLeaveToday = new Set(
		allLeaves
			.filter((leave) => {
				if (leave.status !== 'approved') return false;
				const from = leave.fromDate ? new Date(leave.fromDate) : null;
				const to = leave.toDate ? new Date(leave.toDate) : null;
				if (!from || !to) return false;
				return from <= todayEnd && to >= todayStart;
			})
			.map((leave) => String(leave.employeeId?._id || leave.employeeId || ''))
			.filter(Boolean)
	);

	return {
		pendingLeaveRequests: allLeaves.filter((leave) => leave.status === 'pending').length,
		approvedLeaves: allLeaves.filter((leave) => leave.status === 'approved').length,
		rejectedLeaves: allLeaves.filter((leave) => leave.status === 'rejected').length,
		employeesOnLeaveToday: onLeaveToday.size
	};
};

const defaultFilters = {
	employeeId: '',
	status: '',
	leaveType: '',
	fromDate: '',
	toDate: ''
};

const LeaveManagement = () => {
	const [summary, setSummary] = useState({
		pendingLeaveRequests: 0,
		approvedLeaves: 0,
		rejectedLeaves: 0,
		employeesOnLeaveToday: 0
	});
	const [allLeaves, setAllLeaves] = useState([]);
	const [leaves, setLeaves] = useState([]);
	const [employees, setEmployees] = useState([]);
	const [filters, setFilters] = useState(defaultFilters);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	const [selectedLeaveId, setSelectedLeaveId] = useState('');
	const [selectedLeave, setSelectedLeave] = useState(null);
	const [previousLeaves, setPreviousLeaves] = useState([]);
	const [detailLoading, setDetailLoading] = useState(false);
	const [decisionLoading, setDecisionLoading] = useState('');
	const [remarks, setRemarks] = useState('');
	const [detailError, setDetailError] = useState('');

	const leaveTypes = useMemo(() => {
		const types = [...new Set(leaves.map((leave) => leave.leaveType).filter(Boolean))];
		return types.sort((a, b) => a.localeCompare(b));
	}, [leaves]);

	const setFilter = (key, value) => {
		setFilters((current) => ({ ...current, [key]: value }));
	};

	const buildParams = () => ({
		employeeId: filters.employeeId || undefined,
		status: filters.status || undefined,
		leaveType: filters.leaveType || undefined,
		fromDate: filters.fromDate || undefined,
		toDate: filters.toDate || undefined
	});

	const loadSummary = async () => {
		try {
			const { data } = await leaveService.list();
			const rows = data.leaves || [];
			setAllLeaves(rows);
			setSummary(computeSummaryFromLeaves(rows));
		} catch {
			setAllLeaves([]);
			setSummary({
				pendingLeaveRequests: 0,
				approvedLeaves: 0,
				rejectedLeaves: 0,
				employeesOnLeaveToday: 0
			});
		}
	};

	const loadLeaves = async () => {
		setLoading(true);
		setError('');
		try {
			const { data } = await leaveService.list(buildParams());
			setLeaves(data.leaves || []);
		} catch {
			setLeaves([]);
			setError('Unable to load leave requests.');
		} finally {
			setLoading(false);
		}
	};

	const loadDetail = async (leaveRow) => {
		const leaveId = leaveRow?._id;
		if (!leaveId) return;

		setSelectedLeaveId(leaveId);
		setDetailError('');
		setRemarks('');

		// Use list data only to avoid unnecessary failing detail requests.
		setSelectedLeave(leaveRow);
		setPreviousLeaves(
			allLeaves
				.filter((leave) => leave._id !== leaveId && String(leave.employeeId?._id || leave.employeeId) === String(leaveRow.employeeId?._id || leaveRow.employeeId))
				.slice(0, 10)
		);
		setRemarks(leaveRow.adminRemarks || '');
		setDetailLoading(false);
	};

	useEffect(() => {
		Promise.all([employeeService.list(), loadSummary()])
			.then(([employeeResponse]) => {
				setEmployees(employeeResponse.data.employees || []);
			})
			.catch(() => {
				setEmployees([]);
			});
	}, []);

	useEffect(() => {
		loadLeaves();
	}, [filters.employeeId, filters.status, filters.leaveType, filters.fromDate, filters.toDate]);

	const closeDetail = () => {
		setSelectedLeaveId('');
		setSelectedLeave(null);
		setPreviousLeaves([]);
		setRemarks('');
		setDetailError('');
	};

	const handleDecision = async (type) => {
		if (!selectedLeave?._id) return;
		setDecisionLoading(type);
		setError('');

		try {
			const { data } = type === 'approve'
				? await leaveService.approve(selectedLeave._id, { adminRemarks: remarks })
				: await leaveService.reject(selectedLeave._id, { adminRemarks: remarks });

			const updatedLeave = data.leave || selectedLeave;
			setSelectedLeave(updatedLeave);
			setAllLeaves((current) => current.map((leave) => (leave._id === updatedLeave._id ? updatedLeave : leave)));
			setLeaves((current) => current.map((leave) => (leave._id === updatedLeave._id ? updatedLeave : leave)));

			await Promise.all([loadLeaves(), loadSummary()]);
		} catch (err) {
			setError(err.response?.data?.message || 'Unable to update leave request status.');
		} finally {
			setDecisionLoading('');
		}
	};

	return (
		<ModulePage title="Leave Management">
			<section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<StatCard label="Pending leave requests" value={summary.pendingLeaveRequests} />
				<StatCard label="Approved leaves" value={summary.approvedLeaves} />
				<StatCard label="Rejected leaves" value={summary.rejectedLeaves} />
				<StatCard label="Employees on leave today" value={summary.employeesOnLeaveToday} />
			</section>

			<section className="mb-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
				<h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Filters</h2>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<select className="form-field" value={filters.employeeId} onChange={(event) => setFilter('employeeId', event.target.value)}>
						<option value="">All employees</option>
						{employees.map((employee) => (
							<option key={employee._id} value={employee._id}>{employee.userId?.name || employee.employeeCode}</option>
						))}
					</select>

					<select className="form-field" value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
						<option value="">All statuses</option>
						<option value="pending">Pending</option>
						<option value="approved">Approved</option>
						<option value="rejected">Rejected</option>
					</select>

					<select className="form-field" value={filters.leaveType} onChange={(event) => setFilter('leaveType', event.target.value)}>
						<option value="">All leave types</option>
						{leaveTypes.map((type) => (
							<option key={type} value={type}>{type}</option>
						))}
					</select>

					<input className="form-field" type="date" value={filters.fromDate} onChange={(event) => setFilter('fromDate', event.target.value)} />
					<input className="form-field" type="date" value={filters.toDate} onChange={(event) => setFilter('toDate', event.target.value)} />
					<button className="btn-secondary" type="button" onClick={() => setFilters(defaultFilters)}>Reset filters</button>
				</div>
			</section>

			{error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

			<section className="mb-6">
				<h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-700">Leave Requests Table</h2>
				<DataTable
					empty={loading ? 'Loading leave requests...' : 'No leave requests found.'}
					columns={[
						{ key: 'employee', label: 'Employee name', render: (row) => row.employeeId?.userId?.name || row.employeeId?.employeeCode || '-' },
						{ key: 'leaveType', label: 'Leave type' },
						{ key: 'fromDate', label: 'From date', render: (row) => formatDate(row.fromDate) },
						{ key: 'toDate', label: 'To date', render: (row) => formatDate(row.toDate) },
						{ key: 'numberOfDays', label: 'Number of days' },
						{ key: 'reason', label: 'Reason', render: (row) => row.reason || '-' },
						{ key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
						{
							key: 'actions',
							label: 'Actions',
							render: (row) => (
								<div className="flex gap-2">
									<button className="font-bold text-blue-700" type="button" onClick={() => loadDetail(row)}>View details</button>
								</div>
							)
						}
					]}
					rows={leaves}
				/>
			</section>

			{selectedLeaveId && (
				<Modal title="Leave Request Details" onClose={closeDetail}>
					{detailLoading && <p className="text-sm text-slate-500">Loading leave details...</p>}
					  {!detailLoading && detailError && <p className="mb-3 rounded-md bg-amber-50 p-3 text-xs font-semibold text-amber-700">{detailError}</p>}

					{!detailLoading && selectedLeave && (
						<div className="space-y-4">
							<section className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
								<h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Employee details</h3>
								<p><span className="font-bold text-slate-900">Name:</span> {selectedLeave.employeeId?.userId?.name || '-'}</p>
								<p><span className="font-bold text-slate-900">Employee ID:</span> {selectedLeave.employeeId?.employeeCode || '-'}</p>
								<p><span className="font-bold text-slate-900">Department:</span> {selectedLeave.employeeId?.department || '-'}</p>
								<p><span className="font-bold text-slate-900">Designation:</span> {selectedLeave.employeeId?.designation || '-'}</p>
								<p><span className="font-bold text-slate-900">Email:</span> {selectedLeave.employeeId?.userId?.email || '-'}</p>
							</section>

							<section className="rounded-md border border-slate-200 p-3 text-sm">
								<h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Leave reason</h3>
								<p>{selectedLeave.reason || '-'}</p>
							</section>

							<section className="rounded-md border border-slate-200 p-3 text-sm">
								<h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Supporting documents</h3>
								{selectedLeave.attachmentUrl ? (
									<a className="font-bold text-blue-700 underline" href={selectedLeave.attachmentUrl} rel="noreferrer" target="_blank">Open supporting document</a>
								) : (
									<p>No supporting document submitted.</p>
								)}
							</section>

							<section className="rounded-md border border-slate-200 p-3 text-sm">
								<h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Previous leave history</h3>
								{!previousLeaves.length && <p>No previous leave history available.</p>}
								{!!previousLeaves.length && (
									<div className="overflow-x-auto">
										<table className="min-w-full divide-y divide-slate-200 text-sm">
											<thead className="bg-slate-50">
												<tr>
													<th className="px-2 py-2 text-left font-bold text-slate-600">Type</th>
													<th className="px-2 py-2 text-left font-bold text-slate-600">From</th>
													<th className="px-2 py-2 text-left font-bold text-slate-600">To</th>
													<th className="px-2 py-2 text-left font-bold text-slate-600">Days</th>
													<th className="px-2 py-2 text-left font-bold text-slate-600">Status</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-slate-100">
												{previousLeaves.map((history) => (
													<tr key={history._id}>
														<td className="px-2 py-2 text-slate-700">{history.leaveType || '-'}</td>
														<td className="px-2 py-2 text-slate-700">{formatDate(history.fromDate)}</td>
														<td className="px-2 py-2 text-slate-700">{formatDate(history.toDate)}</td>
														<td className="px-2 py-2 text-slate-700">{history.numberOfDays || '-'}</td>
														<td className="px-2 py-2 text-slate-700"><StatusBadge status={history.status} /></td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
							</section>

							<section className="rounded-md border border-slate-200 p-3 text-sm">
								<h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Admin actions</h3>
								<div className="mb-3">
									<label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Add remarks</label>
									<textarea
										className="form-field"
										rows={3}
										value={remarks}
										onChange={(event) => setRemarks(event.target.value)}
										placeholder="Add approval/rejection remarks"
									/>
								</div>

								<div className="flex flex-wrap gap-3">
									<button
										className="btn-primary"
										disabled={decisionLoading === 'approve' || selectedLeave.status === 'approved'}
										type="button"
										onClick={() => handleDecision('approve')}
									>
										{decisionLoading === 'approve' ? 'Approving...' : 'Approve leave'}
									</button>
									<button
										className="btn-secondary"
										disabled={decisionLoading === 'reject' || selectedLeave.status === 'rejected'}
										type="button"
										onClick={() => handleDecision('reject')}
									>
										{decisionLoading === 'reject' ? 'Rejecting...' : 'Reject leave'}
									</button>
									<span className="self-center text-xs font-semibold text-slate-500">
										Current status: <StatusBadge status={selectedLeave.status} />
									</span>
								</div>
							</section>
						</div>
					)}
				</Modal>
			)}
		</ModulePage>
	);
};

export default LeaveManagement;
