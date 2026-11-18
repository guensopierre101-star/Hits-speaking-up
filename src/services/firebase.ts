import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const ADMIN_EMAILS = ['guensopierre101@gmail.com'];

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export type UserRole = 'admin' | 'student';
export type UserStatus = 'pending' | 'approved' | 'blocked';

export interface DeviceEntry {
  deviceId: string;
  label: string;
  firstSeen: Timestamp;
  lastSeen: Timestamp;
}

export interface AppUserProfile {
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  devices: DeviceEntry[];
  createdAt?: Timestamp | null;
}

export const MAX_STUDENT_DEVICES = 2;
const DEVICE_ID_STORAGE_KEY = 'hits_speakup_device_id_v1';
let memoryFallbackDeviceId: string | null = null;

function generateRandomDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getOrCreateBrowserDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
      return existing;
    }
    const created = generateRandomDeviceId().slice(0, 64);
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    if (!memoryFallbackDeviceId) {
      memoryFallbackDeviceId = generateRandomDeviceId().slice(0, 64);
    }
    return memoryFallbackDeviceId;
  }
}

export function getReadableDeviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  let os = 'Browser';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/CrOS/i.test(ua)) os = 'Chromebook';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = '';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/CriOS/i.test(ua)) browser = 'Chrome';
  else if (/FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  const label = browser ? `${os} ${browser}` : os;
  return label.slice(0, 60) || 'Browser';
}

function parseDevices(raw: unknown): DeviceEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is DeviceEntry =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as DeviceEntry).deviceId === 'string' &&
        typeof (item as DeviceEntry).label === 'string'
    )
    .slice(0, MAX_STUDENT_DEVICES);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isHardcodedAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(normalizeEmail(email));
}

export function isValidEmailAddress(email: string): boolean {
  const normalized = normalizeEmail(email);
  return (
    normalized.length >= 3 &&
    normalized.length <= 254 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)
  );
}

export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/FBAN|FBAV|Instagram|WhatsApp|Line/i.test(ua)) {
    return true;
  }
  if (/Android/i.test(ua) && /\bwv\b/i.test(ua)) {
    return true;
  }
  return false;
}

export function formatFriendlyAuthError(err: unknown): string | null {
  const code = (err as { code?: string })?.code;
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return null;
  }
  switch (code) {
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Please allow popups or open this page in Chrome or Safari.';
    case 'auth/operation-not-supported-in-this-environment':
    case 'auth/web-storage-unsupported':
      return 'This browser cannot complete Google sign-in here. Please open this link in Chrome or Safari and try again.';
    case 'auth/network-request-failed':
      return 'Could not connect to Google sign-in. Check your internet connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Please wait a moment and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact the school administration.';
    case 'auth/unauthorized-domain':
      return 'Sign-in is not authorized on this domain. Please contact the school administration.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with a different sign-in method. Please try signing in with Google again.';
    default:
      return 'Unable to sign in with Google right now. Please try again.';
  }
}

let redirectResultPromise: Promise<string | null> | null = null;

export function finishRedirectSignInOnce(): Promise<string | null> {
  if (!redirectResultPromise) {
    redirectResultPromise = getRedirectResult(auth)
      .then(() => null)
      .catch((err: unknown) => formatFriendlyAuthError(err));
  }
  return redirectResultPromise;
}

export async function signOutUser() {
  return signOut(auth);
}

