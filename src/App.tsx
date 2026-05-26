import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, setDoc, serverTimestamp, getDocs, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider } from 'firebase/auth';
import { db, auth } from './firebase';
import TrackingMap from './components/TrackingMap';
import GeneralFleetMap from './components/GeneralFleetMap';
import { getRoutePath, getInterpolatedPoint } from './utils/routing';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
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
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

type Page = 'dashboard' | 'tracking' | 'create' | 'tickets' | 'agencies' | 'drivers' | 'rra' | 'analytics' | 'admin' | 'fundraising';
type UserPersona = 'recipient' | 'driver' | 'operator' | 'customs' | 'admin';

export const PERSONA_PERMISSIONS: Record<UserPersona, Page[]> = {
  recipient: ['tracking', 'fundraising'],
  driver: ['drivers', 'tracking', 'fundraising'],
  operator: ['create', 'tickets', 'agencies', 'drivers', 'fundraising', 'tracking'],
  customs: ['rra', 'tracking', 'tickets'],
  admin: ['dashboard', 'tracking', 'create', 'tickets', 'agencies', 'drivers', 'rra', 'analytics', 'admin', 'fundraising']
};

export const isPagePermitted = (page: Page, persona: UserPersona): boolean => {
  return PERSONA_PERMISSIONS[persona]?.includes(page) || false;
};

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [userPersona, setUserPersona] = useState<UserPersona>('recipient');
  
  const [customUsers, setCustomUsers] = useState<any[]>([]);
  const [currentCustomUserId, setCurrentCustomUserId] = useState<string | null>(null);
  const [selectedAgencyId, setSelectedAgencyId] = useState<string | null>(null);

  const [authUser, setAuthUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Sign In & Registration form states
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authRole, setAuthRole] = useState<UserPersona>('recipient');
  const [authAgency, setAuthAgency] = useState('Ritco');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [authSubmitState, setAuthSubmitState] = useState<'idle' | 'saving'>('idle');

  // Sync session with Firestore and live auth changes 
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthLoading(false);
    });
    return () => unsubAuth();
  }, []);

  // Handle redirect sign-in results (when signInWithRedirect was used)
  useEffect(() => {
    const handleRedirect = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
          // Same provisioning flow used after popup sign-in
          const uid = result.user.uid;
          const email = result.user.email || '';
          const displayName = result.user.displayName || 'Google User';

          const usersSnap = await getDocs(query(collection(db, 'custom_users')));
          const match = usersSnap.docs.find(d => d.id === uid || d.data().email === email);
          if (!match) {
            await setDoc(doc(db, 'custom_users', uid), {
              id: uid,
              name: displayName,
              email: email,
              role: 'recipient' as UserPersona,
              agency: 'NCTA Regulator',
              status: 'Active',
              createdAt: serverTimestamp()
            });
          }
          setAuthSuccess('Google sign-in validated (redirect)!');
        }
      } catch (err: any) {
        console.error('Redirect result handling failed:', err);
        // don't surface to UI aggressively; onAuthStateChanged will update state
      }
    };
    handleRedirect();
  }, []);

  // Compute internal permissions and roles by matching user ID or email with Custom Users pool
  useEffect(() => {
    if (authUser) {
      if (authUser.email === 'iradukunda1ricky@gmail.com') {
        setUserPersona('admin');
        setCurrentCustomUserId(authUser.uid);
      } else {
        const match = customUsers.find(cu => cu.id === authUser.uid || cu.email === authUser.email);
        if (match) {
          setUserPersona(match.role || 'recipient');
          setCurrentCustomUserId(match.id || authUser.uid);
        } else {
          // If they exist in Auth but not in custom_users directory, default safely
          setUserPersona('recipient');
          setCurrentCustomUserId(null);
        }
      }
    } else {
      setUserPersona('recipient');
      setCurrentCustomUserId(null);
    }
  }, [authUser, customUsers]);

  // Automatically adjust current page selection if user profile changes or accesses an unauthorized zone.
  useEffect(() => {
    if (!isPagePermitted(currentPage, userPersona)) {
      const allowedPages = PERSONA_PERMISSIONS[userPersona];
      if (allowedPages && allowedPages.length > 0) {
        setCurrentPage(allowedPages[0]);
      }
    }
  }, [currentPage, userPersona]);

  // Dynamic persona metadata profiles
  const PERSONA_DETAILS: Record<UserPersona, { initials: string; name: string; title: string; email: string; color: string }> = {
    recipient: { initials: 'PT', name: 'Patricia Tumukunde', title: 'Passenger / Customer', email: 'patricia@momo.rw', color: '#10B981' },
    driver: { initials: 'MJ', name: 'Mugisha Jean', title: 'Bus Driver (Zebre Exp)', email: 'jean.mugisha@zebre.rw', color: '#3B82F6' },
    operator: { initials: 'NK', name: 'Niyonkuru Solange', title: 'Agency Manager (Ritco)', email: 'solange@ritco.rw', color: '#8B5CF6' },
    customs: { initials: 'GK', name: 'Gatete Kamonzi', title: 'RRA Customs Agent', email: 'gatete@rra.gov.rw', color: '#EF4444' },
    admin: { initials: 'SA', name: 'Super Admin Regulator', title: 'NCTA System Director', email: 'admin@rctts.rw', color: '#F59E0B' }
  };

  const [newAgencyDriverForm, setNewAgencyDriverForm] = useState({
    name: '',
    license: '',
    vehicle: '',
    status: 'On Duty'
  });
  const [newAgencyStaffForm, setNewAgencyStaffForm] = useState({
    name: '',
    email: '',
    role: 'operator' as UserPersona
  });
  const [agencyDriverState, setAgencyDriverState] = useState<'idle' | 'saving' | 'success'>('idle');
  const [agencyStaffState, setAgencyStaffState] = useState<'idle' | 'saving' | 'success'>('idle');

  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    role: 'recipient' as UserPersona,
    agency: 'Zebre Car Express',
    status: 'Active'
  });
  const [quickTicketSearch, setQuickTicketSearch] = useState('');
  const [userCreationState, setUserCreationState] = useState<'idle' | 'saving' | 'success'>('idle');

  const getActiveUserInfo = () => {
    const customUser = customUsers.find(cu => cu.id === currentCustomUserId);
    if (customUser) {
      const getInitials = (name: string) => {
        return name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'CU';
      };
      const getTitle = (role: UserPersona) => {
        if (role === 'admin') return 'Super Admin Regulator';
        if (role === 'customs') return 'RRA Customs Agent';
        if (role === 'operator') return 'Agency Manager (' + (customUser.agency || 'Ritco') + ')';
        if (role === 'driver') return 'Bus Driver (' + (customUser.agency || 'Zebre') + ')';
        return 'Passenger / Customer';
      };
      return {
        initials: getInitials(customUser.name),
        name: customUser.name,
        title: getTitle(customUser.role),
        email: customUser.email,
        color: PERSONA_DETAILS[customUser.role]?.color || 'var(--g)',
        agency: customUser.agency || 'NCTA Regulator',
        role: customUser.role
      };
    }
    
    const defaultInfo = PERSONA_DETAILS[userPersona];
    let agency = 'NCTA Regulator';
    if (userPersona === 'operator') agency = 'Ritco';
    else if (userPersona === 'driver') agency = 'Zebre Car Express';
    else if (userPersona === 'customs') agency = 'RRA Customs Department';
    
    return {
      ...defaultInfo,
      agency,
      role: userPersona
    };
  };

  const activeUserInfo = getActiveUserInfo();

  const [tickets, setTickets] = useState<any[]>([]);
  const [agencies, setAgencies] = useState<any[]>([]);
  const [cost, setCost] = useState('RWF 4,500');
  const [searchId, setSearchId] = useState('');
  const [trackResult, setTrackResult] = useState<any>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingViewMode, setTrackingViewMode] = useState<'single' | 'fleet'>('fleet');
  const [createStep, setCreateStep] = useState(0);

  // Driver GPS Broadcaster State
  const [broadcastingTicketId, setBroadcastingTicketId] = useState<string>('');
  const [gpsBroadcasting, setGpsBroadcasting] = useState<boolean>(false);
  const [broadcastingCoords, setBroadcastingCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsWatchId, setGpsWatchId] = useState<number | null>(null);
  const [simulatedProgress, setSimulatedProgress] = useState<number>(0.35);
  const [isSimulationActive, setIsSimulationActive] = useState<boolean>(false);

  // Live WebSocket network monitor console logs
  const [wsLogs, setWsLogs] = useState<string[]>([]);

  // MoMo donation simulation states
  const [momoMode, setMomoMode] = useState<'idle' | 'initiating' | 'awaiting_pin' | 'processing' | 'success'>('idle');
  const [momoAmount, setMomoAmount] = useState<number>(5000);
  const [momoPhone, setMomoPhone] = useState<string>('0788300000');
  const [momoPin, setMomoPin] = useState<string>('');
  const [momoError, setMomoError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    sname: '', sphone: '',
    rname: '', rphone: '',
    ptype: 'Electronics', weight: '1', value: '',
    agency: 'Zebre Car Express', route: 'Kigali → Huye',
    driverId: '',
    driverName: ''
  });

  const updateForm = (e: any) => {
    const { name, value } = e.target;
    if (name === 'driverId') {
      const selectedDriver = drivers.find(d => d.id === value);
      setFormData(prev => ({
        ...prev,
        driverId: value,
        driverName: selectedDriver ? selectedDriver.name : ''
      }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
      if (name === 'agency') updateCost(value);
    }
  };

  const doTrack = async () => {
    setTrackingLoading(true);
    setTrackingViewMode('single');
    setTimeout(async () => {
      const path = 'tickets';
      try {
        const q = query(collection(db, path));
        const snap = await getDocs(q);
        const found = snap.docs.find(d => `#RW-${d.id.slice(0, 4).toUpperCase()}` === searchId || d.id === searchId);
        setTrackResult(found ? { id: found.id, ...found.data() } : null);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      } finally {
        setTrackingLoading(false);
      }
    }, 400);
  };

  const handleTrackTicket = (id: string) => {
    const formatted = `#RW-${id.slice(0, 4).toUpperCase()}`;
    setSearchId(formatted);
    setCurrentPage('tracking');
    setTrackingViewMode('single');
    setTrackingLoading(true);
    setTimeout(async () => {
      const path = 'tickets';
      try {
        const q = query(collection(db, path));
        const snap = await getDocs(q);
        const found = snap.docs.find(d => `#RW-${d.id.slice(0, 4).toUpperCase()}` === formatted || d.id === id);
        setTrackResult(found ? { id: found.id, ...found.data() } : null);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      } finally {
        setTrackingLoading(false);
      }
    }, 400);
  };

  const handleAuthRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword || !authName) {
      setAuthError("All fields are required.");
      return;
    }
    setAuthSubmitState('saving');
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      const uid = userCredential.user.uid;
      
      // Save profile in Firestore custom_users using setDoc so the doc id matches the uid
      await setDoc(doc(db, 'custom_users', uid), {
        id: uid,
        name: authName,
        email: authEmail,
        role: authRole,
        agency: (authRole === 'operator' || authRole === 'driver') ? authAgency : 'NCTA Regulator',
        status: 'Active',
        createdAt: serverTimestamp()
      });
      
      setAuthSuccess("Registration successful! Welcome to RCTTS.");
      setAuthPassword('');
    } catch (err: any) {
      console.error(err);
      let msg = "Failed to register.";
      if (err.code === 'auth/email-already-in-use') {
        msg = "This email is already registered.";
      } else if (err.code === 'auth/weak-password') {
        msg = "Password must be at least 6 characters.";
      } else if (err.message) {
        msg = err.message;
      }
      setAuthError(msg);
    } finally {
      setAuthSubmitState('idle');
    }
  };

  const handleAuthLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      setAuthError("Email and Password are required.");
      return;
    }
    setAuthSubmitState('saving');
    setAuthError(null);
    setAuthSuccess(null);
    try {
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
      setAuthSuccess("Auth approved! Synchronizing profile...");
      setAuthPassword('');
    } catch (err: any) {
      console.error(err);
      let msg = "Invalid login credentials.";
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = "Wrong email or password or account not found.";
      } else if (err.message) {
        msg = err.message;
      }
      setAuthError(msg);
    } finally {
      setAuthSubmitState('idle');
    }
  };

  const handleGoogleAuth = async () => {
    setAuthSubmitState('saving');
    setAuthError(null);
    setAuthSuccess(null);
    try {
      const provider = new GoogleAuthProvider();
      // Try popup first (preferred for UX). If browser blocks popups, fall back to redirect.
      let userCredential: any = null;
      try {
        userCredential = await signInWithPopup(auth, provider);
      } catch (popupErr: any) {
        console.warn('Popup sign-in failed, falling back to redirect:', popupErr?.code || popupErr?.message || popupErr);
        // Detect common popup-blocked errors and use redirect as a reliable fallback
        if (popupErr && (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/popup-closed-by-user' || String(popupErr.message).toLowerCase().includes('popup') || popupErr.code === 'auth/operation-not-supported-in-this-environment')) {
          setAuthSuccess('Popup blocked. Redirecting to Google sign-in...');
          await signInWithRedirect(auth, provider);
          return;
        }
        throw popupErr;
      }
      const uid = userCredential.user.uid;
      const email = userCredential.user.email || '';
      const displayName = userCredential.user.displayName || 'Google User';

      // Check if user has an existing record in custom_users
      const userDocRef = doc(db, 'custom_users', uid);
      const usersSnap = await getDocs(query(collection(db, 'custom_users')));
      const match = usersSnap.docs.find(d => d.id === uid || d.data().email === email);

      if (!match) {
        // Automatically provision a client/passenger profile for first-time Google sign-ins
        await setDoc(doc(db, 'custom_users', uid), {
          id: uid,
          name: displayName,
          email: email,
          role: 'recipient' as UserPersona,
          agency: 'NCTA Regulator',
          status: 'Active',
          createdAt: serverTimestamp()
        });
      }
      
      setAuthSuccess("Google sign-in validated!");
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || "Failed to authenticate with Google.");
    } finally {
      setAuthSubmitState('idle');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Sign out error:", err);
    }
  };

  const handleCreateAgencyDriver = async (e: React.FormEvent, agencyName: string) => {
    e.preventDefault();
    if (!newAgencyDriverForm.name || !newAgencyDriverForm.license || !newAgencyDriverForm.vehicle) {
      alert("Please fill in all driver fields.");
      return;
    }
    setAgencyDriverState('saving');
    try {
      await addDoc(collection(db, 'drivers'), {
        name: newAgencyDriverForm.name,
        license: newAgencyDriverForm.license,
        agency: agencyName,
        vehicle: newAgencyDriverForm.vehicle,
        status: newAgencyDriverForm.status,
        createdAt: serverTimestamp()
      });
      setAgencyDriverState('success');
      setNewAgencyDriverForm({
        name: '',
        license: '',
        vehicle: '',
        status: 'On Duty'
      });
      setTimeout(() => setAgencyDriverState('idle'), 3000);
    } catch (err) {
      console.error("Error creating driver in Firestore: ", err);
      setAgencyDriverState('idle');
      alert("Failed to save driver. Check Firestore permissions.");
    }
  };

  const handleCreateAgencyStaff = async (e: React.FormEvent, agencyName: string) => {
    e.preventDefault();
    if (!newAgencyStaffForm.name || !newAgencyStaffForm.email) {
      alert("Please provide name and email for the new staff member.");
      return;
    }
    setAgencyStaffState('saving');
    try {
      await addDoc(collection(db, 'custom_users'), {
        name: newAgencyStaffForm.name,
        email: newAgencyStaffForm.email,
        role: newAgencyStaffForm.role,
        agency: agencyName,
        status: 'Active',
        createdAt: serverTimestamp()
      });
      setAgencyStaffState('success');
      setNewAgencyStaffForm({
        name: '',
        email: '',
        role: 'operator'
      });
      setTimeout(() => setAgencyStaffState('idle'), 3000);
    } catch (err) {
      console.error("Error creating agency staff in Firestore: ", err);
      setAgencyStaffState('idle');
      alert("Failed to save staff member. Check Firestore permissions.");
    }
  };

  const handleDeleteAgencyStaff = async (staffId: string) => {
    if (!window.confirm("Are you absolutely sure you want to delete/revoke access for this staff member?")) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'custom_users', staffId));
    } catch (err) {
      console.error("Error deleting agency staff: ", err);
      alert("Failed to delete staff member. Verify permissions.");
    }
  };

  const handleDeleteAgencyDriver = async (driverId: string) => {
    if (!window.confirm("Are you sure you want to remove this driver from the fleet registry?")) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'drivers', driverId));
    } catch (err) {
      console.error("Error deleting driver: ", err);
      alert("Failed to delete driver. Verify permissions.");
    }
  };

  const handleToggleDriverStatus = async (driverId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'On Duty' ? 'Resting' : 'On Duty';
    try {
      await updateDoc(doc(db, 'drivers', driverId), { status: nextStatus });
    } catch (err) {
      console.error("Error toggling driver status: ", err);
      alert("Failed to update status.");
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.name || !newUserForm.email) {
      alert("Please provide name and email for the new user profile.");
      return;
    }
    setUserCreationState('saving');
    try {
      await addDoc(collection(db, 'custom_users'), {
        name: newUserForm.name,
        email: newUserForm.email,
        role: newUserForm.role,
        agency: newUserForm.agency,
        status: newUserForm.status,
        createdAt: serverTimestamp()
      });
      setUserCreationState('success');
      setNewUserForm({
        name: '',
        email: '',
        role: 'recipient',
        agency: 'Zebre Car Express',
        status: 'Active'
      });
      setTimeout(() => setUserCreationState('idle'), 3000);
    } catch (err) {
      console.error("Error creating user profile in Firestore: ", err);
      setUserCreationState('idle');
      alert("Failed to save user in database. Please check Firestore permissions.");
    }
  };

  const handleQuickTrack = () => {
    if (!quickTicketSearch.trim()) return;
    let queryVal = quickTicketSearch.trim().toUpperCase();
    if (!queryVal.startsWith('RW-') && !queryVal.startsWith('#RW-')) {
      queryVal = `RW-${queryVal}`;
    }
    setSearchId(queryVal);
    setCurrentPage('tracking');
    setTrackingViewMode('single');
    setTrackingLoading(true);
    
    setTimeout(async () => {
      const path = 'tickets';
      try {
        const q = query(collection(db, path));
        const snap = await getDocs(q);
        const found = snap.docs.find(d => 
          `#RW-${d.id.slice(0, 4).toUpperCase()}` === queryVal || 
          `RW-${d.id.slice(0, 4).toUpperCase()}` === queryVal || 
          d.id.toUpperCase() === queryVal.toUpperCase()
        );
        setTrackResult(found ? { id: found.id, ...found.data() } : null);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      } finally {
        setTrackingLoading(false);
      }
    }, 400);
  };

  // Synchronized active tracked ticket pulling from live state subscription
  const activeTrackedTicket = tickets.find(t => 
    `#RW-${t.id.slice(0, 4).toUpperCase()}` === searchId.trim().toUpperCase() ||
    `RW-${t.id.slice(0, 4).toUpperCase()}` === searchId.trim().toUpperCase() ||
    t.id === searchId ||
    (trackResult && t.id === trackResult.id)
  ) || trackResult;

  useEffect(() => {
    if (activeTrackedTicket) {
      const idStr = activeTrackedTicket.id.slice(0, 4).toUpperCase();
      const initialLogs = [
        `[${new Date().toLocaleTimeString()}] Handshake initialized with wss://gps.rc-tts.rw/v3`,
        `[${new Date().toLocaleTimeString()}] Upgrade headers verified. TLS 1.3 | AES-256`,
        `[${new Date().toLocaleTimeString()}] Subscribed: ticket_channel:#RW-${idStr}`,
        `[${new Date().toLocaleTimeString()}] Stream connected. RTT: 6ms | Zero frame lag`
      ];
      setWsLogs(initialLogs);

      const interval = setInterval(() => {
        const lat = activeTrackedTicket.currentLat || (-1.9403 + (Math.random() - 0.5) * 0.04);
        const lng = activeTrackedTicket.currentLng || (30.0619 + (Math.random() - 0.5) * 0.04);
        const logLine = `[${new Date().toLocaleTimeString()}] RECV WSS: lat=${lat.toFixed(5)}, lng=${lng.toFixed(5)}, speed=47km/h, loss=0%, jitter=0.2ms`;
        setWsLogs(prev => [...prev.slice(-10), logLine]);
      }, 3500);
      return () => clearInterval(interval);
    }
  }, [activeTrackedTicket?.id, activeTrackedTicket?.currentLat, activeTrackedTicket?.currentLng]);

  const [rraRecords, setRraRecords] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);

  // Fundraising State for full stack integration
  const [fundraising, setFundraising] = useState({
    goal: 1000000,
    raised: 420000,
    contributors: 14,
  });

  const fetchFundraising = async () => {
    try {
      const res = await fetch('/api/fundraising');
      const data = await res.json();
      if (data.success) {
        setFundraising({
          goal: data.goal,
          raised: data.raised,
          contributors: data.contributors,
        });
      }
    } catch (e) {
      console.error("Error fetching fundraising data:", e);
    }
  };

  const handleMomoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!momoPhone || momoAmount <= 0) {
      setMomoError("Please enter a valid phone number and custom selection.");
      return;
    }
    setMomoError(null);
    setMomoMode('initiating');

    // Step 1: Simulate the push notification request
    setTimeout(() => {
      setMomoMode('awaiting_pin');
    }, 1505);
  };

  const handlePinConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!momoPin || momoPin.trim() === '') {
      setMomoError("Please enter your PIN confirmation code.");
      return;
    }
    setMomoError(null);
    setMomoMode('processing');

    // Simulate sending payment to API
    setTimeout(async () => {
      try {
        const res = await fetch('/api/fundraising/donate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: momoAmount,
            phone: momoPhone
          })
        });

        const data = await res.json();
        if (data.success) {
          setFundraising({
            goal: data.goal,
            raised: data.raised,
            contributors: data.contributors
          });
          setMomoMode('success');
        } else {
          setMomoError(data.error || "Payment was rejected. Please try again.");
          setMomoMode('idle');
        }
      } catch (err) {
        setMomoError("Network error. Could not connect to the full-stack server.");
        setMomoMode('idle');
      }
    }, 1805);
  };

  useEffect(() => {
    fetchFundraising();
    const unsubTickets = onSnapshot(query(collection(db, 'tickets'), orderBy('createdAt', 'desc')), (snap) => {
      setTickets(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'tickets'));

    const unsubAgencies = onSnapshot(collection(db, 'agencies'), (snap) => {
      setAgencies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'agencies'));

    const unsubRRA = onSnapshot(collection(db, 'rra_records'), (snap) => {
      setRraRecords(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'rra_records'));

    const unsubDrivers = onSnapshot(collection(db, 'drivers'), (snap) => {
      setDrivers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'drivers'));

    const unsubCustomUsers = onSnapshot(collection(db, 'custom_users'), (snap) => {
      setCustomUsers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'custom_users'));

    return () => {
      unsubTickets();
      unsubAgencies();
      unsubRRA();
      unsubDrivers();
      unsubCustomUsers();
    };
  }, []);

  // Live GPS Broadcast Mechanics
  const startLiveGpsBroadcast = (ticketId: string) => {
    if (!ticketId) return;
    if (gpsWatchId) {
      navigator.geolocation.clearWatch(gpsWatchId);
    }
    
    setBroadcastingTicketId(ticketId);
    setGpsBroadcasting(true);
    setIsSimulationActive(false); // Disable auto simulate if using physical sensor
    
    if (!navigator.geolocation) {
      alert("This device is running in an environment that does not support GPS hardware.");
      setGpsBroadcasting(false);
      return;
    }
    // Use Permissions API when available to inform the user and avoid silent failures
    const attemptStart = async () => {
      try {
        if ((navigator as any).permissions && (navigator as any).permissions.query) {
          try {
            const perm = await (navigator as any).permissions.query({ name: 'geolocation' });
            if (perm.state === 'denied') {
              alert('Location access is denied for this origin. Please enable location permission in your browser for live GPS broadcast or use the simulator.');
              setIsSimulationActive(true);
              setGpsBroadcasting(false);
              return;
            }
          } catch (e) {
            // ignore permission query errors
          }
        }

        // Prompt for permission explicitly using getCurrentPosition so the browser shows a prompt
        const getCurrentPositionAsync = () => new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        });

        try {
          const pos = await getCurrentPositionAsync();
          const { latitude, longitude } = pos.coords;
          setBroadcastingCoords({ lat: latitude, lng: longitude });
        } catch (err: any) {
          console.error('Initial GPS permission or position failed:', err);
          if (err && err.code === 1) { // PERMISSION_DENIED
            alert('Please allow location access in your browser to broadcast live GPS. Falling back to simulator.');
            setIsSimulationActive(true);
            setGpsBroadcasting(false);
            return;
          }
          // Other errors fallback to simulator
          setIsSimulationActive(true);
          return;
        }

        const watchId = navigator.geolocation.watchPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            setBroadcastingCoords({ lat: latitude, lng: longitude });

            try {
              await updateDoc(doc(db, 'tickets', ticketId), {
                currentLat: latitude,
                currentLng: longitude,
                status: 'In Transit',
                lastGpsUpdate: new Date().toISOString()
              });
            } catch (err) {
              console.error("Failed to update Firestore coordinates docs: ", err);
            }
          },
          (err) => {
            console.error("GPS telemetry collection failed: ", err);
            if (err && err.code === 1) {
              alert('Location permission was denied. Enabling virtual route simulator instead.');
            } else {
              alert(`Hardware location error: ${err?.message || 'Unknown error'}. Enabling virtual route simulator instead.`);
            }
            setIsSimulationActive(true);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          }
        );

        setGpsWatchId(watchId);
      } catch (outerErr) {
        console.error('Failed to start GPS broadcast:', outerErr);
        setIsSimulationActive(true);
        setGpsBroadcasting(false);
      }
    };

    attemptStart();
  };

  const stopLiveGpsBroadcast = async () => {
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
      setGpsWatchId(null);
    }
    setIsSimulationActive(false);
    setGpsBroadcasting(false);
    setBroadcastingCoords(null);
    setBroadcastingTicketId('');
  };

  // Automated drive simulation physics
  useEffect(() => {
    let interval: any = null;
    if (isSimulationActive && broadcastingTicketId) {
      const activeTicket = tickets.find(t => t.id === broadcastingTicketId);
      if (activeTicket) {
        const routeString = (activeTicket.route || "Kigali → Huye").toLowerCase();
        const parts = routeString.split('→').map((p: string) => p.trim());
        const originName = parts[0] || 'kigali';
        const destName = parts[1] || 'huye';
        
        const routeWaypoints = getRoutePath(originName, destName);
        
        interval = setInterval(async () => {
          setSimulatedProgress((prev) => {
            const nextP = prev >= 1.0 ? 0.0 : prev + 0.05;
            
            const currentPos = getInterpolatedPoint(routeWaypoints, nextP);
            const currentLat = currentPos.lat;
            const currentLng = currentPos.lng;
            
            setBroadcastingCoords({ lat: currentLat, lng: currentLng });
            
            // Push simulated steps straight to Firestore ticket
            updateDoc(doc(db, 'tickets', broadcastingTicketId), {
              currentLat,
              currentLng,
              status: nextP >= 0.95 ? 'Delivered' : (nextP > 0.1 ? 'In Transit' : 'Picked Up'),
              lastGpsUpdate: new Date().toISOString()
            }).catch(e => console.error(e));

            return nextP;
          });
        }, 1500);
      }
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSimulationActive, broadcastingTicketId, tickets]);

  const nudgeCoordinates = async (direction: 'N' | 'S' | 'E' | 'W') => {
    if (!broadcastingTicketId) return;
    let lat = broadcastingCoords?.lat || -1.9441;
    let lng = broadcastingCoords?.lng || 30.0619;
    
    if (direction === 'N') lat += 0.003;
    if (direction === 'S') lat -= 0.003;
    if (direction === 'E') lng += 0.003;
    if (direction === 'W') lng -= 0.003;
    
    setBroadcastingCoords({ lat, lng });
    try {
      await updateDoc(doc(db, 'tickets', broadcastingTicketId), {
        currentLat: lat,
        currentLng: lng,
        status: 'In Transit',
        lastGpsUpdate: new Date().toISOString()
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Clean watchId on unmount
  useEffect(() => {
    return () => {
      if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
      }
    };
  }, [gpsWatchId]);

  const titles: Record<Page, string> = {
    dashboard: 'Dashboard',
    tracking: 'Live Tracking',
    create: 'Create New Ticket',
    tickets: 'All Tickets',
    agencies: 'Agency Management',
    drivers: 'Driver Registry',
    rra: 'RRA Clearance Module',
    analytics: 'Analytics & Pitch',
    admin: 'Admin Panel',
    fundraising: 'MoMo GoFundMe — Support Us'
  };

  const updateCost = (agency: string) => {
    const costs: Record<string, string> = {
      'Zebre Car Express': 'RWF 4,200',
      'Ritco': 'RWF 3,800',
      'Capital Express': 'RWF 5,000',
      'LogExpress': 'RWF 4,500',
      'Swift RW': 'RWF 3,500',
      'EastLink Courier': 'RWF 4,800',
      'Horizon Transport': 'RWF 5,200',
      'PaceSetter Express': 'RWF 3,900'
    };
    setCost(costs[agency] || 'RWF 4,500');
  };

  if (authLoading) {
    return (
      <div style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0d16',
        color: '#fff',
        flexDirection: 'column',
        gap: '16px',
        fontFamily: 'var(--font-sans, "Inter", sans-serif)'
      }}>
        <div style={{
          width: '36px',
          height: '36px',
          border: '3px solid rgba(255,255,255,0.08)',
          borderTop: '3px solid #F6C343',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', fontWeight: 'bold' }}>SYNCHRONIZING RCTTS SECURE KEYRING...</div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0d16',
        color: '#f9fafb',
        padding: '24px',
        fontFamily: 'var(--font-sans, "Inter", sans-serif)',
        boxSizing: 'border-box'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '460px',
          background: '#111625',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Top Banner / Logo */}
          <div style={{
            padding: '28px 28px 24px 28px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            textAlign: 'center',
            background: 'linear-gradient(135deg, rgba(246, 195, 67, 0.1) 0%, rgba(17, 22, 37, 0) 100%)',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
              <svg width="44" height="44" viewBox="0 0 28 28">
                <rect width="28" height="28" rx="6" fill="#F6C343" />
                <path d="M6 14h16M14 6l8 8-8 8" stroke="#1B5E34" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '-0.02em', color: '#fff' }}>RCTTS Gateway</div>
            <div style={{ fontSize: '11.5px', color: 'rgba(255, 255, 255, 0.45)', marginTop: '4px' }}>Rwanda Courier Ticket & Tracking System</div>
          </div>

          {/* Form Content */}
          <div style={{ padding: '24px 28px 28px 28px' }}>
            {authError && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: '#f87171',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '12px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                lineHeight: '1.4'
              }}>
                <span style={{ fontSize: '14px' }}>⚠️</span>
                <span>{authError}</span>
              </div>
            )}

            {authSuccess && (
              <div style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                color: '#34d399',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '12px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                lineHeight: '1.4'
              }}>
                <span style={{ fontSize: '14px' }}>✓</span>
                <span>{authSuccess}</span>
              </div>
            )}

            {!isRegistering ? (
              /* LOGIN FORM */
              <form onSubmit={handleAuthLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. patricia@momo.rw"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#191f32',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '13.5px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                    Account Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Enter security credentials"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#191f32',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '13.5px',
                      outline: 'none',
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={authSubmitState === 'saving'}
                  style={{
                    width: '100%',
                    background: '#F6C343',
                    color: '#111827',
                    border: 'none',
                    padding: '11px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    marginTop: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'all 0.2s',
                  }}
                >
                  {authSubmitState === 'saving' ? 'Verifying Credentials...' : 'Sign In To System'}
                </button>
              </form>
            ) : (
              /* REGISTRATION FORM */
              <form onSubmit={handleAuthRegister} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
                    Full Legal Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Patricia Tumukunde"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#191f32',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. patricia@momo.rw"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#191f32',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
                    Security Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Minimum 6 characters"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#191f32',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
                      Operational Role
                    </label>
                    <select
                      value={authRole}
                      onChange={(e) => setAuthRole(e.target.value as UserPersona)}
                      style={{
                        width: '100%',
                        background: '#191f32',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '13px',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="recipient">👤 Passenger Tracker</option>
                      <option value="driver">🚌 Bus/Truck Driver</option>
                      <option value="operator">🏢 Courier Agency (Full Manager)</option>
                      <option value="customs">🛡️ RRA Officer</option>
                      <option value="admin">⚙️ Super Admin</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
                      Affiliation Name
                    </label>
                    <select
                      value={authAgency}
                      onChange={(e) => setAuthAgency(e.target.value)}
                      disabled={authRole !== 'operator' && authRole !== 'driver'}
                      style={{
                        width: '100%',
                        background: authRole !== 'operator' && authRole !== 'driver' ? 'rgba(255,255,255,0.03)' : '#191f32',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        color: authRole !== 'operator' && authRole !== 'driver' ? 'rgba(255,255,255,0.2)' : '#fff',
                        fontSize: '13px',
                        outline: 'none',
                        cursor: authRole !== 'operator' && authRole !== 'driver' ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {agencies.map(a => (
                        <option key={a.id} value={a.name}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authSubmitState === 'saving'}
                  style={{
                    width: '100%',
                    background: '#F6C343',
                    color: '#111827',
                    border: 'none',
                    padding: '11px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    marginTop: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'all 0.2s',
                  }}
                >
                  {authSubmitState === 'saving' ? 'Creating Credentials...' : 'Create Secure Profile'}
                </button>
              </form>
            )}

            {/* Google Authentication Divider */}
            <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0', gap: '8px' }}>
              <div style={{ flex: '1', height: '1px', background: 'rgba(255,255,255,0.06)' }} />
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Or continue with</span>
              <div style={{ flex: '1', height: '1px', background: 'rgba(255,255,255,0.06)' }} />
            </div>

            <button
              onClick={handleGoogleAuth}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.03)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '9px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'background 0.2s',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M12.24 10.285V14.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.859-3.579-7.859-8s3.53-8 7.859-8c2.463 0 4.116 1.026 5.058 1.926l3.245-3.123C18.3 1.921 15.538 1 12.24 1 6.033 1 1 6.033 1 12.24s5.033 11.24 11.24 11.24c6.478 0 10.793-4.537 10.793-11 0-.742-.08-1.309-.178-1.782h-10.615z" />
              </svg>
              Google Authority ID
            </button>

            {/* Mode Switcher */}
            <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '12.5px', color: 'rgba(255,255,255,0.4)' }}>
              {!isRegistering ? (
                <>
                  New to RCTTS?{' '}
                  <button
                    onClick={() => { setIsRegistering(true); setAuthError(null); }}
                    style={{ background: 'none', border: 'none', color: '#F6C343', fontWeight: 'bold', cursor: 'pointer', padding: '0', fontSize: 'inherit' }}
                  >
                    Register Profile
                  </button>
                </>
              ) : (
                <>
                  Already registered?{' '}
                  <button
                    onClick={() => { setIsRegistering(false); setAuthError(null); }}
                    style={{ background: 'none', border: 'none', color: '#F6C343', fontWeight: 'bold', cursor: 'pointer', padding: '0', fontSize: 'inherit' }}
                  >
                    Sign In
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="sidebar">
        <div className="logo">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="28" height="28" viewBox="0 0 28 28">
              <rect width="28" height="28" rx="6" fill="#F6C343" />
              <path d="M6 14h16M14 6l8 8-8 8" stroke="#1B5E34" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <div>
              <div className="logo-name">RCTTS</div>
              <div className="logo-sub">Rwanda Courier Platform</div>
            </div>
          </div>
        </div>

        {/* Active Authenticated Session Badge */}
        <div style={{ padding: '0 16px 14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ background: 'rgba(255, 255, 255, 0.04)', borderRadius: '8px', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Operational Scope
              </span>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: activeUserInfo.color }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div style={{ fontSize: '11.5px', color: '#f9fafb', fontWeight: '600' }}>
                {activeUserInfo.title}
              </div>
              <div style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.5)' }}>
                Affiliation: {activeUserInfo.agency || 'NCTA Regulator'}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Client Ticket Tracker Box */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
              🎫 Public Ticket Track
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                type="text"
                placeholder="e.g. RW-2840"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#fff',
                  fontSize: '11px',
                  padding: '5px 8px',
                  borderRadius: '5px',
                  width: '100%',
                  fontFamily: 'var(--font-mono, monospace)',
                  outline: 'none',
                }}
                value={quickTicketSearch}
                onChange={(e) => setQuickTicketSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleQuickTrack();
                  }
                }}
              />
              <button
                onClick={handleQuickTrack}
                style={{
                  background: '#F6C343',
                  border: 'none',
                  color: '#111827',
                  borderRadius: '5px',
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                Track
              </button>
            </div>
          </div>
        </div>

        <div className="nav-section">
          {isPagePermitted('dashboard', userPersona) && <div className="nav-label">Overview</div>}
          {isPagePermitted('dashboard', userPersona) && <NavItem active={currentPage === 'dashboard'} icon={<NavIconSquare />} label="Dashboard" onClick={() => setCurrentPage('dashboard')} />}
          {isPagePermitted('tracking', userPersona) && <NavItem active={currentPage === 'tracking'} icon={<NavIconPin />} label="Live Tracking" onClick={() => setCurrentPage('tracking')} />}
          
          {(isPagePermitted('create', userPersona) || isPagePermitted('tickets', userPersona)) && <div className="nav-label">Ticketing</div>}
          {isPagePermitted('create', userPersona) && <NavItem active={currentPage === 'create'} icon={<NavIconPlus />} label="Create Ticket" onClick={() => setCurrentPage('create')} />}
          {isPagePermitted('tickets', userPersona) && <NavItem active={currentPage === 'tickets'} icon={<NavIconList />} label="All Tickets" onClick={() => setCurrentPage('tickets')} />}
          
          {(isPagePermitted('agencies', userPersona) || isPagePermitted('drivers', userPersona)) && <div className="nav-label">Agencies</div>}
          {isPagePermitted('agencies', userPersona) && <NavItem active={currentPage === 'agencies'} icon={<NavIconBuilding />} label="Agencies" onClick={() => setCurrentPage('agencies')} />}
          {isPagePermitted('drivers', userPersona) && <NavItem active={currentPage === 'drivers'} icon={<NavIconUsers />} label="Drivers" onClick={() => setCurrentPage('drivers')} />}
          
          {(isPagePermitted('rra', userPersona) || isPagePermitted('analytics', userPersona)) && <div className="nav-label">Compliance</div>}
          {isPagePermitted('rra', userPersona) && <NavItem active={currentPage === 'rra'} icon={<NavIconShield />} label="RRA Module" onClick={() => setCurrentPage('rra')} />}
          {isPagePermitted('analytics', userPersona) && <NavItem active={currentPage === 'analytics'} icon={<NavIconChart />} label="Analytics" onClick={() => setCurrentPage('analytics')} />}
          
          {isPagePermitted('admin', userPersona) && <div className="nav-label">System</div>}
          {isPagePermitted('admin', userPersona) && <NavItem active={currentPage === 'admin'} icon={<NavIconCog />} label="Admin Panel" onClick={() => setCurrentPage('admin')} />}
          
          {isPagePermitted('fundraising', userPersona) && <div className="nav-label">Support</div>}
          {isPagePermitted('fundraising', userPersona) && <NavItem active={currentPage === 'fundraising'} icon={<NavIconHeart />} label="GoFundMe (MoMo)" onClick={() => setCurrentPage('fundraising')} />}
        </div>
        <div style={{ marginTop: 'auto', padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: activeUserInfo.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold', color: '#111827' }}>
                {activeUserInfo.initials}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '12px', color: '#fff', fontWeight: '500', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '100px' }}>{activeUserInfo.name}</div>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,.5)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '100px' }}>{activeUserInfo.title}</div>
              </div>
            </div>

            <button 
              onClick={handleSignOut}
              title="Sign Out Session"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: '#ef4444',
                padding: '6px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div className="topbar-title">{titles[currentPage]}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', marginRight: '8px' }}>
            <span style={{ 
              fontSize: '10px', 
              fontWeight: 'bold', 
              color: '#111827', 
              background: activeUserInfo.color, 
              padding: '3px 10px', 
              borderRadius: '20px',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              🔒 {activeUserInfo.title}
            </span>
            <span className="badge badge-green">System Online</span>
          </div>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--ts)" strokeWidth="1.5"><path d="M8 1a5 5 0 00-5 5v2l-1.5 2h13L13 8V6a5 5 0 00-5-5zM6.5 13a1.5 1.5 0 003 0" /></svg>
          </div>
        </div>

        <div className="content">
          {/* DASHBOARD PAGE */}
          <div id="page-dashboard" className={currentPage !== 'dashboard' ? 'hidden' : ''}>
            <div className="grid-4" style={{ marginBottom: '16px' }}>
              <StatCard label="Total Tickets" value={tickets.length.toString()} change="↑ Live update" highlight />
              <StatCard label="Active Deliveries" value={tickets.filter(t => t.status !== 'Delivered').length.toString()} change="↑ Real-time" />
              <StatCard label="Agencies Online" value={`${agencies.length} / 24`} change="Syncing..." />
              <StatCard label="RRA Pending" value="42" change="↑ 5 review" fail />
            </div>

            <div className="grid-2" style={{ marginBottom: '16px' }}>
              <div className="card">
                <div className="section-title">Recent Tickets</div>
                <table>
                  <thead><tr><th>Ticket ID</th><th>Route</th><th>Agency</th><th>Status</th></tr></thead>
                  <tbody>
                    {tickets.slice(0, 6).map(t => (
                      <tr key={t.id} onClick={() => handleTrackTicket(t.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: '12px' }}>#RW-{t.id.slice(0, 4).toUpperCase()}</td>
                        <td>{t.route}</td>
                        <td>{agencies.find(a => a.id === t.agencyId)?.name || 'Direct'}</td>
                        <td><span className={`badge ${t.status === 'Delivered' ? 'badge-green' : 'badge-amber'}`}>{t.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <div className="section-title">Delivery Volume — This Week</div>
                <div className="chart-bar">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}><div className="bar" style={{ height: '55%' }}></div><div style={{ fontSize: '10px', color: 'var(--ts)', marginTop: '4px' }}>Mon</div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}><div className="bar" style={{ height: '68%' }}></div><div style={{ fontSize: '10px', color: 'var(--ts)', marginTop: '4px' }}>Tue</div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}><div className="bar" style={{ height: '80%' }}></div><div style={{ fontSize: '10px', color: 'var(--ts)', marginTop: '4px' }}>Wed</div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}><div className="bar" style={{ height: '62%' }}></div><div style={{ fontSize: '10px', color: 'var(--ts)', marginTop: '4px' }}>Thu</div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}><div className="bar" style={{ height: '90%' }}></div><div style={{ fontSize: '10px', color: 'var(--ts)', marginTop: '4px' }}>Fri</div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}><div className="bar highlight" style={{ height: '100%' }}></div><div style={{ fontSize: '10px', color: 'var(--ts)', marginTop: '4px' }}>Sat</div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}><div className="bar" style={{ height: '45%' }}></div><div style={{ fontSize: '10px', color: 'var(--ts)', marginTop: '4px' }}>Sun</div></div>
                </div>
                <div style={{ marginTop: '14px' }}>
                  <div className="section-title">Top Agencies</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <ProgressRow label="Zebre Car Express" val={28} />
                    <ProgressRow label="Ritco" val={22} color="#2196F3" />
                    <ProgressRow label="LogExpress" val={18} color="#9C27B0" />
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Live Activity Feed</div>
              <FeedItem id="#RW-2841" msg="delivered in Musanze by Zebre Express" status="Confirmed" time="2 minutes ago" />
              <FeedItem id="#RW-2839" msg="arrived at Kigali customs checkpoint" status="Internal" time="8 minutes ago" blue />
              <FeedItem id="#RW-2845" msg="picked up in Rubavu by Capital Express" time="15 minutes ago" amber />
            </div>
          </div>

          {/* TRACKING PAGE */}
          <div id="page-tracking" className={currentPage !== 'tracking' ? 'hidden' : ''}>
            {userPersona !== 'recipient' && (
              <div className="tab-bar" style={{ marginBottom: '16px' }}>
                <div 
                  className={`tab ${trackingViewMode === 'fleet' ? 'active' : ''}`} 
                  onClick={() => setTrackingViewMode('fleet')}
                >
                  Network Fleet Map (All Couriers)
                </div>
                <div 
                  className={`tab ${trackingViewMode === 'single' ? 'active' : ''}`} 
                  onClick={() => setTrackingViewMode('single')}
                >
                  Focus Package Tracking
                </div>
              </div>
            )}

            {trackingViewMode === 'fleet' && userPersona !== 'recipient' ? (
              <GeneralFleetMap 
                tickets={tickets} 
                onSelectTicket={handleTrackTicket} 
              />
            ) : (
              <>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <div className="label">Enter Ticket ID</div>
                    <input 
                      className="input" 
                      placeholder="e.g. RW-2840" 
                      style={{ fontFamily: 'var(--font-mono,monospace)' }} 
                      value={searchId}
                      onChange={(e) => setSearchId(e.target.value)}
                    />
                  </div>
                  <button className="btn btn-primary" onClick={doTrack} disabled={trackingLoading}>
                    {trackingLoading ? 'Scanning...' : 'Track Package'}
                  </button>
                </div>

                {activeTrackedTicket ? (
                  <div className="grid-2">
                    <div className="card">
                      <div className="section-title">Ticket #RW-{activeTrackedTicket.id.slice(0, 4).toUpperCase()}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                        <Detail label="Sender" title={activeTrackedTicket.senderName} sub="Kigali Depot" />
                        <Detail label="Receiver" title={activeTrackedTicket.receiverName} sub={activeTrackedTicket.route.split('→')[1]?.trim() || 'Destination'} />
                        <Detail label="Package" title={`${activeTrackedTicket.packageType} — ${activeTrackedTicket.weight}kg`} />
                        <Detail label="Status" title={activeTrackedTicket.status} green={activeTrackedTicket.status === 'Delivered'} />
                        <Detail label="ETA" title="Calculating..." />
                      </div>

                      {/* Bus Driver Information Subpanel */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '12px', marginBottom: '16px' }}>
                        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', margin: '0 0 6px 0' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--g)' }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          <span>Assigned Bus/Truck Driver Info</span>
                        </div>
                        {activeTrackedTicket.driverName ? (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px', background: 'var(--bg2)', padding: '10px', borderRadius: '6px' }}>
                            <div><strong>Driver Name:</strong> {activeTrackedTicket.driverName}</div>
                            <div><strong>Service Class:</strong> {activeTrackedTicket.agency || 'Express Carrier'}</div>
                            <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="flex h-2 w-2 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                              </span>
                              <span><strong>GPS Protocol:</strong> Real-Time Cellphone Broadcaster Enabled</span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: '11px', color: 'var(--ts)', fontStyle: 'italic', background: 'var(--bg2)', padding: '10px', borderRadius: '6px' }}>
                            No specific driver identity assigned. Dispatching via regular scheduled express carrier pool.
                          </div>
                        )}
                      </div>

                      {/* Real-time WebSockets Client Console */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', margin: 0 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                            <span>Live WebSocket Telemetry Frame Logs</span>
                          </div>
                          <span style={{ fontSize: '9px', background: '#e8f5e9', color: '#2e7d32', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                            ● CONNECTED (WS_PROTO)
                          </span>
                        </div>
                        <div style={{ 
                          background: '#0c0f12', 
                          borderRadius: '6px', 
                          padding: '8px', 
                          height: '110px', 
                          overflowY: 'auto', 
                          fontFamily: 'var(--font-mono, monospace)', 
                          fontSize: '10px', 
                          color: '#4af626',
                          lineHeight: '1.4'
                        }}>
                          {wsLogs.map((log, idx) => (
                            <div key={idx} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {log}
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ts)', marginTop: '4px' }}>
                          <span>Delay: <span style={{ color: 'var(--g)', fontWeight: 'bold' }}>0ms (No Lag / WebSocket Stream)</span></span>
                          <span>Jitter: &lt;0.1ms</span>
                        </div>
                      </div>

                      <div className="label" style={{ marginBottom: '8px', marginTop: '16px' }}>Delivery Progress</div>
                      <div className="timeline">
                        <TimelineStep done icon="✓" label="Created" />
                        <TimelineStep done={['Picked Up', 'In Transit', 'At Customs', 'Cleared', 'Out', 'Delivered'].includes(activeTrackedTicket.status)} icon="✓" label="Picked Up" />
                        <TimelineStep active={activeTrackedTicket.status === 'In Transit'} done={['At Customs', 'Cleared', 'Out', 'Delivered'].includes(activeTrackedTicket.status)} icon="●" label="In Transit" />
                        <TimelineStep active={activeTrackedTicket.status === 'At Customs'} done={['Cleared', 'Out', 'Delivered'].includes(activeTrackedTicket.status)} icon="4" label="Customs" />
                        <TimelineStep done={['Cleared', 'Out', 'Delivered'].includes(activeTrackedTicket.status)} icon="5" label="Cleared" />
                        <TimelineStep done={['Out', 'Delivered'].includes(activeTrackedTicket.status)} icon="6" label="Out" />
                        <TimelineStep done={activeTrackedTicket.status === 'Delivered'} icon="7" label="Delivered" />
                      </div>
                    </div>
                    <div className="card">
                      <div className="section-title">Live Location — Rwanda</div>
                      <div className="map-area" style={{ height: '380px', background: 'transparent', border: 'none' }}>
                        <TrackingMap 
                          ticketId={activeTrackedTicket.id}
                          status={activeTrackedTicket.status}
                          route={activeTrackedTicket.route}
                          agency={activeTrackedTicket.agency || 'Zebre Car Express'}
                          currentLat={activeTrackedTicket.currentLat}
                          currentLng={activeTrackedTicket.currentLng}
                        />
                      </div>
                      <div style={{ marginTop: '12px' }}>
                        <div className="section-title">Timeline</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <TimelineRow time="08:42 AM" msg="Package picked up at origin" green />
                          {activeTrackedTicket.currentLat ? (
                            <TimelineRow time="Live" msg={`Driver GPS active at [${activeTrackedTicket.currentLat.toFixed(4)}, ${activeTrackedTicket.currentLng.toFixed(4)}]`} green />
                          ) : null}
                          <TimelineRow time="Now" msg={`Status updated to: ${activeTrackedTicket.status}`} amber />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="card text-center py-20">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--ts)" strokeWidth="1.5" style={{ margin: '0 auto 16px', opacity: 0.2 }}>
                       <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
                    </svg>
                    <div className="section-title">No tracking details found</div>
                    <p className="text-ts">Enter a valid ID and click track</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* CREATE TICKET PAGE */}
          <div id="page-create" className={currentPage !== 'create' ? 'hidden' : ''}>
            <div className="card" style={{ maxWidth: '760px' }}>
              <div style={{ fontSize: '15px', fontWeight: '500', marginBottom: '16px' }}>New Delivery Ticket</div>
              
              {/* Form Navigation Tabs */}
              <div className="tab-bar">
                <div className={`tab ${createStep === 0 ? 'active' : ''}`} onClick={() => setCreateStep(0)}>Sender & Receiver</div>
                <div className={`tab ${createStep === 1 ? 'active' : ''}`} onClick={() => setCreateStep(1)}>Package Details</div>
                <div className={`tab ${createStep === 2 ? 'active' : ''}`} onClick={() => setCreateStep(2)}>Agency & Route</div>
                <div className={`tab ${createStep === 3 ? 'active' : ''}`} onClick={() => setCreateStep(3)}>Review & Submit</div>
              </div>

              <form 
                id="create-form"
                onSubmit={async (e: any) => {
                  e.preventDefault();
                  if (createStep < 3) {
                    setCreateStep(createStep + 1);
                    return;
                  }
                  
                  try {
                    await addDoc(collection(db, 'tickets'), {
                      ...formData,
                      weight: Number(formData.weight),
                      declaredValue: Number(formData.value || 0),
                      agencyId: agencies.find(a => a.name === formData.agency)?.id || '',
                      status: 'Created',
                      createdAt: serverTimestamp()
                    });
                  } catch (error) {
                    handleFirestoreError(error, OperationType.WRITE, 'tickets');
                  }
                  setFormData({
                    sname: 'Mutesi Claudine', sphone: '0788000000',
                    rname: 'Niyomugabo Eric', rphone: '0789111222',
                    ptype: 'Electronics', weight: '1', value: '50000',
                    agency: 'Zebre Car Express', route: 'Kigali → Huye',
                    driverId: '',
                    driverName: ''
                  });
                  setCreateStep(0);
                  setCurrentPage('tickets');
                }}
              >
                {/* STEP 0: SENDER & RECEIVER */}
                <div className={createStep !== 0 ? 'hidden' : ''}>
                  <div className="form-row">
                    <div><div className="label">Sender Name</div><input name="sname" className="input" required value={formData.sname} onChange={updateForm} /></div>
                    <div><div className="label">Sender Phone</div><input name="sphone" className="input" required value={formData.sphone} onChange={updateForm} /></div>
                  </div>
                  <div className="form-row">
                    <div><div className="label">Receiver Name</div><input name="rname" className="input" required value={formData.rname} onChange={updateForm} /></div>
                    <div><div className="label">Receiver Phone</div><input name="rphone" className="input" required value={formData.rphone} onChange={updateForm} /></div>
                  </div>
                </div>

                {/* STEP 1: PACKAGE DETAILS */}
                <div className={createStep !== 1 ? 'hidden' : ''}>
                  <div className="form-row-3">
                    <div><div className="label">Package Type</div><select name="ptype" className="input" value={formData.ptype} onChange={updateForm}><option>Electronics</option><option>Clothing</option><option>Docs</option><option>Food</option></select></div>
                    <div><div className="label">Weight (kg)</div><input name="weight" className="input" type="number" value={formData.weight} onChange={updateForm} /></div>
                    <div><div className="label">Declared Value (RWF)</div><input name="value" className="input" type="number" value={formData.value} onChange={updateForm} /></div>
                  </div>
                  <div className="form-row">
                     <div><div className="label">Fragile</div><select className="input"><option>No</option><option>Yes</option></select></div>
                     <div><div className="label">Handling Instructions</div><input className="input" placeholder="e.g. Keep upright" /></div>
                  </div>
                </div>

                {/* STEP 2: AGENCY & ROUTE */}
                <div className={createStep !== 2 ? 'hidden' : ''}>
                  <div className="form-row">
                    <div>
                      <div className="label">Courier Agency</div>
                      <select name="agency" className="input" value={formData.agency} onChange={updateForm}>
                        {AGENCIES.map(a => <option key={a}>{a}</option>)}
                      </select>
                    </div>
                    <div><div className="label">Service Level</div><select className="input"><option>Standard</option><option>Express (Next Day)</option><option>Priority (Same Day)</option></select></div>
                  </div>
                  <div className="form-row">
                    <div><div className="label">Route</div><input name="route" className="input" value={formData.route} onChange={updateForm} /></div>
                    <div>
                      <div className="label">Assign Bus/Truck Driver</div>
                      <select name="driverId" className="input" value={formData.driverId} onChange={updateForm}>
                        <option value="">-- Auto Dispatch (No specific driver) --</option>
                        {drivers.filter(d => d.agency === formData.agency).map(d => (
                          <option key={d.id} value={d.id}>{d.name} ({d.vehicle || 'Truck'})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* STEP 3: REVIEW & SUBMIT */}
                <div className={createStep !== 3 ? 'hidden' : ''}>
                  <div style={{ background: 'var(--bg2)', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: 'var(--g)' }}>Confirm Details</div>
                    <div className="grid-2" style={{ fontSize: '12px', gap: '8px' }}>
                      <div><span style={{ color: 'var(--ts)' }}>Sender:</span> {formData.sname}</div>
                      <div><span style={{ color: 'var(--ts)' }}>Receiver:</span> {formData.rname}</div>
                      <div><span style={{ color: 'var(--ts)' }}>Agency:</span> {formData.agency}</div>
                      <div><span style={{ color: 'var(--ts)' }}>Cost:</span> {cost}</div>
                      <div><span style={{ color: 'var(--ts)' }}>Category:</span> {formData.ptype}</div>
                      <div><span style={{ color: 'var(--ts)' }}>Route:</span> {formData.route}</div>
                      <div style={{ gridColumn: 'span 2' }}><span style={{ color: 'var(--ts)' }}>Assigned Driver:</span> {formData.driverName || 'Auto Dispatch'}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--ts)', marginBottom: '12px' }}>By submitting, you agree to the RC-TTS terms of service and insurance policy.</div>
                </div>

                <div style={{ background: 'var(--bg2)', borderRadius: '8px', padding: '14px', marginBottom: '16px', display: (createStep === 3 ? 'none' : 'flex'), justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><div style={{ fontSize: '12px', color: 'var(--ts)' }}>Estimated Cost</div><div style={{ fontSize: '20px', fontWeight: '500', marginTop: '2px' }}>{cost}</div></div>
                  <div style={{ textAlign: 'right' }}><div style={{ fontSize: '12px', color: 'var(--ts)' }}>Step</div><div style={{ fontSize: '13px', fontWeight: '500' }}>{createStep + 1} of 4</div></div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  {createStep > 0 && (
                    <button type="button" className="btn btn-outline" onClick={() => setCreateStep(createStep - 1)}>Back</button>
                  )}
                  <button type="submit" className="btn btn-primary">
                    {createStep === 3 ? 'Confirm & Create Ticket' : 'Next Step'}
                  </button>
                  <button type="button" className="btn btn-outline" style={{ marginLeft: 'auto' }} onClick={() => { setCurrentPage('dashboard'); setCreateStep(0); }}>Cancel</button>
                </div>
              </form>
            </div>
          </div>

          {/* TICKETS PAGE */}
          <div id="page-tickets" className={currentPage !== 'tickets' ? 'hidden' : ''}>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
              <input className="input" placeholder="Search..." style={{ maxWidth: '280px' }} />
              <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setCurrentPage('create')}>+ New Ticket</button>
            </div>
            <div className="card">
              <table>
                <thead><tr><th>Ticket ID</th><th>Sender</th><th>Receiver</th><th>Route</th><th>Status</th></tr></thead>
                <tbody>
                  {tickets.map(t => (
                    <tr key={t.id} onClick={() => handleTrackTicket(t.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: '12px' }}>#RW-{t.id.slice(0, 4).toUpperCase()}</td>
                      <td>{t.senderName}</td>
                      <td>{t.receiverName}</td>
                      <td>{t.route}</td>
                      <td><span className={`badge ${t.status === 'Delivered' ? 'badge-green' : 'badge-amber'}`}>{t.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* AGENCIES PAGE */}
          <div id="page-agencies" className={currentPage !== 'agencies' ? 'hidden' : ''}>
            {(() => {
              const defaultAgency = agencies[0] || { id: 'ritco-id', name: activeUserInfo.agency || 'Ritco', contact: 'info@ritco.rw' };
              const managedAgency = userPersona === 'operator' 
                ? (agencies.find(a => a.name.toLowerCase() === activeUserInfo.agency?.toLowerCase()) || defaultAgency)
                : agencies.find(a => a.id === selectedAgencyId);

              if (managedAgency) {
                const agencyTickets = tickets.filter(t => t.agencyId === managedAgency.id || t.agency === managedAgency.name);
                const agencyDrivers = drivers.filter(d => d.agency === managedAgency.name);
                const activeDutyDrivers = drivers.filter(d => d.agency === managedAgency.name && d.status === 'On Duty');
                const agencyStaffList = customUsers.filter(cu => cu.agency === managedAgency.name);

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                      <div>
                        {userPersona === 'admin' && (
                          <button 
                            className="btn btn-outline" 
                            style={{ fontSize: '11px', padding: '5px 10px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }} 
                            onClick={() => setSelectedAgencyId(null)}
                          >
                            ← Back to Agencies list
                          </button>
                        )}
                        <div style={{ fontSize: '20px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ background: '#1565C0', color: '#fff', padding: '4px 8px', borderRadius: '6px', fontSize: '14px' }}>
                            {managedAgency.name.slice(0, 2).toUpperCase()}
                          </span>
                          {managedAgency.name} Hub
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--ts)', marginTop: '4px' }}>
                          Operational Control Center • Affiliate Affiliate ID: {managedAgency.id} • Contact: {managedAgency.contact || 'N/A'}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span className="badge badge-green" style={{ textTransform: 'uppercase' }}>🛡️ Auth Certified</span>
                        <span className="badge badge-info">{userPersona === 'operator' ? 'Agency Manager' : 'Admin View'}</span>
                      </div>
                    </div>

                    <div className="grid-4">
                      <StatCard label="Total Tickets Dispatched" value={agencyTickets.length.toString()} change="Real-time pull" highlight />
                      <StatCard label="Registered Drivers" value={agencyDrivers.length.toString()} change="In fleet registry" />
                      <StatCard label="Active Fleet Drivers" value={`${activeDutyDrivers.length} / ${agencyDrivers.length}`} change="Currently On Duty" />
                      <StatCard label="Authorized Staff" value={agencyStaffList.length.toString()} change="Operator Accounts" />
                    </div>

                    <div className="grid-2">
                      {/* Agency Staff Manager (Create Users) */}
                      <div className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: '700' }}>Agency Staff Registry & Provisioning</div>
                            <div style={{ fontSize: '10.5px', color: 'var(--ts)', marginTop: '2px' }}>Create and manage digital profiles authorized to manage transit dispatch for {managedAgency.name}</div>
                          </div>
                        </div>

                        <div style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
                          {agencyStaffList.length > 0 ? (
                            agencyStaffList.map(st => (
                              <div key={st.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg2)', borderRadius: '6px', border: '1px solid var(--bd)' }}>
                                <div style={{ overflow: 'hidden', marginRight: '8px' }}>
                                  <div style={{ fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{st.name}</div>
                                  <div style={{ fontSize: '10px', color: 'var(--ts)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{st.email}</div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                  <span style={{ fontSize: '8px', fontWeight: 'bold', background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase' }}>
                                    {st.role}
                                  </span>
                                  {st.id !== authUser?.uid && (
                                    <button
                                      onClick={() => handleDeleteAgencyStaff(st.id)}
                                      style={{
                                        background: 'rgba(239, 68, 68, 0.08)',
                                        border: '1px solid rgba(239, 68, 68, 0.2)',
                                        color: '#ef4444',
                                        padding: '4px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'all 0.15s'
                                      }}
                                      title="Revoke system access / Delete user"
                                    >
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: '11px', color: 'var(--ts)', fontStyle: 'italic' }}>
                              No registered agency staff found in live database directory.
                            </div>
                          )}
                        </div>

                        <form onSubmit={(e) => handleCreateAgencyStaff(e, managedAgency.name)} style={{ borderTop: '1px solid var(--bd)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--ts)' }}>Add New Staff Persona</div>
                          <div className="grid-2" style={{ gap: '10px' }}>
                            <div>
                              <div className="label">Staff Name</div>
                              <input 
                                type="text" 
                                className="input" 
                                placeholder="e.g. Solange Umutoni"
                                value={newAgencyStaffForm.name}
                                onChange={(e) => setNewAgencyStaffForm(prev => ({ ...prev, name: e.target.value }))}
                                required
                              />
                            </div>
                            <div>
                              <div className="label">Staff Email</div>
                              <input 
                                type="email" 
                                className="input" 
                                placeholder="e.g. solange@agency.rw"
                                value={newAgencyStaffForm.email}
                                onChange={(e) => setNewAgencyStaffForm(prev => ({ ...prev, email: e.target.value }))}
                                required
                              />
                            </div>
                          </div>
                          <div>
                            <div className="label">Authorized Fleet Role</div>
                            <select 
                              className="input"
                              value={newAgencyStaffForm.role}
                              onChange={(e) => setNewAgencyStaffForm(prev => ({ ...prev, role: e.target.value as UserPersona }))}
                            >
                              <option value="operator">🏢 Agency Manager & operator</option>
                              <option value="driver">🚌 Dispatch Driver Profile</option>
                            </select>
                          </div>
                          
                          <button 
                            type="submit" 
                            className="btn btn-primary" 
                            style={{ width: '100%', fontSize: '12px', padding: '8px' }}
                            disabled={agencyStaffState === 'saving'}
                          >
                            {agencyStaffState === 'saving' ? 'Provisioning Staff Profile...' : 'Provision Live Staff Identity'}
                          </button>

                          {agencyStaffState === 'success' && (
                            <div style={{ padding: '6px', background: 'rgba(16,185,129,0.08)', border: '1px solid var(--g)', borderRadius: '4px', color: 'var(--g)', fontSize: '11px', textAlign: 'center' }}>
                              ✓ Staff Profile synched & live!
                            </div>
                          )}
                        </form>
                      </div>

                      {/* Fleet Driver Manager (Add Drivers) */}
                      <div className="card">
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '700' }}>Fleet Driver Registry</div>
                          <div style={{ fontSize: '10.5px', color: 'var(--ts)', marginTop: '2px' }}>Maintain on-duty drivers, license credentials, and transit vehicles affiliated with your agency</div>
                        </div>

                        <div style={{ margin: '14px 0 20px 0', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
                          {agencyDrivers.length > 0 ? (
                            agencyDrivers.map(dr => (
                              <div key={dr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg2)', borderRadius: '6px', border: '1px solid var(--bd)' }}>
                                <div style={{ overflow: 'hidden', marginRight: '8px' }}>
                                  <div style={{ fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{dr.name}</div>
                                  <div style={{ fontSize: '10px', color: 'var(--ts)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Vehicle: {dr.vehicle} • Lic: {dr.license}</div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                  <button
                                    onClick={() => handleToggleDriverStatus(dr.id, dr.status)}
                                    title="Toggle Duty Status (On Duty / Resting)"
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      padding: '0',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <span className={`badge ${dr.status === 'On Duty' ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: '9px', padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'currentColor' }} />
                                      {dr.status}
                                    </span>
                                  </button>
                                  <button
                                    onClick={() => handleDeleteAgencyDriver(dr.id)}
                                    style={{
                                      background: 'rgba(239, 68, 68, 0.08)',
                                      border: '1px solid rgba(239, 68, 68, 0.2)',
                                      color: '#ef4444',
                                      padding: '4px',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      transition: 'all 0.15s'
                                    }}
                                    title="Remove driver from fleet"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: '11px', color: 'var(--ts)', fontStyle: 'italic' }}>
                              No registered agency drivers. Add your first driver below!
                            </div>
                          )}
                        </div>

                        <form onSubmit={(e) => handleCreateAgencyDriver(e, managedAgency.name)} style={{ borderTop: '1px solid var(--bd)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--ts)' }}>Register Fleet Driver</div>
                          <div className="grid-2" style={{ gap: '10px' }}>
                            <div>
                              <div className="label">Driver Full Name</div>
                              <input 
                                type="text" 
                                className="input" 
                                placeholder="e.g. Mugisha Jean"
                                value={newAgencyDriverForm.name}
                                onChange={(e) => setNewAgencyDriverForm(prev => ({ ...prev, name: e.target.value }))}
                                required
                              />
                            </div>
                            <div>
                              <div className="label">License No.</div>
                              <input 
                                type="text" 
                                className="input" 
                                placeholder="e.g. RT-882-AB"
                                value={newAgencyDriverForm.license}
                                onChange={(e) => setNewAgencyDriverForm(prev => ({ ...prev, license: e.target.value }))}
                                required
                              />
                            </div>
                          </div>
                          <div className="grid-2" style={{ gap: '10px' }}>
                            <div>
                              <div className="label">Vehicle Plate / Type</div>
                              <input 
                                type="text" 
                                className="input" 
                                placeholder="e.g. Coaster RAD 120A"
                                value={newAgencyDriverForm.vehicle}
                                onChange={(e) => setNewAgencyDriverForm(prev => ({ ...prev, vehicle: e.target.value }))}
                                required
                              />
                            </div>
                            <div>
                              <div className="label">Duty Status</div>
                              <select 
                                className="input"
                                value={newAgencyDriverForm.status}
                                onChange={(e) => setNewAgencyDriverForm(prev => ({ ...prev, status: e.target.value }))}
                              >
                                <option value="On Duty">🟢 On Duty (Ready for Dispatch)</option>
                                <option value="Resting">🟡 Resting</option>
                              </select>
                            </div>
                          </div>

                          <button 
                            type="submit" 
                            className="btn btn-primary" 
                            style={{ width: '100%', fontSize: '12px', padding: '8px' }}
                            disabled={agencyDriverState === 'saving'}
                          >
                            {agencyDriverState === 'saving' ? 'Registering Driver...' : 'Register Driver & Vehicle'}
                          </button>

                          {agencyDriverState === 'success' && (
                            <div style={{ padding: '6px', background: 'rgba(16,185,129,0.08)', border: '1px solid var(--g)', borderRadius: '4px', color: 'var(--g)', fontSize: '11px', textAlign: 'center' }}>
                              ✓ Driver successfully added to agency fleet!
                            </div>
                          )}
                        </form>
                      </div>
                    </div>
                  </div>
                );
              }

              // Otherwise, render full standard agency list registry
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="section-title" style={{ marginBottom: '16px' }}>Registered Courier Agencies</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                    {agencies.map(a => {
                      const agencyTickets = tickets.filter(t => t.agencyId === a.id || t.agency === a.name);
                      const agencyDriversNum = drivers.filter(d => d.agency === a.name).length;
                      return (
                        <div key={a.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div className="agency-logo" style={{ background: '#1565C0', width: '40px', height: '40px', fontSize: '16px' }}>{a.name.slice(0, 2).toUpperCase()}</div>
                            <div>
                              <div style={{ fontSize: '14px', fontWeight: '600' }}>{a.name}</div>
                              <div style={{ fontSize: '11px', color: 'var(--ts)' }}>Code: RC-{a.id.slice(0, 4).toUpperCase()}</div>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px', borderTop: '1px solid var(--bd)', paddingTop: '10px' }}>
                            <Detail label="Contact" title={a.contact || 'info@agency.gov.rw'} />
                            <Detail label="Active Drivers" title={agencyDriversNum > 0 ? agencyDriversNum.toString() : "24"} />
                            <Detail label="Active Parcels" title={agencyTickets.length.toString()} />
                            <Detail label="Trust Score" title="9.8/10" />
                          </div>
                          <button 
                            className="btn btn-outline" 
                            style={{ fontSize: '11px', padding: '6px' }}
                            onClick={() => setSelectedAgencyId(a.id)}
                          >
                            Manage Agency Control Room
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* DRIVERS PAGE */}
          <div id="page-drivers" className={currentPage !== 'drivers' ? 'hidden' : ''}>
            <div className="section-title" style={{ marginBottom: '16px' }}>Driver Dispatch & Mobile GPS Broadcaster</div>
            
            <div className="grid-2">
              <div className="card">
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>Driver Registry & Fleet Status</div>
                <table>
                  <thead><tr><th>Driver Name</th><th>License No.</th><th>Agency</th><th>Vehicle</th><th>Status</th></tr></thead>
                  <tbody>
                    {drivers.length > 0 ? drivers.map(d => (
                      <tr key={d.id}>
                        <td style={{ fontWeight: '500' }}>{d.name}</td>
                        <td style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: '11px' }}>{d.license}</td>
                        <td>{d.agency}</td>
                        <td>{d.vehicle}</td>
                        <td><span className={`badge ${d.status === 'On Duty' ? 'badge-green' : 'badge-amber'}`}>{d.status}</span></td>
                      </tr>
                    )) : (
                      <>
                        <tr><td>Kalisa Jean</td><td>RT-920-K</td><td>Ritco</td><td>Toyota Dyna</td><td><span className="badge badge-green">On Duty</span></td></tr>
                        <tr><td>Mugisha Eric</td><td>RT-441-A</td><td>Zebre Express</td><td>Isuzu FSR</td><td><span className="badge badge-amber">Resting</span></td></tr>
                        <tr><td>Niyonkuru Solange</td><td>RT-882-L</td><td>LogExpress</td><td>Mitsubishi Canter</td><td><span className="badge badge-green">On Duty</span></td></tr>
                        <tr><td>Habimana Theo</td><td>RT-103-X</td><td>Capital Express</td><td>Hino 300</td><td><span className="badge badge-green">On Duty</span></td></tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>

              {/* LIVE PHONE GPS SIMULATOR & TRANSMITTER HUB */}
              <div className="card" style={{ border: '1px solid var(--bd, #e5e7eb)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span className="relative flex h-3 w-3">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${gpsBroadcasting || isSimulationActive ? 'bg-rose-400' : 'bg-neutral-400'} opacity-75`}></span>
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${gpsBroadcasting || isSimulationActive ? 'bg-rose-600' : 'bg-neutral-400'}`}></span>
                  </span>
                  <div style={{ fontSize: '13px', fontWeight: '700' }}>Mobile GPS Broadcaster Hub</div>
                </div>
                <p className="text-ts" style={{ fontSize: '11px', marginBottom: '14px' }}>
                  Simulates a driver's mobile phone GPS sensor. Select an active parcel ticket to broadcast live device tracking coordinates across the Rwanda Fleet Network.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <div className="label">Select Dispatch Ticket to Broadcast</div>
                    <select
                      className="input"
                      value={broadcastingTicketId}
                      onChange={(e) => {
                        stopLiveGpsBroadcast();
                        setBroadcastingTicketId(e.target.value);
                      }}
                      disabled={gpsBroadcasting || isSimulationActive}
                    >
                      <option value="">-- Choose Active Transit Parcel --</option>
                      {tickets
                        .filter(t => t.status !== 'Delivered')
                        .map(t => (
                          <option key={t.id} value={t.id}>
                            #RW-{t.id.slice(0, 4).toUpperCase()} | {t.route} ({t.agency || 'Zebre Express'})
                          </option>
                        ))}
                    </select>
                  </div>

                  {broadcastingTicketId ? (
                    <div style={{ background: 'var(--bg2)', padding: '12px', borderRadius: '6px' }}>
                      <div style={{ display: 'flex', justifyBetween: 'space-between', fontSize: '11px', marginBottom: '8px' }}>
                        <span style={{ color: 'var(--ts)', fontWeight: '500' }}>Active Broadcast Target: </span>
                        <strong style={{ fontFamily: 'var(--font-mono,monospace)' }}>
                          #RW-{broadcastingTicketId.slice(0, 4).toUpperCase()}
                        </strong>
                      </div>

                      {gpsBroadcasting || isSimulationActive ? (
                        <div style={{ marginBottom: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e11d48', fontSize: '11px', fontWeight: '700' }}>
                            <span className="animate-spin inline-block rounded-full h-3 w-3 border-t-2 border-r-2 border-rose-600 border-solid"></span>
                            <span>
                              {isSimulationActive ? '📡 VIRTUAL DRIVE SIMULATOR ACTIVE' : '📡 PHONE GPS BROADCAST ACTIVE'}
                            </span>
                          </div>

                          {broadcastingCoords && (
                            <div style={{ marginTop: '8px', padding: '6px 8px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '4px', fontFamily: 'var(--font-mono,monospace)', fontSize: '11px', color: '#e11d48', display: 'flex', justifyContent: 'space-between' }}>
                              <span>LAT: {broadcastingCoords.lat.toFixed(5)}</span>
                              <span>LNG: {broadcastingCoords.lng.toFixed(5)}</span>
                            </div>
                          )}

                          {isSimulationActive ? (
                            <div style={{ marginTop: '8.5px', fontSize: '10.5px', color: 'var(--ts)' }}>
                              Auto-progressing vehicle smoothly along the route. View this ticket in the <b>Live Tracking</b> page to see the marker drive live!
                            </div>
                          ) : (
                            <div style={{ marginTop: '8.5px', fontSize: '10.5px', color: 'var(--ts)' }}>
                              Streaming core coordinates from physical location sensors inside browser environment.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-ts" style={{ fontSize: '11px', marginBottom: '10px' }}>
                          Sensor is idle. Choose whether to simulate route transit drive automatically or trigger real physical mock updates.
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px' }}>
                        {!gpsBroadcasting && !isSimulationActive ? (
                          <>
                            <button
                              className="btn btn-primary"
                              style={{ background: '#e11d48', color: '#fff' }}
                              onClick={() => startLiveGpsBroadcast(broadcastingTicketId)}
                            >
                              Share Device GPS
                            </button>
                            <button
                              className="btn btn-primary"
                              style={{ background: '#2563eb', color: '#fff' }}
                              onClick={() => {
                                setBroadcastingTicketId(broadcastingTicketId);
                                setIsSimulationActive(true);
                              }}
                            >
                              Run Route Simulator
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn"
                            style={{ gridColumn: 'span 2', background: '#374151', color: '#fff', padding: '8px' }}
                            onClick={stopLiveGpsBroadcast}
                          >
                            Stop Location Stream
                          </button>
                        )}
                      </div>

                      {/* TACTILE JOYSTICK COORDINATE NUDGER */}
                      {(gpsBroadcasting || isSimulationActive) && (
                        <div style={{ marginTop: '14px', borderTop: '1px solid var(--bd)', paddingTop: '12px' }}>
                          <span style={{ fontSize: '10.5px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--ts)' }}>
                            Manual GPS Joystick Controller
                          </span>
                          <p className="text-ts" style={{ fontSize: '10.5px', marginBottom: '8px' }}>
                            Manually nudge driver coordinates on the map. Simulates physical steering and movement.
                          </p>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                            <button className="btn" style={{ padding: '4px 10px', fontSize: '11px', background: 'var(--bg2)', border: '1px solid var(--bd)' }} onClick={() => nudgeCoordinates('N')}>Nudge North ▲</button>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button className="btn" style={{ padding: '4px 10px', fontSize: '11px', background: 'var(--bg2)', border: '1px solid var(--bd)' }} onClick={() => nudgeCoordinates('W')}>◀ West</button>
                              <div style={{ width: '60px', background: 'var(--bg2)', borderRadius: '4px', border: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justify: 'center' }}>
                                <span style={{ fontSize: '9px', fontWeight: 'bold' }}>GPS</span>
                              </div>
                              <button className="btn" style={{ padding: '4px 10px', fontSize: '11px', background: 'var(--bg2)', border: '1px solid var(--bd)' }} onClick={() => nudgeCoordinates('E')}>East ▶</button>
                            </div>
                            <button className="btn" style={{ padding: '4px 10px', fontSize: '11px', background: 'var(--bg2)', border: '1px solid var(--bd)' }} onClick={() => nudgeCoordinates('S')}>Nudge South ▼</button>
                          </div>
                        </div>
                      )}

                    </div>
                  ) : (
                    <div className="text-center text-ts" style={{ padding: '20px 10px', border: '1.5px dashed var(--bd)', borderRadius: '6px' }}>
                      No active ticket picked. Select an active parcel delivery target from the dropdown menu to initialize broadcaster sensors.
                    </div>
                  )}
                </div>

              </div>
            </div>

          </div>

          {/* RRA MODULE PAGE */}
          <div id="page-rra" className={currentPage !== 'rra' ? 'hidden' : ''}>
            <div className="section-title" style={{ marginBottom: '16px' }}>RRA Compliance & Tax Link</div>
            <div className="grid-2">
              <div className="card">
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>Clearance Records (EBM Sync)</div>
                <table>
                  <thead><tr><th>Ticket ID</th><th>Tax Base</th><th>VAT (18%)</th><th>Status</th></tr></thead>
                  <tbody>
                    {rraRecords.length > 0 ? rraRecords.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontFamily: 'var(--font-mono,monospace)', fontSize: '11px' }}>#RW-{r.ticketId.slice(0,4)}</td>
                        <td>RWF {r.amount}</td>
                        <td>RWF {Math.floor(r.amount * 0.18)}</td>
                        <td><span className={`badge ${r.status === 'Cleared' ? 'badge-green' : 'badge-amber'}`}>{r.status}</span></td>
                      </tr>
                    )) : (
                      <>
                        <tr><td>#RW-2840</td><td>45,000</td><td>8,100</td><td><span className="badge badge-green">Cleared</span></td></tr>
                        <tr><td>#RW-1192</td><td>12,500</td><td>2,250</td><td><span className="badge badge-green">Cleared</span></td></tr>
                        <tr><td>#RW-0931</td><td>88,000</td><td>15,840</td><td><span className="badge badge-amber">Review</span></td></tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>Compliance Health</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <ProgressRow label="EBM Integration" val={100} color="var(--g)" />
                  <ProgressRow label="Tax Filings (Monthly)" val={84} color="var(--g)" />
                  <ProgressRow label="Customs Documentation" val={62} color="var(--a)" />
                  <div style={{ padding: '12px', background: 'var(--bg2)', borderRadius: '6px', fontSize: '12px', marginTop: '10px' }}>
                    <div style={{ fontWeight: '600', marginBottom: '4px' }}>RRA Notification</div>
                    <div style={{ color: 'var(--ts)' }}>3 packages currently flagged for manual verification at the Gatuna border crossing. Action required.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ANALYTICS PAGE */}
          <div id="page-analytics" className={currentPage !== 'analytics' ? 'hidden' : ''}>
            <div className="section-title" style={{ marginBottom: '16px' }}>Performance Analytics Dashboard</div>
            <div className="grid-4" style={{ marginBottom: '20px' }}>
              <StatCard label="Total Revenue (M)" value="RWF 142.5" change="+12.4%" highlight />
              <StatCard label="Order Volume" value="12,842" change="+8.1%" highlight />
              <StatCard label="Avg. Delivery Time" value="4.2 Hrs" change="-0.5%" highlight />
              <StatCard label="Failed Deliveries" value="0.2%" change="+0.01%" fail />
            </div>
            <div className="grid-2">
              <div className="card">
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '16px' }}>Volume by Route (Weekly)</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '140px', padding: '0 10px' }}>
                  {[40, 70, 45, 90, 65, 30, 85].map((h, i) => (
                    <div key={i} style={{ flex: 1, background: 'var(--g)', height: `${h}%`, borderRadius: '4px 4px 0 0', opacity: 0.8 }}></div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ts)', marginTop: '8px', padding: '0 4px' }}>
                  <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                </div>
              </div>
              <div className="card">
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>Agency Market Share</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <ProgressRow label="Ritco" val={42} color="#1565C0" />
                  <ProgressRow label="Zebre Express" val={28} color="#2E7D32" />
                  <ProgressRow label="LogExpress" val={18} color="#F9A825" />
                  <ProgressRow label="Others" val={12} color="#455A64" />
                </div>
              </div>
            </div>
          </div>

          {/* ADMIN PANEL */}
          <div id="page-admin" className={currentPage !== 'admin' ? 'hidden' : ''}>
            <div className="section-title" style={{ marginBottom: '16px' }}>System Administrator Control Panel</div>
            <div className="grid-2">
              <div className="card">
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>System Status</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg2)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '12px' }}>Database Sync</div>
                    <div style={{ color: 'var(--g)', fontSize: '12px', fontWeight: '600' }}>OPERATIONAL</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg2)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '12px' }}>GPS Tracker API</div>
                    <div style={{ color: 'var(--g)', fontSize: '12px', fontWeight: '600' }}>ONLINE</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg2)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '12px' }}>RRA Link Gateway</div>
                    <div style={{ color: 'var(--a)', fontSize: '12px', fontWeight: '600' }}>LATENCY (240ms)</div>
                  </div>
                </div>
                <button className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>Purge System Cache</button>
              </div>
              <div className="card">
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>Recent Audit Logs</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    "User 'admin_ricky' logged in from 192.168.1.1",
                    "Ticket #RW-0291 status updated to 'Delivered'",
                    "EBM Clearance generated for Ticket #RW-9182",
                    "New Identity synchronized with Firestore Server",
                    "Automated backup completed successfully"
                  ].map((log, i) => (
                    <div key={i} style={{ fontSize: '11px', color: 'var(--ts)', borderBottom: '1px solid var(--bd)', paddingBottom: '6px' }}>
                      <span style={{ fontFamily: 'var(--font-mono,monospace)', marginRight: '8px' }}>[{new Date().toLocaleTimeString()}]</span>
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Dynamic Identity Management & User Provisioning Interface */}
            <div className="section-title" style={{ marginTop: '24px', marginBottom: '16px' }}>User Account Provisioning & Identity Directory</div>
            <div className="grid-2">
              <div className="card">
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>Provision New User Persona</div>
                <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <div className="label">Full Legal Name</div>
                    <input 
                      type="text" 
                      className="input" 
                      placeholder="e.g. Mutesi Alice"
                      value={newUserForm.name}
                      onChange={(e) => setNewUserForm(prev => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <div className="label">Email Address</div>
                    <input 
                      type="email" 
                      className="input" 
                      placeholder="e.g. alice.mutesi@ritco.rw"
                      value={newUserForm.email}
                      onChange={(e) => setNewUserForm(prev => ({ ...prev, email: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="grid-2" style={{ gap: '12px' }}>
                    <div>
                      <div className="label">System Role</div>
                      <select 
                        className="input"
                        value={newUserForm.role}
                        onChange={(e) => setNewUserForm(prev => ({ ...prev, role: e.target.value as UserPersona }))}
                      >
                        <option value="recipient">👤 Passenger (Search / Track)</option>
                        <option value="driver">🚌 Bus & Truck Driver</option>
                        <option value="operator">🏢 Agency Clerk</option>
                        <option value="customs">🛡️ RRA Officer</option>
                        <option value="admin">⚙️ Super Admin</option>
                      </select>
                    </div>
                    <div>
                      <div className="label">Organization Affiliate</div>
                      <select 
                        className="input"
                        value={newUserForm.agency}
                        onChange={(e) => setNewUserForm(prev => ({ ...prev, agency: e.target.value }))}
                      >
                        <option value="NCTA Regulator">NCTA Authority</option>
                        <option value="RRA Customs Department">Rwanda Revenue Authority</option>
                        {agencies.map(a => (
                          <option key={a.id} value={a.name}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  
                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    style={{ marginTop: '8px' }}
                    disabled={userCreationState === 'saving'}
                  >
                    {userCreationState === 'saving' ? 'Provisioning...' : 'Provision Live Identity'}
                  </button>

                  {userCreationState === 'success' && (
                    <div style={{ padding: '8px 12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--g)', borderRadius: '6px', color: 'var(--g)', fontSize: '11px', textAlign: 'center' }}>
                      ✓ User Provisioned Successfully! Profile synced in real-time.
                    </div>
                  )}
                </form>
              </div>

              <div className="card">
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '12px' }}>Registered Digital Identities (Firestore)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
                  {customUsers.length > 0 ? (
                    customUsers.map(u => (
                      <div 
                        key={u.id} 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between', 
                          padding: '12px', 
                          background: 'var(--bg2)', 
                          borderRadius: '8px',
                          border: currentCustomUserId === u.id ? '1px solid var(--g)' : '1px solid var(--bd)'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '12px', fontWeight: '600' }}>{u.name}</span>
                            <span 
                              style={{ 
                                fontSize: '8px', 
                                fontWeight: 'bold', 
                                textTransform: 'uppercase', 
                                background: PERSONA_DETAILS[u.role]?.color || 'var(--g)', 
                                color: '#111827',
                                padding: '1px 6px',
                                borderRadius: '4px'
                              }}
                            >
                              {u.role}
                            </span>
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--ts)', marginTop: '2px' }}>{u.email}</div>
                          <div style={{ fontSize: '9px', fontStyle: 'italic', opacity: 0.7, color: 'var(--ts)' }}>Affiliation: {u.agency || 'NCTA'}</div>
                        </div>

                        <span style={{ 
                          fontSize: '9px', 
                          fontWeight: '700', 
                          color: currentCustomUserId === u.id ? 'var(--g)' : 'var(--ts)',
                          background: currentCustomUserId === u.id ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.02)',
                          border: currentCustomUserId === u.id ? '1px solid var(--g)' : '1px solid var(--bd)',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          textTransform: 'uppercase'
                        }}>
                          {currentCustomUserId === u.id ? '👉 Active Session' : 'Synced'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ textAlign: 'center', padding: '32px 0' }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>👤</div>
                      <div style={{ fontSize: '12px', color: 'var(--ts)' }}>No custom user logins registered yet</div>
                      <p style={{ fontSize: '10px', color: 'var(--ts)', opacity: 0.6, marginTop: '4px' }}>Created users will appear here and sync in real-time across the workspace.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* FUNDRAISING PAGE */}
          <div id="page-fundraising" className={currentPage !== 'fundraising' ? 'hidden' : ''}>
             <div style={{ maxWidth: '800px', margin: '0 auto' }}>
               <div className="card" style={{ padding: '32px', marginBottom: '24px', position: 'relative', overflow: 'hidden' }}>
                 <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '150px', height: '150px', background: 'var(--g)', opacity: 0.05, borderRadius: '50%' }}></div>
                 
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                   <div style={{ color: 'var(--g)', fontWeight: '700', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Support Our Mission</div>
                   <div className="section-title" style={{ fontSize: '24px', margin: 0 }}>Modernizing Rwanda's Logistics, Together.</div>
                 </div>

                 <p style={{ fontSize: '15px', color: 'var(--ts)', lineHeight: '1.7', marginBottom: '24px' }}>
                   RC-TTS is more than just a tracking tool—it's a digital backbone for local commerce. 
                   By supporting us, you're directly funding the infrastructure that ensures packages 
                   reach every corner of Rwanda, from Kigali to the furthest districts, with speed and transparency.
                 </p>

                 <div className="grid-3" style={{ gap: '16px', marginBottom: '32px' }}>
                   <div style={{ background: 'var(--bg2)', padding: '16px', borderRadius: '12px', border: '1px solid var(--bd)' }}>
                     <div style={{ fontSize: '20px', marginBottom: '8px' }}>🚀</div>
                     <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '4px' }}>Scalability</div>
                     <div style={{ fontSize: '11px', color: 'var(--ts)' }}>Helping us handle 50,000+ monthly shipments.</div>
                   </div>
                   <div style={{ background: 'var(--bg2)', padding: '16px', borderRadius: '12px', border: '1px solid var(--bd)' }}>
                     <div style={{ fontSize: '20px', marginBottom: '8px' }}>🛰️</div>
                     <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '4px' }}>Real-time GPS</div>
                     <div style={{ fontSize: '11px', color: 'var(--ts)' }}>Integrating advanced satellite tracking for all routes.</div>
                   </div>
                   <div style={{ background: 'var(--bg2)', padding: '16px', borderRadius: '12px', border: '1px solid var(--bd)' }}>
                     <div style={{ fontSize: '20px', marginBottom: '8px' }}>🛡️</div>
                     <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '4px' }}>RRA Sync</div>
                     <div style={{ fontSize: '11px', color: 'var(--ts)' }}>Automating tax clearance so your goods move faster.</div>
                   </div>
                 </div>

                 <div style={{ background: 'linear-gradient(135deg, #FFCC00 0%, #FFD54F 100%)', borderRadius: '16px', padding: '24px', border: '2px solid #FFAB00', boxShadow: '0 8px 24px rgba(255, 204, 0, 0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                      <div style={{ width: '64px', height: '64px', borderRadius: '12px', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                         <svg width="40" height="40" viewBox="0 0 24 24" fill="#FFCC00"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '11px', fontWeight: '800', color: '#000', opacity: 0.6, textTransform: 'uppercase', marginBottom: '2px' }}>Official Donation Channel (interactive)</div>
                        <div style={{ fontSize: '18px', fontWeight: '800', color: '#000', marginBottom: '2px' }}>MTN Mobile Money</div>
                        <div style={{ fontSize: '24px', fontWeight: '900', color: '#000', fontFamily: 'var(--font-mono, monospace)', letterSpacing: '1px' }}>0788 300 300</div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1B5E20' }}>Account Name: RC-TTS PROJECT FUND</div>
                      </div>
                      {momoMode === 'idle' ? (
                         <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #FFAB00', minWidth: '320px' }}>
                           <div style={{ fontSize: '12px', fontWeight: '700', color: '#000' }}>Quick Online MoMo Simulator</div>
                           
                           {momoError && (
                             <div style={{ color: 'red', fontSize: '11px' }}>{momoError}</div>
                           )}

                           <div style={{ display: 'flex', gap: '8px' }}>
                             <select 
                               style={{ flex: 1, padding: '6px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px', color: '#000', background: '#fff' }}
                               value={momoAmount}
                               onChange={(e) => setMomoAmount(Number(e.target.value))}
                             >
                               <option value={1000}>1,000 RWF</option>
                               <option value={5000}>5,000 RWF</option>
                               <option value={10000}>10,000 RWF</option>
                               <option value={25000}>25,000 RWF</option>
                               <option value={50000}>50,000 RWF</option>
                             </select>
                             <input 
                               type="text" 
                               placeholder="Phone 078..." 
                               style={{ flex: 1.5, padding: '6px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px', color: '#000', background: '#fff' }}
                               value={momoPhone}
                               onChange={(e) => setMomoPhone(e.target.value)}
                             />
                           </div>
                           <button className="btn" style={{ background: '#000', color: '#FFCC00', border: 'none', padding: '8px 12px', borderRadius: '6px', fontWeight: '700', fontSize: '12px' }} onClick={(e) => handleMomoSubmit(e)}>
                             Simulate Push Request
                           </button>
                         </div>
                       ) : momoMode === 'initiating' ? (
                         <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #FFAB00', minWidth: '320px', textAlign: 'center' }}>
                           <div className="animate-spin" style={{ border: '3px solid rgba(0,0,0,0.1)', borderTop: '3px solid #000', borderRadius: '50%', width: '24px', height: '24px', margin: '0 auto 8px' }}></div>
                           <div style={{ fontSize: '11px', fontWeight: '700', color: '#000' }}>Contacting MTN...</div>
                         </div>
                       ) : momoMode === 'awaiting_pin' ? (
                         <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', border: '2px solid #D32F2F', minWidth: '320px' }}>
                           <div style={{ fontSize: '10px', fontWeight: '800', color: '#D32F2F', textTransform: 'uppercase', marginBottom: '4px' }}>Simulated MoMo Push Popup</div>
                           <div style={{ fontSize: '11px', fontWeight: '600', marginBottom: '8px', color: '#000' }}>Approve RWF {momoAmount.toLocaleString()}?</div>
                           <input 
                             type="password" 
                             maxLength={4} 
                             placeholder="MTN PIN (e.g. 1234)" 
                             style={{ fontSize: '12px', width: '100%', padding: '6px', border: '1px solid #ccc', borderRadius: '4px', marginBottom: '8px', textAlign: 'center', color: '#000', background: '#fff' }}
                             value={momoPin}
                             onChange={(e) => setMomoPin(e.target.value)}
                           />
                           <button className="btn" style={{ background: '#FFCC00', color: '#000', border: 'none', padding: '6px 12px', borderRadius: '4px', fontWeight: '700', fontSize: '11px', width: '100%' }} onClick={(e) => handlePinConfirm(e)}>
                             Submit PIN
                           </button>
                         </div>
                       ) : momoMode === 'processing' ? (
                         <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #FFAB00', minWidth: '320px', textAlign: 'center' }}>
                           <div className="animate-spin" style={{ border: '3px solid rgba(0,0,0,0.1)', borderTop: '3px solid #000', borderRadius: '50%', width: '24px', height: '24px', margin: '0 auto 8px' }}></div>
                           <div style={{ fontSize: '11px', fontWeight: '700', color: '#000' }}>Authorizing with Express server...</div>
                         </div>
                       ) : (
                         <div style={{ background: '#E8F5E9', padding: '16px', borderRadius: '12px', border: '1px solid #2E7D32', minWidth: '320px', textAlign: 'center' }}>
                           <div style={{ fontSize: '18px', marginBottom: '4px' }}>🎉</div>
                           <div style={{ fontSize: '12px', fontWeight: '800', color: '#1B5E20' }}>Payment Approved!</div>
                           <div style={{ fontSize: '11px', color: '#2E7D32', margin: '4px 0' }}>RWF {momoAmount.toLocaleString()} credited to Project Fund</div>
                           <button className="btn" style={{ background: '#000', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', fontSize: '10px', marginTop: '8px' }} onClick={() => setMomoMode('idle')}>
                             Done
                           </button>
                         </div>
                       )}
                    </div>
                 </div>

                 <div style={{ marginTop: '40px' }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                     <div style={{ fontSize: '14px', fontWeight: '700' }}>Project Funding Progress</div>
                     <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--g)' }}>{Math.round((fundraising.raised / fundraising.goal) * 100)}% Complete ({fundraising.contributors} supporters)</div>
                   </div>
                   <ProgressRow label="" val={Math.round((fundraising.raised / fundraising.goal) * 100)} color="var(--g3)" />
                   <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--ts)', marginTop: '8px' }}>
                     <div>Raised: <strong>RWF {fundraising.raised.toLocaleString()}</strong></div>
                     <div>Goal: <strong>RWF {fundraising.goal.toLocaleString()}</strong></div>
                   </div>
                 </div>

                 <div style={{ marginTop: '40px', paddingTop: '32px', borderTop: '1px solid var(--bd)' }}>
                   <div className="section-title" style={{ fontSize: '16px', marginBottom: '16px', textAlign: 'center' }}>How Your Support Impacts Rwanda</div>
                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                     <div style={{ display: 'flex', gap: '12px' }}>
                       <div style={{ color: 'var(--g)', fontSize: '20px' }}>✓</div>
                       <div>
                         <div style={{ fontSize: '13px', fontWeight: '600' }}>Server Maintenance</div>
                         <div style={{ fontSize: '11px', color: 'var(--ts)' }}>Ensuring 99.9% uptime for critical courier ops.</div>
                       </div>
                     </div>
                     <div style={{ display: 'flex', gap: '12px' }}>
                       <div style={{ color: 'var(--g)', fontSize: '20px' }}>✓</div>
                       <div>
                         <div style={{ fontSize: '13px', fontWeight: '600' }}>Local Jobs</div>
                         <div style={{ fontSize: '11px', color: 'var(--ts)' }}>Supporting a team of 4 local Rwandan developers.</div>
                       </div>
                     </div>
                     <div style={{ display: 'flex', gap: '12px' }}>
                       <div style={{ color: 'var(--g)', fontSize: '20px' }}>✓</div>
                       <div>
                         <div style={{ fontSize: '13px', fontWeight: '600' }}>Free Citizen Access</div>
                         <div style={{ fontSize: '11px', color: 'var(--ts)' }}>Keeping tracking free for all individual users.</div>
                       </div>
                     </div>
                     <div style={{ display: 'flex', gap: '12px' }}>
                       <div style={{ color: 'var(--g)', fontSize: '20px' }}>✓</div>
                       <div>
                         <div style={{ fontSize: '13px', fontWeight: '600' }}>Regional Expansion</div>
                         <div style={{ fontSize: '11px', color: 'var(--ts)' }}>Adding more border crossings and rural routes.</div>
                       </div>
                     </div>
                   </div>
                 </div>

                 <div style={{ marginTop: '40px', padding: '24px', textAlign: 'center', background: 'var(--bg2)', borderRadius: '12px' }}>
                   <div style={{ fontSize: '14px', fontStyle: 'italic', color: 'var(--ts)', marginBottom: '12px' }}>
                     "Technology is most powerful when it connects us. Your contribution is the fuel for our progress."
                   </div>
                   <div style={{ fontSize: '12px', fontWeight: '700' }}>— The RC-TTS Founding Team</div>
                   </div>
                 </div>
               </div>
            </div>
          </div>
        </div>
      </div>
  );
}
function NavItem({ active, icon, label, onClick }: any) {
  return (
    <div className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      {label}
    </div>
  );
}

function StatCard({ label, value, change, highlight, fail }: any) {
  return (
    <div className="card card-sm">
      <div className="stat-lbl">{label}</div>
      <div className="stat-val">{value}</div>
      <div className={`stat-change ${highlight ? 'stat-up' : fail ? 'stat-dn' : ''}`}>{change}</div>
    </div>
  );
}

function ProgressRow({ label, val, color }: any) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px' }}>
        <span>{label}</span><span style={{ color: 'var(--ts)' }}>{val}%</span>
      </div>
      <div className="progress"><div className="progress-fill" style={{ width: `${val}%`, background: color }}></div></div>
    </div>
  );
}

function FeedItem({ id, msg, status, time, blue, amber }: any) {
  return (
    <div className="notif">
      <span className={`dot ${blue ? 'dot-blue' : amber ? 'dot-amber' : 'dot-green'}`}></span>
      <strong>{id}</strong> {msg} {status && <span className="badge badge-green" style={{ fontSize: '10px' }}>{status}</span>}
      <div className="notif-time">{time}</div>
    </div>
  );
}

function Detail({ label, title, sub, green }: any) {
  return (
    <div>
      <div className="label">{label}</div>
      <div style={{ fontSize: '13px', fontWeight: '500', color: green ? 'var(--g)' : '' }}>{title}</div>
      {sub && <div style={{ fontSize: '12px', color: 'var(--ts)' }}>{sub}</div>}
    </div>
  );
}

function TimelineStep({ done, active, icon, label }: any) {
  return (
    <div className={`tstep ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
      <div className="tstep-dot">{icon}</div>
      <div className="tstep-lbl">{label}</div>
    </div>
  );
}

function TimelineRow({ time, msg, green, amber }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
      <span className={`dot ${green ? 'dot-green' : amber ? 'dot-amber' : 'dot-gray'}`}></span>
      <span style={{ color: 'var(--ts)', minWidth: '56px' }}>{time}</span> {msg}
    </div>
  );
}

function Placeholder({ title }: any) {
  return (
    <div className="card text-center py-20">
      <div className="section-title">{title}</div>
      <p className="text-ts">Module integration pending live sync.</p>
    </div>
  );
}

const AGENCIES = ["Zebre Car Express", "Ritco", "Capital Express", "LogExpress", "Swift RW", "EastLink Courier", "Horizon Transport", "PaceSetter Express"];

const NavIconSquare = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" /><rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>;
const NavIconPin = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="7" r="4" /><path d="M8 11v4M5 3.5L3 2M11 3.5L13 2" /></svg>;
const NavIconPlus = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M5 7h6M5 10h4" /></svg>;
const NavIconList = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h8" /></svg>;
const NavIconBuilding = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="6" width="14" height="9" rx="1" /><path d="M5 6V4a3 3 0 016 0v2" /></svg>;
const NavIconUsers = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" /></svg>;
const NavIconShield = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 8l2 2 4-4" /></svg>;
const NavIconChart = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 12l4-4 3 3 5-6" /></svg>;
const NavIconCog = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2.5" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2" /></svg>;
const NavIconHeart = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 13s-5-3.5-5-7a3 3 0 015-2.5 3 3 0 015 2.5c0 3.5-5 7-5 7z" /></svg>;
