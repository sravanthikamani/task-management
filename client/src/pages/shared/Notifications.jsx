import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import NotificationItem from '../../components/notifications/NotificationItem.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotifications } from '../../context/NotificationContext.jsx';
import ModulePage from './ModulePage.jsx';

const sections = [
  {
    key: 'deadline_reminder',
    title: 'Deadline Reminders',
    subtypes: ['task_deadline_reminder', 'task_deadline_approaching', 'project_deadline_approaching', 'project_deadline_update', 'deadline_reminder']
  },
  {
    key: 'admin_comments',
    title: 'Admin Comments',
    subtypes: ['leave_admin_remarks', 'task_comment_added', 'admin_comment', 'manager_comment', 'comment_added']
  },
  {
    key: 'attendance',
    title: 'Attendance Notifications',
    subtypes: ['late_login', 'no_login', 'early_logout', 'missing_logout']
  },
  {
    key: 'task',
    title: 'Task Notifications',
    subtypes: ['task_completed', 'task_overdue', 'task_review', 'task_deadline_approaching']
  },
  {
    key: 'project',
    title: 'Project Notifications',
    subtypes: ['project_deadline_approaching', 'project_completed', 'project_delayed', 'milestone_completed']
  },
  {
    key: 'leave',
    title: 'Leave Notifications',
    subtypes: ['leave_requested', 'leave_approved', 'leave_rejected']
  }
];

const employeeSections = [
  {
    key: 'deadline_reminder',
    title: 'Deadline Reminders',
    subtypes: ['task_deadline_reminder', 'task_deadline_approaching', 'project_deadline_approaching', 'project_deadline_update', 'deadline_reminder']
  },
  {
    key: 'admin_comments',
    title: 'Admin Comments',
    subtypes: ['leave_admin_remarks', 'task_comment_added', 'admin_comment', 'manager_comment', 'comment_added']
  },
  {
    key: 'task',
    title: 'Task Notifications',
    subtypes: ['task_assigned', 'task_deadline_reminder', 'task_comment_added', 'task_approved', 'task_reopened']
  },
  {
    key: 'project',
    title: 'Project Notifications',
    subtypes: ['project_added', 'project_deadline_update', 'project_status_changed']
  },
  {
    key: 'attendance',
    title: 'Attendance Notifications',
    subtypes: ['missing_logout_reminder', 'late_login_notice', 'daily_update_reminder']
  },
  {
    key: 'leave',
    title: 'Leave Notifications',
    subtypes: ['leave_approved', 'leave_rejected', 'leave_admin_remarks']
  }
];

const sectionThemeMap = {
  deadline_reminder: {
    sectionClass: 'border-indigo-200 bg-indigo-50/40',
    headingClass: 'text-indigo-900',
    badgeClass: 'bg-indigo-100 text-indigo-700',
    arrowClass: 'text-indigo-700',
    previewClass: 'border-indigo-200 bg-indigo-50'
  },
  admin_comments: {
    sectionClass: 'border-fuchsia-200 bg-fuchsia-50/40',
    headingClass: 'text-fuchsia-900',
    badgeClass: 'bg-fuchsia-100 text-fuchsia-700',
    arrowClass: 'text-fuchsia-700',
    previewClass: 'border-fuchsia-200 bg-fuchsia-50'
  },
  attendance: {
    sectionClass: 'border-amber-200 bg-amber-50/40',
    headingClass: 'text-amber-900',
    badgeClass: 'bg-amber-100 text-amber-700',
    arrowClass: 'text-amber-700',
    previewClass: 'border-amber-200 bg-amber-50'
  },
  task: {
    sectionClass: 'border-cyan-200 bg-cyan-50/40',
    headingClass: 'text-cyan-900',
    badgeClass: 'bg-cyan-100 text-cyan-700',
    arrowClass: 'text-cyan-700',
    previewClass: 'border-cyan-200 bg-cyan-50'
  },
  project: {
    sectionClass: 'border-emerald-200 bg-emerald-50/40',
    headingClass: 'text-emerald-900',
    badgeClass: 'bg-emerald-100 text-emerald-700',
    arrowClass: 'text-emerald-700',
    previewClass: 'border-emerald-200 bg-emerald-50'
  },
  leave: {
    sectionClass: 'border-rose-200 bg-rose-50/40',
    headingClass: 'text-rose-900',
    badgeClass: 'bg-rose-100 text-rose-700',
    arrowClass: 'text-rose-700',
    previewClass: 'border-rose-200 bg-rose-50'
  }
};