export function ensureAndSubscribeUserProfile(
  firebaseUser: User,
  onProfile: (profile: AppUserProfile) => void,
  onError: (err: Error) => void
): () => void {
  const email = normalizeEmail(firebaseUser.email || '');
  if (!email) {
    onError(new Error('Google account has no email address.'));
    return () => {};
  }

  const isPrimaryAdmin = isHardcodedAdminEmail(email);
  const path = `users/${email}`;
  const userRef = doc(db, 'users', email);

  let cancelled = false;
  let unsubscribeSnapshot: (() => void) | null = null;

  const start = async () => {
    try {
      let exists = false;
      try {
        const snap = await getDoc(userRef);
        exists = snap.exists();
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, path);
      }

      if (cancelled) return;

      if (!exists) {
        const safeName =
          (firebaseUser.displayName || email.split('@')[0] || 'Student').trim().slice(0, 120) ||
          'Student';
        try {
          await setDoc(userRef, {
            email,
            name: safeName,
            role: isPrimaryAdmin ? 'admin' : 'student',
            status: isPrimaryAdmin ? 'approved' : 'pending',
            devices: [],
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      }

      if (cancelled) return;

      unsubscribeSnapshot = onSnapshot(
        userRef,
        (docSnap) => {
          if (cancelled) return;
          if (!docSnap.exists()) {
            if (isPrimaryAdmin) {
              onProfile({
                email,
                name: (firebaseUser.displayName || 'Admin').slice(0, 120),
                role: 'admin',
                status: 'approved',
                devices: [],
                createdAt: null,
              });
            }
            return;
          }

          const data = docSnap.data() as Partial<AppUserProfile>;
          onProfile({
            email,
            name: typeof data.name === 'string' && data.name.trim() ? data.name : email,
            role: isPrimaryAdmin ? 'admin' : data.role === 'admin' ? 'admin' : 'student',
            status: isPrimaryAdmin
              ? 'approved'
              : data.status === 'approved' || data.status === 'blocked'
                ? data.status
                : 'pending',
            devices: parseDevices(data.devices),
            createdAt: data.createdAt ?? null,
          });
        },
        (error) => {
          if (cancelled) return;
          try {
            handleFirestoreError(error, OperationType.GET, path);
          } catch (formattedError) {
            onError(
              formattedError instanceof Error
                ? formattedError
                : new Error(String(formattedError))
            );
          }
        }
      );
    } catch (err) {
      if (!cancelled) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  void start();

  return () => {
    cancelled = true;
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
    }
  };
}

export function subscribeAllUsers(
  onUsers: (users: AppUserProfile[]) => void,
  onError: (err: Error) => void
): () => void {
  const usersQuery = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    usersQuery,
    (snapshot) => {
      const list: AppUserProfile[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as Partial<AppUserProfile>;
        const email = normalizeEmail(data.email || docSnap.id);
        const isPrimaryAdmin = isHardcodedAdminEmail(email);
        return {
          email,
          name: typeof data.name === 'string' && data.name.trim() ? data.name : email,
          role: isPrimaryAdmin ? 'admin' : data.role === 'admin' ? 'admin' : 'student',
          status: isPrimaryAdmin
            ? 'approved'
            : data.status === 'approved' || data.status === 'blocked'
              ? data.status
              : 'pending',
          devices: parseDevices(data.devices),
          createdAt: data.createdAt ?? null,
        };
      });
      onUsers(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'users');
      } catch (formattedError) {
        onError(
          formattedError instanceof Error
            ? formattedError
            : new Error(String(formattedError))
        );
      }
    }
  );
}

export async function updateUserAccess(
  targetEmail: string,
  updates: Partial<{ status: UserStatus; role: UserRole }>
): Promise<void> {
  const email = normalizeEmail(targetEmail);
  if (!isValidEmailAddress(email)) {
    throw new Error('Invalid email address.');
  }
  if (isHardcodedAdminEmail(email)) {
    throw new Error('Primary administrator permissions cannot be modified.');
  }
  const path = `users/${email}`;
  try {
    await updateDoc(doc(db, 'users', email), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function addApprovedStudentByEmail(
  rawEmail: string
): Promise<'created' | 'approved' | 'already-admin'> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmailAddress(email)) {
    throw new Error('Please enter a valid Gmail or email address.');
  }
  if (isHardcodedAdminEmail(email)) {
    return 'already-admin';
  }

  const path = `users/${email}`;
  const userRef = doc(db, 'users', email);

  let exists = false;
  try {
    const snap = await getDoc(userRef);
    exists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (exists) {
    try {
      await updateDoc(userRef, { status: 'approved' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
    return 'approved';
  }

  const defaultName = (email.split('@')[0] || 'Student').slice(0, 120);
  try {
    await setDoc(userRef, {
      email,
      name: defaultName,
      role: 'student',
      status: 'approved',
      devices: [],
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
  return 'created';
}

export async function syncStudentDevice(
  rawEmail: string
): Promise<'allowed' | 'limit-reached'> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmailAddress(email)) {
    throw new Error('Invalid email address.');
  }
  if (isHardcodedAdminEmail(email)) {
    return 'allowed';
  }

  const deviceId = getOrCreateBrowserDeviceId();
  const label = getReadableDeviceLabel();
  const path = `users/${email}`;
  const userRef = doc(db, 'users', email);

  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) {
        throw new Error('User profile does not exist.');
      }
      const data = snap.data() as Partial<AppUserProfile>;
      if (data.role === 'admin' && data.status === 'approved') {
        return 'allowed';
      }
      if (data.status !== 'approved') {
        return 'allowed';
      }

      const existingDevices = parseDevices(data.devices);
      const now = Timestamp.now();
      const idx = existingDevices.findIndex((d) => d.deviceId === deviceId);

      if (idx >= 0) {
        const updatedDevices = existingDevices.map((d, i) =>
          i === idx
            ? {
                deviceId: d.deviceId,
                label,
                firstSeen: d.firstSeen || now,
                lastSeen: now,
              }
            : d
        );
        tx.update(userRef, { devices: updatedDevices });
        return 'allowed';
      }

      if (existingDevices.length < MAX_STUDENT_DEVICES) {
        const nextDevices: DeviceEntry[] = [
          ...existingDevices,
          {
            deviceId,
            label,
            firstSeen: now,
            lastSeen: now,
          },
        ];
        tx.update(userRef, { devices: nextDevices });
        return 'allowed';
      }

      return 'limit-reached';
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function resetUserDevices(targetEmail: string): Promise<void> {
  const email = normalizeEmail(targetEmail);
  if (!isValidEmailAddress(email)) {
    throw new Error('Invalid email address.');
  }
  const path = `users/${email}`;
  try {
    await updateDoc(doc(db, 'users', email), { devices: [] });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
