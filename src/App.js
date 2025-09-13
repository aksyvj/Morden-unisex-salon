import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  onSnapshot,
  query,
  where,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';

// --- Gemini API Helper ---
const callGeminiAPI = async (prompt) => {
    // This part remains the same, relying on the environment for the Gemini key.
    const apiKey = ""; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const payload = { contents: [{ parts: [{ text: prompt }] }] };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`API call failed: ${response.status}`);
        const result = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, couldn't generate a response.";
    } catch (error) {
        console.error("Gemini API call error:", error);
        return "An error occurred while fetching suggestions.";
    }
};

// --- App Context for State Management ---
const AppContext = createContext();

// --- New Component: Firebase Setup Screen ---
const FirebaseSetup = ({ onConfigReady }) => {
    const [configInput, setConfigInput] = useState('');
    const [error, setError] = useState('');

    const handleSaveConfig = () => {
        setError('');
        try {
            // A simple trick to handle JSON that might be part of a JS variable declaration
            const jsonString = configInput.substring(configInput.indexOf('{'), configInput.lastIndexOf('}') + 1);
            const parsedConfig = JSON.parse(jsonString);
            
            // Basic validation
            if (!parsedConfig.apiKey || !parsedConfig.projectId) {
                throw new Error("Invalid config: missing apiKey or projectId.");
            }

            localStorage.setItem('firebaseConfig', JSON.stringify(parsedConfig));
            onConfigReady(parsedConfig);
        } catch (e) {
            console.error("Invalid Firebase Config:", e);
            setError("The provided configuration is not valid JSON. Please paste the entire config object from the Firebase console.");
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#111111]">
            <div className="w-full max-w-2xl p-8 space-y-6 bg-[#1A1A1A] border border-gray-800 rounded-3xl">
                <div className="text-center">
                    <h1 className="text-4xl uppercase font-headline text-glow-lime">One-Time Setup</h1>
                    <p className="mt-2 text-gray-400">Please provide your Firebase configuration to start the app.</p>
                </div>
                {error && <p className="text-red-500 text-center text-sm bg-red-900/50 p-3 rounded-lg">{error}</p>}
                <div>
                    <label className="block mb-2 text-sm font-bold text-gray-300" htmlFor="config-input">
                        Firebase Config Object
                    </label>
                    <textarea
                        id="config-input"
                        value={configInput}
                        onChange={(e) => setConfigInput(e.target.value)}
                        placeholder={`const firebaseConfig = {\n  apiKey: "...",\n  ...\n};`}
                        className="w-full h-64 p-3 font-mono text-sm bg-[#111111] border-2 border-gray-700 rounded-xl focus:border-[#D7FC00] focus:ring-0 outline-none"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                        Find this in your Firebase Project Settings &gt; General &gt; Your Apps &gt; SDK setup and configuration.
                    </p>
                </div>
                <button 
                    onClick={handleSaveConfig} 
                    className="w-full py-3 px-4 bg-[#D7FC00] text-black rounded-xl font-bold uppercase tracking-wider hover:glow-lime transition-all duration-300"
                >
                    Save & Start App
                </button>
            </div>
        </div>
    );
};


// --- Main App Component ---
export default function App() {
  const [firebaseConfig, setFirebaseConfig] = useState(null);
  const [firebaseServices, setFirebaseServices] = useState(null);
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [route, setRoute] = useState('/login'); 

  // 1. Check for config on initial load
  useEffect(() => {
    let config = null;
    try {
        // First, try the injected variable
        if (typeof __firebase_config !== 'undefined' && __firebase_config) {
            config = JSON.parse(__firebase_config);
        } else {
            // Fallback to localStorage
            const storedConfig = localStorage.getItem('firebaseConfig');
            if (storedConfig) {
                config = JSON.parse(storedConfig);
            }
        }
    } catch(e) {
        console.error("Failed to load Firebase config:", e);
        localStorage.removeItem('firebaseConfig'); // Clear potentially corrupt config
    }
    setFirebaseConfig(config);
  }, []);

  // 2. Initialize Firebase *after* config is available
  useEffect(() => {
    if (firebaseConfig && !firebaseServices) {
        try {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            const db = getFirestore(app);
            setFirebaseServices({ app, auth, db });
        } catch (e) {
            console.error("Failed to initialize Firebase:", e);
            // If init fails, clear the bad config to prompt user again
            setFirebaseConfig(null);
            localStorage.removeItem('firebaseConfig');
        }
    }
  }, [firebaseConfig, firebaseServices]);
  
  // 3. Listen for auth state changes *after* Firebase is initialized
  useEffect(() => {
    if (!firebaseServices) return;

    const { auth, db } = firebaseServices;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        const userDocRef = doc(db, "users", currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const data = userDocSnap.data();
          setUserData(data);
          if (data.role === 'owner' || data.role === 'staff') {
             setRoute('/dashboard/queue');
          } else {
             setRoute('/services');
          }
        } else {
          const newUser = {
            uid: currentUser.uid,
            displayName: currentUser.displayName,
            phoneNumber: currentUser.phoneNumber,
            email: currentUser.email,
            role: 'customer',
            createdAt: serverTimestamp(),
          };
          await setDoc(userDocRef, newUser);
          setUserData(newUser);
          setRoute('/services');
        }
      } else {
        setUser(null);
        setUserData(null);
        const currentPath = window.location.pathname;
        if (currentPath.startsWith('/kiosk')) {
            setRoute(currentPath);
        } else {
            setRoute('/login');
        }
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, [firebaseServices]);

  const navigate = (path) => {
    window.history.pushState(null, '', path);
    setRoute(path);
  };
  
  useEffect(() => {
    const handlePopState = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const renderContent = () => {
    // Show setup screen if config is missing
    if (!firebaseConfig) {
        return <FirebaseSetup onConfigReady={setFirebaseConfig} />;
    }
    
    // Show loader while Firebase initializes and checks auth
    if (!firebaseServices || authLoading) {
      return <LoadingSpinner />;
    }
    
    const kioskRegex = /^\/kiosk(\/.*)?$/;
    if (kioskRegex.test(route)) {
        if(route === '/kiosk' || route === '/kiosk/home') return <KioskHomePage navigate={navigate} />;
        if(route === '/kiosk/join') return <KioskJoinQueuePage navigate={navigate} />;
        if(route === '/kiosk/board') return <KioskQueueBoardPage navigate={navigate} />;
        return <KioskHomePage navigate={navigate} />
    }

    if (!user) {
      return <LoginPage navigate={navigate} />;
    }

    if (userData?.role === 'owner' || userData?.role === 'staff') {
        return <DashboardLayout navigate={navigate} route={route} />;
    }

    switch (route) {
      case '/services':
        return <ServiceSelectionPage navigate={navigate} />;
      case '/queue-status':
        return <QueueStatusPage navigate={navigate} />;
      default:
        return <ServiceSelectionPage navigate={navigate} />;
    }
  };

  return (
    <AppContext.Provider value={{ user, userData, navigate, ...firebaseServices }}>
      <div className="bg-[#111111] min-h-screen text-white font-['Inter']">
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;700&family=Montserrat:wght@800&display=swap');
            .font-headline { font-family: 'Bebas Neue', sans-serif; }
            .glow-lime { box-shadow: 0 0 5px #D7FC00, 0 0 15px #D7FC00, 0 0 25px #D7FC00; }
            .glow-violet { box-shadow: 0 0 5px #7B2CF6, 0 0 15px #7B2CF6, 0 0 25px #7B2CF6; }
            .text-glow-lime { text-shadow: 0 0 4px #D7FC00; }
            .animate-fade-in { animation: fadeIn 0.5s ease-in-out; }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            .gemini-response { white-space: pre-wrap; }
          `}
        </style>
        {renderContent()}
      </div>
    </AppContext.Provider>
  );
}

// --- Helper & Icon Components (No Changes) ---
const LoadingSpinner=()=>(<div className="flex items-center justify-center min-h-screen"><div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-[#D7FC00]"></div></div>);
const ScissorsIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="6" cy="6" r="3"></circle><path d="M8.12 8.12 12 12"></path><path d="M20 4 8.12 15.88"></path><circle cx="6" cy="18" r="3"></circle><path d="M14.88 14.88 20 20"></path></svg>);
const UserIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>);
const ClockIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>);
const RupeeIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M6 3h12"></path><path d="M6 8h12"></path><path d="m18 13-2.5-4-5 8-5-8L3 13"></path></svg>);
const QueueIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M8 12h8"/><path d="M8 16h8"/><path d="M14 4.5 12 2 10 4.5"/><path d="M14 19.5 12 22 10 19.5"/><path d="M7 12a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z"/><path d="M17 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/></svg>);
const SettingsIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 0 2.22l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l-.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1 0-2.22l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>);
const PlusIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>);
const TrashIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>);
const EditIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>);
const LogoutIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>);
const SparklesIcon=({className})=>(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m12 3-1.9 3.9-3.9 1.9 3.9 1.9 1.9 3.9 1.9-3.9 3.9-1.9-3.9-1.9Z"/><path d="M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"/></svg>);

// --- All other components (Modals, Login, Customer Portal, Dashboard, Kiosk) remain largely the same, ---
// --- but now they correctly receive firebase `auth` and `db` instances via context. ---
// --- For brevity, I'll show the changes only where they directly interact with context. ---

const AlertModal = ({ title, message, onClose }) => ( <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fade-in"><div className="bg-[#1A1A1A] border border-gray-800 rounded-2xl p-8 w-full max-w-sm text-center"><h3 className="text-xl font-bold font-headline mb-4 text-white">{title || 'Alert'}</h3><p className="text-gray-300 mb-6">{message}</p><button onClick={onClose} className="w-full py-2 bg-[#D7FC00] text-black rounded-lg font-bold hover:glow-lime">OK</button></div></div>);
const ConfirmModal = ({ title, message, onConfirm, onCancel, confirmText = 'Confirm' }) => (<div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fade-in"><div className="bg-[#1A1A1A] border border-gray-800 rounded-2xl p-8 w-full max-w-sm text-center"><h3 className="text-xl font-bold font-headline mb-4 text-white">{title || 'Confirm'}</h3><p className="text-gray-300 mb-6">{message}</p><div className="flex gap-4"><button onClick={onCancel} className="w-full py-2 bg-gray-700 rounded-lg font-bold hover:bg-gray-600">Cancel</button><button onClick={onConfirm} className="w-full py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-500">{confirmText}</button></div></div></div>);
const StyleIdeasModal = ({ serviceName, onClose }) => { const [ideas, setIdeas] = useState(''); const [isLoading, setIsLoading] = useState(true); useEffect(() => { const fetchIdeas = async () => { setIsLoading(true); const prompt = `I'm waiting at a salon to get a "${serviceName}". Give me 3 creative and trendy style ideas or hair care tips related to this service. Keep it concise and exciting. Format it with titles and short descriptions.`; const result = await callGeminiAPI(prompt); setIdeas(result); setIsLoading(false); }; fetchIdeas(); }, [serviceName]); return (<div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fade-in"><div className="bg-[#1A1A1A] border border-[#7B2CF6] rounded-2xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto"><div className="flex justify-between items-center mb-4"><h3 className="text-2xl font-headline text-glow-lime flex items-center gap-2">✨ Style & Care Ideas</h3><button onClick={onClose} className="text-gray-500 hover:text-white">&times;</button></div>{isLoading ? (<div className="flex justify-center items-center h-48"><LoadingSpinner /></div>) : (<div className="gemini-response text-gray-300">{ideas}</div>)}</div></div>);};

// --- Authentication Components ---
const LoginPage = ({ navigate }) => {
  const { auth } = useContext(AppContext);
  const [mode, setMode] = useState('select'); 
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [error, setError] = useState('');
  
  const recaptchaVerifier = useRef(null);

  const setupRecaptcha = () => {
    // Ensure auth is loaded before creating verifier
    if (auth && !recaptchaVerifier.current) {
        recaptchaVerifier.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
          'size': 'invisible',
          'callback': () => {},
        });
    }
  };

  useEffect(() => {
    // Setup recaptcha once auth is available.
    if(auth) setupRecaptcha();
  }, [auth]);


  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      navigate('/services');
    } catch (err) {
      if (err.code === 'auth/unauthorized-domain') {
          setError("This domain is not authorized for login. Please add it to your Firebase project settings under Authentication > Settings > Authorized domains.");
      } else {
          setError(err.message);
      }
      console.error("Google login error:", err);
    }
  };

  const handlePhoneLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const result = await signInWithPhoneNumber(auth, `+91${phoneNumber}`, recaptchaVerifier.current);
      setConfirmationResult(result);
      setMode('otp');
    } catch (err) {
      let errorMessage = 'Failed to send OTP. Make sure reCAPTCHA can load and the number is correct.';
      if (err.code === 'auth/internal-error' || err.code === 'auth/unauthorized-domain') {
          errorMessage = "This domain is not authorized for login. Please add it to your Firebase project's 'Authorized domains' list in the Authentication > Settings page."
      }
      setError(errorMessage);
      console.error("Phone login error:", err);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!confirmationResult) {
        setError("Something went wrong. Please try sending OTP again.");
        return;
    }
    try {
      await confirmationResult.confirm(otp);
      navigate('/services');
    } catch (err) {
      setError('Invalid OTP. Please try again.');
      console.error("OTP verification error:", err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-grid-[#1A1A1A]">
      <div id="recaptcha-container"></div>
      <div className="w-full max-w-md p-8 space-y-8 bg-[#1A1A1A] border border-gray-800 rounded-3xl shadow-2xl shadow-[#7B2CF6]/10">
        <div className="text-center">
          <h1 className="text-5xl uppercase font-headline text-glow-lime">Salon Q</h1>
          <p className="mt-2 text-gray-400">Your Modern Queue Solution</p>
        </div>
        {error && <p className="text-red-500 text-center text-sm p-3 bg-red-900/20 rounded-lg">{error}</p>}
        {/* The rest of the JSX is identical to before */}
        {mode === 'select' && (
          <div className="space-y-4">
            <button onClick={handleGoogleLogin} className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white text-black rounded-xl font-bold hover:bg-gray-200 transition-all duration-300">
              <svg className="w-6 h-6" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"></path><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"></path><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"></path><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.012 36.417 44 30.836 44 24c0-1.341-.138-2.65-.389-3.917z"></path></svg>
              Sign in with Google
            </button>
            <button onClick={() => setMode('phone')} className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-[#0077FF] text-white rounded-xl font-bold hover:bg-[#005ECC] transition-all duration-300">
               <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              Sign in with Mobile
            </button>
            <button onClick={() => navigate('/kiosk')} className="w-full text-center text-sm text-gray-400 hover:text-[#D7FC00] pt-4">Continue to Kiosk Mode</button>
          </div>
        )}
        {mode === 'phone' && (
          <form onSubmit={handlePhoneLogin} className="space-y-6"><div className="relative"><div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">+91</div><input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Enter 10-digit mobile number" className="w-full pl-12 pr-3 py-3 bg-[#111111] border-2 border-gray-700 rounded-xl focus:border-[#D7FC00] focus:ring-0 outline-none" required /></div><button type="submit" className="w-full py-3 px-4 bg-[#D7FC00] text-black rounded-xl font-bold uppercase tracking-wider hover:glow-lime transition-all duration-300">Send OTP</button><button onClick={() => setMode('select')} className="w-full text-center text-sm text-gray-400 hover:text-white">Back</button></form>
        )}
        {mode === 'otp' && (
          <form onSubmit={handleOtpSubmit} className="space-y-6"><p className="text-center text-gray-300">Enter OTP sent to +91 {phoneNumber}</p><input type="text" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit OTP" className="w-full text-center tracking-[0.5em] py-3 bg-[#111111] border-2 border-gray-700 rounded-xl focus:border-[#D7FC00] focus:ring-0 outline-none" required /><button type="submit" className="w-full py-3 px-4 bg-[#D7FC00] text-black rounded-xl font-bold uppercase tracking-wider hover:glow-lime transition-all duration-300">Verify OTP</button><button onClick={() => { setMode('phone'); setOtp(''); setError(''); }} className="w-full text-center text-sm text-gray-400 hover:text-white">Change Number</button></form>
        )}
      </div>
    </div>
  );
};


// The rest of the components (ServiceSelectionPage, QueueStatusPage, DashboardLayout, etc.)
const ServiceCard = ({ service, onJoinQueue }) => (<div className="bg-[#1A1A1A] border border-gray-800 rounded-3xl p-6 flex flex-col items-start space-y-4 transform hover:-translate-y-2 transition-transform duration-300 group"><div className="w-12 h-12 bg-[#7B2CF6]/10 border-2 border-[#7B2CF6] rounded-xl flex items-center justify-center"><ScissorsIcon className="w-6 h-6 text-[#7B2CF6]" /></div><h3 className="text-2xl font-bold font-headline uppercase tracking-wider text-white">{service.name}</h3><div className="flex items-center space-x-4 text-gray-400"><div className="flex items-center space-x-2"><ClockIcon className="w-5 h-5"/><span>{service.duration} mins</span></div><div className="flex items-center space-x-2"><RupeeIcon className="w-5 h-5"/><span>{service.price}</span></div></div><p className="text-gray-500 flex-grow">{service.description || "A high-quality service by our expert stylists."}</p><button onClick={() => onJoinQueue(service)} className="w-full mt-auto py-3 px-4 bg-transparent border-2 border-[#D7FC00] text-[#D7FC00] rounded-xl font-bold uppercase tracking-wider group-hover:bg-[#D7FC00] group-hover:text-black group-hover:glow-lime transition-all duration-300">Join Queue</button></div>);
const ServiceSelectionPage = ({ navigate }) => { const [services, setServices] = useState([]); const { user, db, auth } = useContext(AppContext); const [alertInfo, setAlertInfo] = useState({ show: false, message: '' }); useEffect(() => { if (!db) return; const q = query(collection(db, "services")); const unsubscribe = onSnapshot(q, (querySnapshot) => { const servicesData = []; querySnapshot.forEach((doc) => { servicesData.push({ id: doc.id, ...doc.data() }); }); setServices(servicesData); }); return () => unsubscribe(); }, [db]); const handleJoinQueue = async (service) => { if (!user || !db) return; const q = query(collection(db, "queue"), where("userId", "==", user.uid), where("status", "in", ["waiting", "in-service"])); const existingQueueSnapshot = await getDocs(q); if (!existingQueueSnapshot.empty) { setAlertInfo({ show: true, message: "You are already in the queue." }); return; } const queueCollection = collection(db, "queue"); const allQueueSnapshot = await getDocs(query(queueCollection, where("status", "in", ["waiting", "in-service"]))); const queueNumber = allQueueSnapshot.size + 1; await addDoc(queueCollection, { userId: user.uid, userName: user.displayName || user.phoneNumber, userPhone: user.phoneNumber, serviceId: service.id, serviceName: service.name, serviceDuration: service.duration, status: "waiting", queueNumber: queueNumber, createdAt: serverTimestamp() }); navigate('/queue-status'); }; const closeAlert = () => { setAlertInfo({ show: false, message: '' }); navigate('/queue-status'); }; return (<div className="p-4 sm:p-8 max-w-7xl mx-auto">{alertInfo.show && <AlertModal title="Already in Queue" message={alertInfo.message} onClose={closeAlert} />}<header className="flex justify-between items-center mb-8"><h1 className="text-4xl sm:text-6xl font-headline uppercase text-glow-lime">Select a Service</h1><button onClick={() => signOut(auth)} className="flex items-center gap-2 text-gray-400 hover:text-white"><LogoutIcon className="w-5 h-5" /> Logout</button></header><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{services.length > 0 ? services.map(service => (<ServiceCard key={service.id} service={service} onJoinQueue={handleJoinQueue} />)) : <p>Loading services...</p>}</div></div>); };
const QueueStatusPage = ({ navigate }) => { const { user, db } = useContext(AppContext); const [queueEntry, setQueueEntry] = useState(null); const [queuePosition, setQueuePosition] = useState(0); const [estimatedWait, setEstimatedWait] = useState(0); const [showStyleIdeas, setShowStyleIdeas] = useState(false); useEffect(() => { if (!user || !db) return; const q = query(collection(db, "queue"), where("userId", "==", user.uid), where("status", "in", ["waiting", "in-service"]), limit(1)); const unsubscribe = onSnapshot(q, (snapshot) => { if (!snapshot.empty) { const entry = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() }; setQueueEntry(entry); } else { setQueueEntry(null); navigate('/services'); } }); return () => unsubscribe(); }, [user, db, navigate]); useEffect(() => { if (!user || !db) return; const q = query(collection(db, "queue"), where("status", "in", ["waiting", "in-service"]), orderBy("createdAt")); const unsubscribe = onSnapshot(q, (snapshot) => { let position = 0; let waitTime = 0; let found = false; snapshot.docs.forEach((doc, index) => { const data = doc.data(); if (data.userId === user?.uid) { position = index + 1; found = true; } if (!found && data.status === 'waiting') { waitTime += data.serviceDuration; } }); setQueuePosition(position); setEstimatedWait(waitTime); }); return () => unsubscribe(); }, [user, db]); if (!queueEntry) { return (<div className="flex flex-col items-center justify-center min-h-screen text-center p-4"><h2 className="text-2xl text-gray-400">You are not in the queue.</h2><button onClick={() => navigate('/services')} className="mt-4 py-3 px-6 bg-[#D7FC00] text-black rounded-xl font-bold uppercase">Join a Queue</button></div>); } if (queueEntry.status === 'in-service') { return (<div className="flex flex-col items-center justify-center min-h-screen text-center p-4 animate-fade-in"><div className="bg-[#1A1A1A] border-2 border-[#D7FC00] rounded-3xl p-8 sm:p-12 w-full max-w-lg glow-lime"><p className="text-xl text-gray-300 mb-2">It's your turn!</p><h2 className="text-4xl sm:text-6xl font-bold font-headline uppercase text-white mb-4">You are now in service</h2><p className="text-2xl font-bold text-[#D7FC00]">{queueEntry.serviceName}</p></div></div>) } return (<div className="flex flex-col items-center justify-center min-h-screen text-center p-4 animate-fade-in">{showStyleIdeas && <StyleIdeasModal serviceName={queueEntry.serviceName} onClose={() => setShowStyleIdeas(false)} />}<div className="bg-[#1A1A1A] border border-gray-800 rounded-3xl p-8 sm:p-12 w-full max-w-lg"><p className="text-2xl text-gray-300 mb-2">Your Position in Queue</p><h2 className="text-8xl sm:text-9xl font-bold font-headline text-[#D7FC00] text-glow-lime">{queuePosition}</h2><div className="my-8"><p className="text-xl text-gray-300 mb-2">Estimated Wait Time</p><h3 className="text-5xl font-bold text-white">{estimatedWait} mins</h3></div><div className="w-full bg-gray-700 rounded-full h-4 my-8"><div className="bg-[#D7FC00] h-4 rounded-full transition-all duration-500" style={{ width: `${Math.max(0, 100 - ((queuePosition -1) * 25))}%` }}></div></div><p className="text-gray-400">You will receive a WhatsApp notification when it's your turn.</p><button onClick={() => setShowStyleIdeas(true)} className="mt-6 w-full py-3 px-4 bg-transparent border-2 border-[#7B2CF6] text-[#7B2CF6] rounded-xl font-bold uppercase tracking-wider hover:bg-[#7B2CF6] hover:text-white transition-all duration-300 flex items-center justify-center gap-2"><SparklesIcon className="w-5 h-5" />Get Style Ideas</button><button onClick={() => navigate('/services')} className="mt-8 text-sm text-gray-500 hover:text-white">Back to services</button></div></div>); };
const DashboardLayout = ({ navigate, route }) => { const { userData, auth } = useContext(AppContext); const handleLogout = async () => { await signOut(auth); navigate('/login'); }; const navItems = [ { path: '/dashboard/queue', label: 'Queue', icon: QueueIcon }, { path: '/dashboard/services', label: 'Services', icon: ScissorsIcon }, { path: '/dashboard/customers', label: 'Customers', icon: UserIcon }, ]; if (userData?.role === 'owner') { navItems.push({ path: '/dashboard/settings', label: 'Settings', icon: SettingsIcon }); } const renderPage = () => { if (route.startsWith('/dashboard/queue')) return <QueueManagementPage />; if (route.startsWith('/dashboard/services')) return <ServiceManagementPage />; if (route.startsWith('/dashboard/customers')) return <CustomerListPage />; if (route.startsWith('/dashboard/settings') && userData?.role === 'owner') return <SettingsPage />; return <QueueManagementPage />; }; return (<div className="flex h-screen bg-[#111111]"><aside className="w-20 lg:w-64 bg-[#1A1A1A] p-2 lg:p-4 flex flex-col border-r border-gray-800"><div className="text-center mb-10 hidden lg:block"><h1 className="text-4xl font-headline text-glow-lime">Salon Q</h1><p className="text-xs text-gray-500">DASHBOARD</p></div><nav className="flex-grow space-y-2">{navItems.map(item => (<button key={item.path} onClick={() => navigate(item.path)} className={`w-full flex items-center gap-4 p-3 rounded-lg transition-colors duration-200 ${ route.startsWith(item.path) ? 'bg-[#7B2CF6] text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white' }`}><item.icon className="w-6 h-6 flex-shrink-0" /><span className="hidden lg:inline font-bold">{item.label}</span></button>))}</nav><div className="mt-auto"><button onClick={handleLogout} className="w-full flex items-center gap-4 p-3 rounded-lg text-gray-400 hover:bg-red-500/20 hover:text-red-400 transition-colors duration-200"><LogoutIcon className="w-6 h-6 flex-shrink-0" /><span className="hidden lg:inline font-bold">Logout</span></button></div></aside><main className="flex-1 p-4 sm:p-8 overflow-y-auto">{renderPage()}</main></div>); };
const QueueManagementPage = () => {
    const [queue, setQueue] = useState([]);
    const [confirmingDelete, setConfirmingDelete] = useState(null);
    const { db } = useContext(AppContext);
    useEffect(() => {
        if (!db) return;
        const q = query(collection(db, "queue"), where("status", "in", ["waiting", "in-service"]), orderBy("createdAt"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setQueue(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsubscribe();
    }, [db]);
    const handleAction = async (id, newStatus) => {
        const docRef = doc(db, "queue", id);
        await updateDoc(docRef, { status: newStatus });
    };
    const handleRemoveRequest = (id) => {
        setConfirmingDelete(id);
    };
    const executeRemove = async () => {
        if (confirmingDelete) {
            await deleteDoc(doc(db, "queue", confirmingDelete));
            setConfirmingDelete(null);
        }
    };
    const getStatusChip = (status) => {
        switch (status) {
            case 'waiting':
                return <span className="px-3 py-1 text-xs font-bold text-yellow-300 bg-yellow-900/50 rounded-full">Waiting</span>;
            case 'in-service':
                return <span className="px-3 py-1 text-xs font-bold text-lime-300 bg-lime-900/50 rounded-full">In Service</span>;
            default:
                return <span className="px-3 py-1 text-xs font-bold text-gray-300 bg-gray-700 rounded-full">Unknown</span>;
        }
    };
    return (<div className="animate-fade-in">
        {confirmingDelete && (<ConfirmModal title="Confirm Removal" message="Are you sure you want to remove this customer from the queue?" onConfirm={executeRemove} onCancel={() => setConfirmingDelete(null)} confirmText="Remove" />)}
        <h2 className="text-4xl font-headline mb-6 uppercase">Queue Management</h2>
        <div className="bg-[#1A1A1A] border border-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left">
                <thead className="bg-gray-800/50">
                    <tr>
                        <th className="p-4 uppercase text-sm text-gray-400">#</th>
                        <th className="p-4 uppercase text-sm text-gray-400">Name</th>
                        <th className="p-4 uppercase text-sm text-gray-400 hidden md:table-cell">Mobile</th>
                        <th className="p-4 uppercase text-sm text-gray-400">Service</th>
                        <th className="p-4 uppercase text-sm text-gray-400">Status</th>
                        <th className="p-4 uppercase text-sm text-gray-400 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {queue.map((item, index) => (<tr key={item.id} className="border-t border-gray-800">
                        <td className="p-4 font-bold text-xl text-[#D7FC00]">{index + 1}</td>
                        <td className="p-4 font-medium">{item.userName}</td>
                        <td className="p-4 text-gray-400 hidden md:table-cell">{item.userPhone || 'N/A'}</td>
                        <td className="p-4 text-gray-300">{item.serviceName}</td>
                        <td className="p-4">{getStatusChip(item.status)}</td>
                        <td className="p-4">
                            <div className="flex justify-end gap-2">
                                {item.status === 'waiting' && <button onClick={() => handleAction(item.id, 'in-service')} className="px-3 py-1 bg-lime-500 text-black text-xs font-bold rounded-md hover:bg-lime-400">Start</button>}
                                {item.status === 'in-service' && <button onClick={() => handleAction(item.id, 'completed')} className="px-3 py-1 bg-blue-500 text-white text-xs font-bold rounded-md hover:bg-blue-400">Complete</button>}
                                <button onClick={() => handleRemoveRequest(item.id)} className="px-3 py-1 bg-red-500/80 text-white text-xs font-bold rounded-md hover:bg-red-500">Remove</button>
                            </div>
                        </td>
                    </tr>))}
                    {queue.length === 0 && (<tr>
                        <td colSpan="6" className="text-center p-8 text-gray-500">The queue is empty.</td>
                    </tr>)}
                </tbody>
            </table>
        </div>
    </div>);
};
const ServiceManagementPage = () => { const [services, setServices] = useState([]); const [showModal, setShowModal] = useState(false); const [editingService, setEditingService] = useState(null); const [confirmingDelete, setConfirmingDelete] = useState(null); const { db } = useContext(AppContext); useEffect(() => { if (!db) return; const q = query(collection(db, "services")); const unsubscribe = onSnapshot(q, (querySnapshot) => { setServices(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))); }); return () => unsubscribe(); }, [db]); const handleOpenModal = (service = null) => { setEditingService(service); setShowModal(true); }; const handleDeleteRequest = (id) => { setConfirmingDelete(id); }; const executeDelete = async () => { if (confirmingDelete) { await deleteDoc(doc(db, "services", confirmingDelete)); setConfirmingDelete(null); } }; return (<div className="animate-fade-in relative">{confirmingDelete && (<ConfirmModal title="Delete Service" message="Are you sure you want to permanently delete this service?" onConfirm={executeDelete} onCancel={() => setConfirmingDelete(