const Notifications = ({ title = 'Notifications' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { notifications, loadNotifications, markRead, removeNotification } = useNotifications();
  const [openSections, setOpenSections] = useState(() => new Set());
  const isAdmin = ['admin', 'super_admin'].includes(user?.role);
  const isEmployee = user?.role === 'employee';
  const activeSections = isEmployee ? employeeSections : sections;

  useEffect(() => {
    loadNotifications().catch(() => {});
  }, []);

  useEffect(() => {
    const targetSection = new URLSearchParams(location.search).get('section');
    if (!targetSection) return;

    const sectionExists = activeSections.some((section) => section.key === targetSection);
    if (!sectionExists) return;

    setOpenSections(new Set([targetSection]));
  }, [activeSections, location.search]);

  const grouped = useMemo(() => {
    const bucket = activeSections.reduce((accumulator, section) => ({ ...accumulator, [section.key]: [] }), {});
    notifications.forEach((notification) => {
      const lowerMsg = String(notification?.message || '').toLowerCase();
      const section =
        activeSections.find((item) => item.subtypes.includes(notification.subtype)) ||
        ((lowerMsg.includes('due') || lowerMsg.includes('deadline')) ? activeSections.find((item) => item.key === 'deadline_reminder') : null) ||
        ((notification?.type === 'system' || notification?.type === 'daily_update' || lowerMsg.includes('comment')) ? activeSections.find((item) => item.key === 'admin_comments') : null) ||
        activeSections.find((item) => item.key === notification.type) ||
        (notification.type === 'daily_update' ? activeSections.find((item) => item.key === 'attendance') : null);
      if (section) {
        bucket[section.key].push(notification);
      }
    });
    return bucket;
  }, [activeSections, notifications]);

  const viewDetails = async (notification) => {
    if (!notification.isRead) {
      await markRead(notification._id);
    }
    if (notification.actionPath) {
      navigate(notification.actionPath);
    }
  };

  const removeItem = async (id) => {
    await removeNotification(id);
  };

  const toggleSection = (key) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <ModulePage title={title}>
      {notifications.length === 0 && <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">No notifications available.</p>}

      {isAdmin || isEmployee ? (
        <div className="space-y-5">
          {activeSections.map((section) => {
            const theme = sectionThemeMap[section.key] || {
              sectionClass: 'border-slate-200 bg-white',
              headingClass: 'text-slate-900',
              badgeClass: 'bg-orange-100 text-orange-700',
              arrowClass: 'text-slate-500',
              previewClass: 'border-slate-200 bg-slate-50'
            };
            return (
            <section className={`rounded-md border p-4 shadow-sm ${theme.sectionClass}`} key={section.key}>
              <div className="flex items-center justify-between gap-2">
                <button className="flex flex-1 items-center justify-between gap-3 text-left" type="button" onClick={() => toggleSection(section.key)}>
                  <span className={`text-lg font-black ${theme.headingClass}`}>{section.title}</span>
                  <span className="inline-flex items-center gap-2">
                    <span className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-xs font-extrabold ${theme.badgeClass}`}>{(grouped[section.key] || []).length}</span>
                    <span className={`text-lg font-black ${theme.arrowClass}`}>{openSections.has(section.key) ? '▴' : '▾'}</span>
                  </span>
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {(grouped[section.key] || []).length ? (
                  openSections.has(section.key) ? (
                    (grouped[section.key] || []).map((notification) => (
                      <NotificationItem
                        key={notification._id}
                        notification={notification}
                        onDelete={removeItem}
                        onRead={markRead}
                        onView={viewDetails}
                      />
                    ))
                  ) : (
                    <article className={`rounded-md border p-3 shadow-sm ${theme.previewClass}`}>
                      <h4 className="font-bold text-slate-950">{grouped[section.key][0].title}</h4>
                      <p className="mt-1 text-sm text-slate-600">{grouped[section.key][0].message}</p>
                      <p className="mt-2 text-xs font-semibold uppercase text-slate-500">{grouped[section.key].length} notifications</p>
                    </article>
                  )
                ) : <p className="text-sm text-slate-500">No alerts in this section.</p>}
              </div>
            </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => (
            <NotificationItem
              key={notification._id}
              notification={notification}
              onDelete={removeItem}
              onRead={markRead}
              onView={viewDetails}
            />
          ))}
        </div>
      )}
    </ModulePage>
  );
};

export default Notifications;
