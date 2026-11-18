import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Search,
  Shield,
  ShieldOff,
  UserCheck,
  UserPlus,
  UserX,
  X,
  Clock,
  Ban,
  Smartphone,
  RotateCcw,
} from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import {
  addApprovedStudentByEmail,
  AppUserProfile,
  isHardcodedAdminEmail,
  resetUserDevices,
  subscribeAllUsers,
  updateUserAccess,
} from '../services/firebase';

interface AdminScreenProps {
  currentUserEmail: string;
  onBack: () => void;
}

export const AdminScreen: React.FC<AdminScreenProps> = ({ currentUserEmail, onBack }) => {
  const [users, setUsers] = useState<AppUserProfile[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  useEffect(() => {
    setIsLoadingUsers(true);
    const unsubscribe = subscribeAllUsers(
      (list) => {
        setUsers(list);
        setIsLoadingUsers(false);
      },
      (err) => {
        setErrorMsg(err.message);
        setIsLoadingUsers(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const pendingUsers = useMemo(
    () => users.filter((u) => u.status === 'pending'),
    [users]
  );

  const approvedUsers = useMemo(
    () => users.filter((u) => u.status === 'approved'),
    [users]
  );

  const blockedUsers = useMemo(
    () => users.filter((u) => u.status === 'blocked'),
    [users]
  );

  const filteredApprovedUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return approvedUsers;
    return approvedUsers.filter(
      (u) => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)
    );
  }, [approvedUsers, searchQuery]);

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedbackMsg(null);
    setIsAddingStudent(true);
    try {
      const outcome = await addApprovedStudentByEmail(newStudentEmail);
      const cleaned = newStudentEmail.trim().toLowerCase();
      setNewStudentEmail('');
      if (outcome === 'created') {
        setFeedbackMsg(`Approved student added: ${cleaned}`);
      } else if (outcome === 'approved') {
        setFeedbackMsg(`Existing user approved: ${cleaned}`);
      } else {
        setFeedbackMsg(`${cleaned} is already a primary admin.`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not add student.');
    } finally {
      setIsAddingStudent(false);
    }
  };

  const handleAction = async (
    targetEmail: string,
    updates: Partial<{ status: 'approved' | 'blocked'; role: 'admin' | 'student' }>,
    successText: string
  ) => {
    setErrorMsg(null);
    setFeedbackMsg(null);
    setBusyEmail(targetEmail);
    try {
      await updateUserAccess(targetEmail, updates);
      setFeedbackMsg(successText);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyEmail(null);
    }
  };

  const handleResetDevices = async (targetEmail: string) => {
    setErrorMsg(null);
    setFeedbackMsg(null);
    setBusyEmail(targetEmail);
    try {
      await resetUserDevices(targetEmail);
      setFeedbackMsg(`Reset devices for ${targetEmail}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not reset devices.');
    } finally {
      setBusyEmail(null);
    }
  };

  const formatLastSeen = (ts?: Timestamp | null) => {
    if (!ts || typeof ts.toDate !== 'function') return 'Unknown';
    return ts.toDate().toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="w-full max-w-xl lg:max-w-5xl mx-auto px-3 sm:px-4 py-2.5 sm:py-4">
      <div className="glass-panel rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 space-y-4">
        {/* Top Row: Back + Title + Counters */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="w-9 h-9 rounded-xl glass-subcard hover:border-app-primary/50 flex items-center justify-center text-app-text hover:text-app-primary transition-colors cursor-pointer shrink-0"
              aria-label="Back to app"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-extrabold tracking-tight text-app-text truncate">
                Admin Access Control
              </h1>
              <p className="text-[11px] sm:text-xs text-app-muted truncate">
                Manage pending requests, approved students, and admin roles.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="glass-subcard rounded-xl px-3 py-1.5 flex items-center gap-1.5 text-xs tabular-nums">
              <Clock className="w-3.5 h-3.5 text-app-gold" />
              <span className="text-app-muted">Pending:</span>
              <strong className="text-app-text font-extrabold">{pendingUsers.length}</strong>
            </div>
            <div className="glass-subcard rounded-xl px-3 py-1.5 flex items-center gap-1.5 text-xs tabular-nums">
              <UserCheck className="w-3.5 h-3.5 text-app-primary" />
              <span className="text-app-muted">Approved:</span>
              <strong className="text-app-text font-extrabold">{approvedUsers.length}</strong>
            </div>
          </div>
        </div>

        {/* Error / Success Alerts */}
        {errorMsg && (
          <div className="p-3 rounded-2xl glass-subcard border-app-accent/40 text-xs text-app-accent flex items-center justify-between gap-2">
            <span className="font-medium break-words">{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="p-1 rounded-lg hover:bg-app-accent/15 cursor-pointer shrink-0"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {feedbackMsg && (
          <div className="p-3 rounded-2xl glass-subcard border-app-primary/40 text-xs text-app-primary flex items-center justify-between gap-2">
            <span className="font-semibold">{feedbackMsg}</span>
            <button
              type="button"
              onClick={() => setFeedbackMsg(null)}
              className="p-1 rounded-lg hover:bg-app-primary/15 cursor-pointer shrink-0"
              aria-label="Dismiss message"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Direct Student Gmail Add Form */}
        <form onSubmit={handleAddStudent} className="glass-subcard rounded-2xl p-3 sm:p-4 space-y-2.5">
          <label
            htmlFor="add-student-email"
            className="text-xs font-bold text-app-text flex items-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5 text-app-primary" />
            <span>Add a student&apos;s Gmail directly (approved immediately)</span>
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="add-student-email"
              type="email"
              value={newStudentEmail}
              onChange={(e) => setNewStudentEmail(e.target.value)}
              placeholder="student@gmail.com"
              className="flex-1 min-h-[42px] px-3 py-2 text-sm glass-subcard rounded-xl text-app-text placeholder-app-muted/65 focus:outline-none focus:border-app-primary focus:ring-2 focus:ring-app-primary/25"
              disabled={isAddingStudent}
              required
            />
            <button
              type="submit"
              disabled={isAddingStudent || !newStudentEmail.trim()}
              className="min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-app-primary to-app-cta-end hover:brightness-110 disabled:opacity-45 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm shadow-app-primary/30 cursor-pointer shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              <span>{isAddingStudent ? 'Adding...' : 'Add Student'}</span>
            </button>
          </div>
        </form>

        {/* Main 2-column grid on desktop, stacked on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Pending Requests */}
          <section className="lg:col-span-5 glass-subcard rounded-2xl p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs sm:text-sm font-bold text-app-text flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-app-gold" />
                <span>Pending Requests ({pendingUsers.length})</span>
              </h2>
            </div>

            {isLoadingUsers ? (
              <div className="py-6 flex justify-center">
                <div className="w-5 h-5 border-2 border-app-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : pendingUsers.length === 0 ? (
              <p className="text-xs text-app-muted py-4 text-center">
                No pending access requests.
              </p>
            ) : (
              <div className="space-y-2">
                {pendingUsers.map((user) => {
                  const isBusy = busyEmail === user.email;
                  return (
                    <div
                      key={user.email}
                      className="p-3 rounded-xl glass-subcard flex flex-col gap-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-bold text-app-text truncate">
                          {user.name}
                        </div>
                        <div className="text-[11px] text-app-muted truncate">{user.email}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleAction(
                              user.email,
                              { status: 'approved' },
                              `Approved ${user.email}`
                            )
                          }
                          className="min-h-[36px] px-2.5 rounded-xl bg-app-primary hover:bg-app-primary-hover disabled:opacity-45 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleAction(
                              user.email,
                              { status: 'blocked', role: 'student' },
                              `Refused ${user.email}`
                            )
                          }
                          className="min-h-[36px] px-2.5 rounded-xl glass-subcard border-app-accent/35 hover:bg-app-accent/15 disabled:opacity-45 text-app-accent text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Refuse</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Approved Students & Users */}
          <section className="lg:col-span-7 glass-subcard rounded-2xl p-3 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-xs sm:text-sm font-bold text-app-text flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-app-primary" />
                <span>Approved Users ({approvedUsers.length})</span>
              </h2>

              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-app-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search students..."
                  className="w-full min-h-[36px] pl-8 pr-3 py-1.5 text-xs glass-subcard rounded-xl text-app-text placeholder-app-muted/65 focus:outline-none focus:border-app-primary"
                />
              </div>
            </div>

            {isLoadingUsers ? (
              <div className="py-6 flex justify-center">
                <div className="w-5 h-5 border-2 border-app-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredApprovedUsers.length === 0 ? (
              <p className="text-xs text-app-muted py-4 text-center">
                {searchQuery.trim() ? 'No matching approved users.' : 'No approved users yet.'}
              </p>
            ) : (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-0.5">
                {filteredApprovedUsers.map((user) => {
                  const isBusy = busyEmail === user.email;
                  const isPrimary = isHardcodedAdminEmail(user.email);
                  const isSelf = user.email === currentUserEmail.toLowerCase();

                  const devices = user.devices ?? [];

                  return (
                    <div
                      key={user.email}
                      className="p-3 rounded-xl glass-subcard space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs sm:text-sm font-bold text-app-text truncate">
                              {user.name}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                user.role === 'admin'
                                  ? 'bg-app-primary/15 text-app-primary border border-app-primary/30'
                                  : 'bg-app-inner text-app-muted border border-app-border'
                              }`}
                            >
                              {isPrimary ? 'Primary Admin' : user.role === 'admin' ? 'Admin' : 'Student'}
                            </span>
                          </div>
                          <div className="text-[11px] text-app-muted truncate">{user.email}</div>
                        </div>

                        {!isPrimary && (
                          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                            {user.role === 'admin' ? (
                              <button
                                type="button"
                                disabled={isBusy || isSelf}
                                onClick={() =>
                                  handleAction(
                                    user.email,
                                    { role: 'student' },
                                    `Removed admin role from ${user.email}`
                                  )
                                }
                                title={isSelf ? 'You cannot remove your own admin role' : undefined}
                                className="min-h-[34px] px-2.5 rounded-xl glass-subcard hover:border-app-primary/50 disabled:opacity-45 text-[11px] font-bold text-app-text hover:text-app-primary flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <ShieldOff className="w-3.5 h-3.5" />
                                <span>Remove admin</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  handleAction(
                                    user.email,
                                    { role: 'admin' },
                                    `Promoted ${user.email} to admin`
                                  )
                                }
                                className="min-h-[34px] px-2.5 rounded-xl glass-subcard hover:border-app-primary/50 disabled:opacity-45 text-[11px] font-bold text-app-primary flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <Shield className="w-3.5 h-3.5" />
                                <span>Make admin</span>
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={isBusy || isSelf}
                              onClick={() =>
                                handleAction(
                                  user.email,
                                  { status: 'blocked', role: 'student' },
                                  `Blocked ${user.email}`
                                )
                              }
                              title={isSelf ? 'You cannot block your own account' : undefined}
                              className="min-h-[34px] px-2.5 rounded-xl glass-subcard border-app-accent/35 hover:bg-app-accent/15 disabled:opacity-45 text-[11px] font-bold text-app-accent flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              <UserX className="w-3.5 h-3.5" />
                              <span>Block</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {user.role === 'student' && (
                        <div className="pt-2 border-t border-app-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="space-y-1 min-w-0">
                            <div className="text-[11px] font-semibold text-app-muted flex items-center gap-1.5">
                              <Smartphone className="w-3.5 h-3.5 text-app-primary shrink-0" />
                              <span>Devices ({devices.length}/2)</span>
                            </div>
                            {devices.length === 0 ? (
                              <div className="text-[11px] text-app-muted/80">
                                No devices registered
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                {devices.map((device) => (
                                  <div
                                    key={device.deviceId}
                                    className="text-[11px] text-app-text flex flex-wrap items-center gap-x-2 gap-y-0.5"
                                  >
                                    <span className="font-semibold">{device.label}</span>
                                    <span className="text-app-muted">
                                      Last seen: {formatLastSeen(device.lastSeen)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            disabled={isBusy || devices.length === 0}
                            onClick={() => handleResetDevices(user.email)}
                            className="min-h-[32px] px-2.5 rounded-xl glass-subcard hover:border-app-primary/50 disabled:opacity-45 text-[11px] font-bold text-app-text hover:text-app-primary flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-center"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Reset devices</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Blocked / Refused Users (shown when present so admins can re-approve if needed) */}
        {blockedUsers.length > 0 && (
          <section className="glass-subcard rounded-2xl p-3 sm:p-4 space-y-2.5">
            <h2 className="text-xs sm:text-sm font-bold text-app-muted flex items-center gap-1.5">
              <Ban className="w-4 h-4 text-app-accent" />
              <span>Blocked / Refused ({blockedUsers.length})</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {blockedUsers.map((user) => {
                const isBusy = busyEmail === user.email;
                return (
                  <div
                    key={user.email}
                    className="p-2.5 rounded-xl glass-subcard flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-app-text truncate">{user.name}</div>
                      <div className="text-[11px] text-app-muted truncate">{user.email}</div>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        handleAction(
                          user.email,
                          { status: 'approved' },
                          `Re-approved ${user.email}`
                        )
                      }
                      className="min-h-[32px] px-2.5 rounded-lg bg-app-primary/15 hover:bg-app-primary text-app-primary hover:text-white text-[11px] font-bold transition-colors cursor-pointer shrink-0 disabled:opacity-45"
                    >
                      Approve
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
