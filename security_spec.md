# HITS SpeakUp Firestore Security Specification

## 1. Data Invariants
- Collection `/users/{userEmail}` is keyed by lowercase email address (`email == userEmail`).
- Allowed fields are strictly `['email', 'name', 'role', 'status', 'createdAt', 'devices']`.
- A regular signed-in user (`email_verified == true`) may ONLY read (`get`) their own `/users/{authEmail}` document and create their own document with `role == 'student'`, `status == 'pending'`, and `devices == []`.
- Hardcoded bootstrap admin `guensopierre101@gmail.com` is always `role == 'admin'` and `status == 'approved'`.
- Approved students (`status == 'approved'`) may ONLY update their own `devices` field to register up to 2 unique devices (`deviceId`, `label`, `firstSeen`, `lastSeen`) or update `lastSeen` on an already-registered `deviceId` (never shrinking `devices`, never replacing an existing `deviceId` or `firstSeen`, never adding >1 device at once, and never changing `role`, `status`, `email`, `name`, or `createdAt`).
- Only approved admins (`role == 'admin' && status == 'approved'`, or `guensopierre101@gmail.com`) can list `/users`, create pre-approved student documents, update `role` / `status`, and empty/reset `devices` (`devices: []`).
- `email` and `createdAt` are immutable after creation; `createdAt` must equal `request.time` on creation.

## 2. Dirty Dozen Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated read**: `get /users/student@gmail.com` with `auth == null`.
2. **Unverified email self-create**: `create /users/student@gmail.com` with `email_verified == false`.
3. **Cross-user PII read**: `get /users/other@gmail.com` as student `student@gmail.com`.
4. **Blanket user list scraping**: `list /users` as approved student `student@gmail.com`.
5. **Self-assign admin role on create**: `create /users/hacker@gmail.com` with `{ role: "admin", status: "pending", ... }`.
6. **Self-approve status on create**: `create /users/hacker@gmail.com` with `{ role: "student", status: "approved", ... }`.
7. **Self-update status/role escalation**: `update /users/student@gmail.com` with `{ status: "approved" }` or `{ role: "admin" }` as student.
8. **Student self-reset / device removal**: `update /users/student@gmail.com` with `{ devices: [] }` or removing an existing device when `existing.devices.size() == 2`.
9. **Student exceeding 2-device limit**: `update /users/student@gmail.com` with `devices.size() == 3`.
10. **Student replacing existing deviceId or tampering with firstSeen**: `update /users/student@gmail.com` changing `devices[0].deviceId` or `devices[0].firstSeen`.
11. **Shadow / ghost field injection**: `create` or `update` including `{ isAdmin: true }` or extra keys inside a device entry `{ deviceId, label, firstSeen, lastSeen, spoof: true }`.
12. **Pending/blocked student device mutation or admin impersonation**: `update /users/student@gmail.com` (`{ devices: [...] }`) while `status == 'pending'` or `'blocked'`, or `list /users` by `{ role: "admin", status: "blocked" }`.
