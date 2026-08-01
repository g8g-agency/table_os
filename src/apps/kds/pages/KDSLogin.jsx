/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRuntimeIdentityStore } from '../../../store/runtimeIdentityStore';
import { useRuntimeAuthStore } from '../../../store/runtimeAuthStore';
import { resolveApiBaseUrl } from '../../../lib/resolveApiBaseUrl';

import {
  UtensilsCrossed,
  Zap,
  Server,
  Monitor,
  Mail,
  Lock,
  Eye,
  EyeOff,
  UserCheck,
  ArrowRight,
  MessageCircle,
  Clock,
  CheckCircle2,
  RefreshCcw,
  Delete
} from "lucide-react";

/**
 * KDSLogin — Admin Device Registration screen
 * tableos / Orderlyy KDS · React 19 + Tailwind CSS v4
 */

const BRAND = {
  50: "#FDF1F2",
  100: "#FBE1E3",
  400: "#F0141C",
  500: "#E30613",
  600: "#DC0611",
  700: "#B8030D",
  800: "#8F020A",
  ink: "#0B1220",
};

const NEW_ORDERS = [
  { id: "#A128", items: ["2x Margherita Pizza", "1x Caesar Salad"], time: "12 min" },
  { id: "#A129", items: ["1x Chicken Burger", "1x French Fries"], time: "8 min" },
  { id: "#A130", items: ["1x Pasta Alfredo", "1x Garlic Bread"], time: "10 min" },
];

const PREPARING = [
  { id: "#A127", items: ["1x Grilled Salmon", "1x Veggies"], time: "8 min" },
  { id: "#A126", items: ["2x Chicken Tacos", "1x Nachos"], time: "7 min" },
];

const READY = [
  { id: "#A125", items: ["1x Beef Burger", "1x Onion Rings"] },
  { id: "#A124", items: ["1x Margherita Pizza", "1x Coke"] },
];

function BarsIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="13" width="4" height="8" rx="1" fill="currentColor" />
      <rect x="10" y="8" width="4" height="13" rx="1" fill="currentColor" />
      <rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor" />
    </svg>
  );
}

function SceneBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Abstract bright backdrop mimicking the blurred kitchen/marble counter */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #F5F5F5 45%, #E5E5E5 100%)" }}
      />
      <div
        className="absolute bottom-0 left-0 w-full h-[140px]"
        style={{ background: "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(220,220,225,0.6) 100%)" }}
      />
      <div
        className="absolute top-1/4 right-10 w-64 h-64 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(230,230,230,0.8) 0%, rgba(255,255,255,0) 70%)", filter: "blur(20px)" }}
      />
      <div
        className="absolute bottom-10 -left-10 w-52 h-64 rounded-[40%]"
        style={{ background: "rgba(0,0,0,0.03)", filter: "blur(20px)" }}
      />
    </div>
  );
}

function TicketCard({ t, status }) {
  const isPreparing = status === "preparing";
  const isReady = status === "ready";
  return (
    <div
      className={`bg-white shadow-sm border border-slate-200/80 ${
        isPreparing ? "border-l-[3px] border-l-red-500" : ""
      }`}
      style={{ borderRadius: '6px', padding: '8px' }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: '4px' }}>
        <span className="text-[10px] font-bold text-slate-800">{t.id}</span>
        <span className="text-slate-300 text-[11px] leading-none">›</span>
      </div>
      {t.items.map((it) => (
        <p key={it} className="text-[9px] text-slate-500 leading-tight truncate">
          {it}
        </p>
      ))}
      {isReady ? (
        <span 
          className="inline-flex items-center bg-emerald-50 text-emerald-600 rounded-full"
          style={{ marginTop: '8px', gap: '2px', padding: '2px 6px' }}
        >
          <CheckCircle2 style={{ width: '10px', height: '10px' }} />
          <span className="text-[8px] font-semibold">Ready</span>
        </span>
      ) : (
        <div
          className={`flex items-center ${
            isPreparing ? "text-red-500" : "text-amber-500"
          }`}
          style={{ marginTop: '8px', gap: '4px' }}
        >
          <Clock style={{ width: '10px', height: '10px' }} />
          <span className="text-[8px] font-semibold">{t.time}</span>
        </div>
      )}
    </div>
  );
}

function TicketColumn({ title, count, status, tickets }) {
  return (
    <div className="flex-1 min-w-0" style={{ padding: '0 10px' }}>
      <div className="flex items-center justify-between px-[2px]" style={{ marginBottom: '10px' }}>
        <span
          className={`text-[10px] font-bold ${
            status === "preparing" ? "text-red-500" : "text-slate-800"
          }`}
        >
          {title}
        </span>
        <span className="text-[10px] font-semibold text-slate-400">{count}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {tickets.map((t) => (
          <TicketCard key={t.id} t={t} status={status} />
        ))}
      </div>
    </div>
  );
}

function KDSTabletMockup() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="bg-slate-900 shadow-2xl relative z-10" style={{ padding: '10px', borderRadius: '20px', transform: "perspective(1000px) rotateX(4deg)", transformOrigin: "bottom center" }}>
        <div className="bg-slate-100 overflow-hidden" style={{ borderRadius: '12px' }}>
          <div className="flex divide-x divide-slate-200" style={{ padding: '12px 0' }}>
            <TicketColumn title="New Orders" count={6} status="new" tickets={NEW_ORDERS} />
            <TicketColumn title="Preparing" count={4} status="preparing" tickets={PREPARING} />
            <TicketColumn title="Ready" count={3} status="ready" tickets={READY} />
          </div>
        </div>
      </div>
      {/* Tablet Stand */}
      <div className="mx-auto bg-slate-800 relative z-0" style={{ height: '24px', width: '280px', borderRadius: '0 0 16px 16px', marginTop: '-12px' }} />
      {/* Shadow */}
      <div className="mx-auto bg-black/15 blur-md rounded-full mt-[4px]" style={{ height: '12px', width: '320px' }} />
    </div>
  );
}

function Feature({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start" style={{ gap: '16px' }}>
      <div
        className="shrink-0 flex items-center justify-center rounded-full"
        style={{ backgroundColor: BRAND[50], width: '44px', height: '44px' }}
      >
        <Icon style={{ color: BRAND[500], width: '20px', height: '20px' }} strokeWidth={2.25} />
      </div>
      <div className="pt-[2px]">
        <p className="font-bold text-[15px]" style={{ color: BRAND.ink }}>
          {title}
        </p>
        <p className="text-slate-500 text-[14px] mt-[2px]">{desc}</p>
      </div>
    </div>
  );
}

function PanelBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${BRAND[500]} 0%, ${BRAND[700]} 100%)`,
        }}
      />
      {/* Diagonal light sweeps */}
      <div
        className="absolute -top-1/4 -left-1/4 rotate-[-18deg]"
        style={{
          width: '140%', height: '70%',
          background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 45%, transparent 75%)",
        }}
      />
      <div
        className="absolute top-1/3 -right-1/3 rounded-full blur-3xl"
        style={{ width: '90%', height: '90%', background: "rgba(255,255,255,0.08)" }}
      />
      {/* Dot pattern top right */}
      <div
        className="absolute top-0 right-0"
        style={{
          width: '400px', height: '400px',
          backgroundImage: "radial-gradient(rgba(255,255,255,0.3) 2px, transparent 2px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(circle at top right, black 0%, black 45%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(circle at top right, black 0%, black 45%, transparent 70%)",
        }}
      />
    </div>
  );
}

export function KDSLogin() {
  const navigate = useNavigate();
  const { setBranchId, setStaffId, deviceId } = useRuntimeIdentityStore();
  const { setRuntimeSession } = useRuntimeAuthStore();

  const [mode, setMode] = useState(() => {
    const registered = !!localStorage.getItem('kds_admin_access_token');
    const branchSelected = !!localStorage.getItem('kds_branch_id');
    
    if (registered && branchSelected) return 'employeeId';
    if (registered && !branchSelected) return 'needsReset';
    return 'deviceRegistration';
  });

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Device Registration State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [branches, setBranches] = useState([]);

  // Staff Login State
  const [employeeId, setEmployeeId] = useState('');
  const [pin, setPin] = useState('');
  const [matchedStaff, setMatchedStaff] = useState(null);

  useEffect(() => {
    if (mode === 'needsReset') {
      resetRegistration();
    }
  }, [mode]);

  const handleDeviceRegistration = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const baseUrl = resolveApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          device_fingerprint: useRuntimeIdentityStore.getState().deviceId,
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || data?.error?.message || 'Registration failed');
      }

      const { access_token, refresh_token, device_session_id } = data.data;

      localStorage.setItem('kds_admin_access_token', access_token);
      if (refresh_token) localStorage.setItem('kds_admin_refresh_token', refresh_token);
      localStorage.setItem('kds_device_session_id', device_session_id);

      const deviceFingerprint = useRuntimeIdentityStore.getState().deviceId;
      const contextResponse = await fetch(`${baseUrl}/api/v1/context/bootstrap`, {
        headers: { 
          Authorization: `Bearer ${access_token}`,
          'X-Device-Fingerprint': deviceFingerprint
        }
      });
      
      const contextData = await contextResponse.json();
      if (!contextResponse.ok) {
        throw new Error(contextData?.message || 'Failed to fetch tenant context');
      }

      const fetchedTenantId = contextData.data.tenant.id;
      const fetchedTenantName = contextData.data.tenant?.name;
      const fetchedBranches = contextData.data.branches || [];

      localStorage.setItem('kds_tenant_id', fetchedTenantId);
      if (fetchedTenantName) localStorage.setItem('kds_tenant_name', fetchedTenantName);
      setBranches(fetchedBranches);
      setMode('branchSelection');
    } catch (err) {
      console.error('KDS Device Registration Error:', err);
      setError(err.message || 'An error occurred during registration');
    } finally {
      setLoading(false);
    }
  };

  const handleBranchSelection = (branchId) => {
    const branch = branches.find(b => b.id === branchId);
    localStorage.setItem('kds_branch_id', branchId);
    if (branch) localStorage.setItem('kds_branch_name', branch.name);
    setMode('employeeId');
  };

  const handleEmployeeIdSubmit = async (e) => {
    e.preventDefault();
    if (!employeeId.trim()) {
      setError('Please enter your Employee ID');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      let adminToken = localStorage.getItem('kds_admin_access_token');
      const deviceSessionId = localStorage.getItem('kds_device_session_id');
      const savedTenantId = localStorage.getItem('kds_tenant_id');

      if (!adminToken || !savedTenantId || !deviceSessionId) {
        resetRegistration();
        throw new Error('Device not properly registered. Please register again.');
      }

      const baseUrl = resolveApiBaseUrl();
      const deviceFingerprint = useRuntimeIdentityStore.getState().deviceId;

      let staffRes = await fetch(`${baseUrl}/api/v1/tenants/${savedTenantId}/staff`, {
        headers: { 
          Authorization: `Bearer ${adminToken}`,
          'X-Device-Fingerprint': deviceFingerprint
        }
      });
      
      if (staffRes.status === 401) {
        const refreshToken = localStorage.getItem('kds_admin_refresh_token');
        if (!refreshToken) {
          resetRegistration();
          throw new Error('Session expired. Please re-register this device.');
        }
        const refreshReq = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-Session-Id': deviceSessionId
          },
          body: JSON.stringify({
            refresh_token: refreshToken,
            device_fingerprint: deviceFingerprint
          })
        });
        const refreshData = await refreshReq.json();
        if (!refreshReq.ok) {
          resetRegistration();
          throw new Error(refreshData?.message || refreshData?.error?.message || 'Session expired. Please re-register this device.');
        }
        
        adminToken = refreshData.data.access_token;
        localStorage.setItem('kds_admin_access_token', adminToken);
        if (refreshData.data.refresh_token) {
          localStorage.setItem('kds_admin_refresh_token', refreshData.data.refresh_token);
        }
        
        staffRes = await fetch(`${baseUrl}/api/v1/tenants/${savedTenantId}/staff`, {
          headers: { 
            Authorization: `Bearer ${adminToken}`,
            'X-Device-Fingerprint': deviceFingerprint
          }
        });
      }

      const staffData = await staffRes.json();
      if (!staffRes.ok) throw new Error('Failed to fetch staff list');

      const staffList = staffData.data || [];
      const foundStaff = staffList.find(s => 
        s.employee_id === employeeId || s.id === employeeId
      );

      if (!foundStaff) {
        throw new Error('Invalid Employee ID');
      }

      setMatchedStaff(foundStaff);
      setPin('');
      setMode('pin');
    } catch (err) {
      console.error('KDS Employee ID Validation Error:', err);
      setError(err.message || 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStaffLogin = async () => {
    setError(null);
    setLoading(true);

    try {
      if (!matchedStaff) throw new Error('Employee ID not verified');

      if (matchedStaff.pin !== pin) {
        setPin('');
        throw new Error('Incorrect PIN');
      }

      let adminToken = localStorage.getItem('kds_admin_access_token');
      const deviceSessionId = localStorage.getItem('kds_device_session_id');
      const savedBranchId = localStorage.getItem('kds_branch_id');

      if (!savedBranchId) {
        resetRegistration();
        throw new Error('Branch not selected. Please re-register device.');
      }

      const baseUrl = resolveApiBaseUrl();
      const deviceFingerprint = useRuntimeIdentityStore.getState().deviceId;

      const exchangeRes = await fetch(`${baseUrl}/api/v1/auth/runtime/exchange`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
          'X-Device-Session-Id': deviceSessionId,
          'X-Device-Fingerprint': deviceFingerprint
        },
        body: JSON.stringify({ branch_id: savedBranchId })
      });
      const exchangeData = await exchangeRes.json();

      if (!exchangeRes.ok) {
        throw new Error(exchangeData?.message || exchangeData?.error?.message || 'Failed to initialize session');
      }

      const { runtime_token } = exchangeData.data;

      setRuntimeSession(runtime_token);
      setBranchId(savedBranchId);
      setStaffId(matchedStaff.id);
      
      localStorage.setItem('kds_staff_name', `${matchedStaff.first_name || ''} ${matchedStaff.last_name || ''}`.trim());
      localStorage.setItem('kds_staff_role', matchedStaff.role || 'Kitchen Staff');
      
      navigate('/kds');
    } catch (err) {
      console.error('KDS Staff Login Error:', err);
      setError(err.message || 'An error occurred during staff login');
    } finally {
      setLoading(false);
    }
  };

  const resetRegistration = () => {
    localStorage.removeItem('kds_admin_access_token');
    localStorage.removeItem('kds_admin_refresh_token');
    localStorage.removeItem('kds_device_session_id');
    localStorage.removeItem('kds_tenant_id');
    localStorage.removeItem('kds_tenant_name');
    localStorage.removeItem('kds_branch_id');
    setMode('deviceRegistration');
  };

  const handleNumpadClick = (num) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
    }
  };

  const handleNumpadDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  useEffect(() => {
    if (pin.length === 4) {
      handleStaffLogin();
    }
  }, [pin]);

  const inputBase = "w-full border border-slate-200 bg-white text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition shadow-sm";

  if (mode === 'loading' || mode === 'needsReset') {
    return (
      <div className="min-h-screen w-full bg-white flex items-center justify-center">
        <div className="w-[48px] h-[48px] border-[4px] border-t-transparent rounded-full animate-spin" style={{ borderColor: `${BRAND[500]} transparent transparent transparent` }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-row bg-white font-sans">
      
      {/* LEFT — brand / marketing panel */}
      <div className="w-1/2 flex flex-col bg-white overflow-hidden relative">
        <div className="relative z-10 flex-shrink-0" style={{ padding: '56px 64px 0' }}>
          <div className="flex items-center" style={{ gap: '12px' }}>
            <UtensilsCrossed style={{ width: '32px', height: '32px', color: BRAND[500] }} strokeWidth={2.5} />
            <span className="text-[28px] font-bold tracking-tight" style={{ color: BRAND.ink }}>
              Orderlyy <span style={{ color: BRAND[500] }}>KDS</span>
            </span>
          </div>

          <h1
            className="text-[44px] leading-[1.1] font-extrabold tracking-tight"
            style={{ marginTop: '28px', color: BRAND.ink }}
          >
            Welcome to
            <br />
            <span style={{ color: BRAND[500] }}>Orderlyy KDS</span>
          </h1>
          <div className="rounded-full" style={{ marginTop: '20px', height: '4px', width: '56px', backgroundColor: BRAND[500] }} />

          <p className="text-slate-500 text-[15px] leading-relaxed max-w-md" style={{ marginTop: '24px' }}>
            Your smart kitchen companion. Streamline your kitchen operations, track tickets in real-time, and ensure perfect order execution every time.
          </p>

          <div style={{ marginTop: '40px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
            <Feature icon={Zap} title="Real-time Updates" desc="Instant ticket updates and status changes" />
            <Feature icon={Server} title="Smart Organization" desc="Organize orders efficiently by priority" />
            <Feature icon={BarsIcon} title="Better Performance" desc="Improve kitchen productivity and accuracy" />
          </div>
        </div>

        {/* Mockup area at bottom */}
        <div className="relative flex-1 flex flex-col justify-end" style={{ marginTop: '24px', minHeight: '300px' }}>
          <SceneBackdrop />
          <div className="relative z-10" style={{ padding: '0 64px 40px' }}>
            <KDSTabletMockup />
          </div>
        </div>
      </div>

      {/* RIGHT — auth panel */}
      <div className="relative w-1/2 flex items-center justify-center overflow-y-auto" style={{ padding: '40px' }}>
        <PanelBackground />

        {/* White Card matching reference image perfectly - INLINE PADDING FIXES MISSING GAPS */}
        <div 
          className="relative z-10 w-full max-w-[440px] bg-white shadow-2xl"
          style={{ padding: '48px', borderRadius: '24px' }}
        >
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-[14px] font-bold flex items-center" style={{ marginBottom: '24px', padding: '16px', borderRadius: '10px', gap: '12px' }}>
              {error}
            </div>
          )}

          {mode === 'deviceRegistration' && (
            <>
              <div className="flex flex-col items-center text-center">
                <div className="rounded-full flex items-center justify-center bg-red-50/70" style={{ width: '88px', height: '88px' }}>
                  <div className="bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100" style={{ width: '64px', height: '64px' }}>
                    <Monitor style={{ width: '28px', height: '28px', color: BRAND[700] }} strokeWidth={2} />
                  </div>
                </div>
                <h2 className="font-bold" style={{ marginTop: '24px', fontSize: '22px', color: BRAND.ink }}>
                  Admin Device Registration
                </h2>
                <p className="text-slate-500" style={{ marginTop: '8px', fontSize: '14px' }}>
                  Authorize this terminal for kitchen use.
                </p>
              </div>

              <form onSubmit={handleDeviceRegistration} style={{ marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <label className="block text-[13px] font-bold" style={{ marginBottom: '8px', color: BRAND.ink }}>
                    Admin Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute top-1/2 -translate-y-1/2 text-slate-400" style={{ left: '16px', width: '18px', height: '18px' }} />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="chef@restaurant.com"
                      className={inputBase}
                      style={{ height: '48px', borderRadius: '10px', paddingLeft: '44px', paddingRight: '16px' }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-bold" style={{ marginBottom: '8px', color: BRAND.ink }}>
                    Admin Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute top-1/2 -translate-y-1/2 text-slate-400" style={{ left: '16px', width: '18px', height: '18px' }} />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={inputBase}
                      style={{ height: '48px', borderRadius: '10px', paddingLeft: '44px', paddingRight: '44px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      style={{ right: '16px' }}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff style={{ width: '18px', height: '18px' }} /> : <Eye style={{ width: '18px', height: '18px' }} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-bold" style={{ marginBottom: '8px', color: BRAND.ink }}>
                    Terminal ID
                  </label>
                  <div className="relative">
                    <Monitor className="absolute top-1/2 -translate-y-1/2 text-slate-400" style={{ left: '16px', width: '18px', height: '18px' }} />
                    <input
                      type="text"
                      readOnly
                      value={`STA-${(deviceId || '01').substring(0, 2).toUpperCase()}`}
                      className={inputBase}
                      style={{ height: '48px', borderRadius: '10px', paddingLeft: '44px', paddingRight: '16px', backgroundColor: '#f8fafc', cursor: 'not-allowed' }}
                    />
                  </div>
                  <p className="font-medium text-slate-400 text-right" style={{ marginTop: '6px', fontSize: '11px' }}>
                    Identifier for routing tickets.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center font-semibold text-white shadow-md active:scale-[0.99] transition disabled:opacity-70"
                  style={{
                    marginTop: '12px',
                    height: '48px',
                    borderRadius: '10px',
                    fontSize: '15px',
                    gap: '8px',
                    background: `linear-gradient(90deg, ${BRAND[500]}, ${BRAND[700]})`,
                  }}
                >
                  <UserCheck style={{ width: '18px', height: '18px' }} />
                  {loading ? "Registering…" : "Register Device"}
                  {!loading && <ArrowRight style={{ width: '18px', height: '18px' }} />}
                </button>
              </form>
            </>
          )}

          {mode === 'branchSelection' && (
            <>
              <div className="flex flex-col items-center text-center">
                <div className="rounded-full flex items-center justify-center bg-red-50/70" style={{ width: '88px', height: '88px' }}>
                  <div className="bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100" style={{ width: '64px', height: '64px' }}>
                    <Server style={{ width: '28px', height: '28px', color: BRAND[700] }} strokeWidth={2} />
                  </div>
                </div>
                <h2 className="font-bold" style={{ marginTop: '24px', fontSize: '22px', color: BRAND.ink }}>
                  Select Branch
                </h2>
                <p className="text-slate-500" style={{ marginTop: '8px', fontSize: '14px' }}>
                  Assign this device to a kitchen branch.
                </p>
              </div>
              <div className="overflow-y-auto custom-scrollbar" style={{ marginTop: '36px', maxHeight: '380px', paddingRight: '8px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {branches.map(b => (
                  <button 
                    key={b.id} 
                    onClick={() => handleBranchSelection(b.id)} 
                    className="w-full flex items-center justify-between border border-slate-200 bg-white font-bold transition hover:border-slate-300 hover:bg-slate-50 shadow-sm"
                    style={{ height: '56px', borderRadius: '10px', padding: '0 20px', fontSize: '15px', color: BRAND.ink }}
                  >
                    <span>{b.name}</span>
                    <ArrowRight style={{ width: '18px', height: '18px' }} className="text-slate-400" />
                  </button>
                ))}
              </div>
            </>
          )}

          {mode === 'employeeId' && (
            <>
              <div className="flex flex-col items-center text-center">
                <div className="rounded-full flex items-center justify-center bg-red-50/70" style={{ width: '88px', height: '88px' }}>
                  <div className="bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100" style={{ width: '64px', height: '64px' }}>
                    <UserCheck style={{ width: '28px', height: '28px', color: BRAND[700] }} strokeWidth={2} />
                  </div>
                </div>
                <h2 className="font-bold" style={{ marginTop: '24px', fontSize: '22px', color: BRAND.ink }}>
                  Staff Login
                </h2>
                <p className="text-slate-500" style={{ marginTop: '8px', fontSize: '14px' }}>
                  Enter your unique staff ID to start shift.
                </p>
              </div>
              <form onSubmit={handleEmployeeIdSubmit} style={{ marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div>
                  <label className="block text-[13px] font-bold text-center" style={{ marginBottom: '8px', color: BRAND.ink }}>
                    Employee ID
                  </label>
                  <input 
                    type="text" 
                    required 
                    value={employeeId} 
                    onChange={(e) => setEmployeeId(e.target.value)} 
                    className="w-full border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition text-center font-bold tracking-widest shadow-sm"
                    style={{ height: '52px', borderRadius: '10px', padding: '0 20px', fontSize: '20px', color: BRAND.ink }}
                    placeholder="Enter Staff ID" 
                    autoFocus 
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full flex items-center justify-center font-semibold text-white shadow-md active:scale-[0.99] transition disabled:opacity-70"
                  style={{
                    height: '52px', borderRadius: '10px', gap: '8px', fontSize: '15px',
                    background: `linear-gradient(90deg, ${BRAND[500]}, ${BRAND[700]})`,
                  }}
                >
                  {loading ? 'Verifying...' : 'Continue'}
                </button>
                <div className="text-center" style={{ marginTop: '24px' }}>
                  <button
                    type="button"
                    onClick={() => { setError(null); resetRegistration(); }}
                    className="inline-flex items-center font-semibold text-slate-500 hover:text-slate-700"
                    style={{ gap: '6px', fontSize: '14px' }}
                  >
                    <RefreshCcw style={{ width: '14px', height: '14px' }} />
                    Re-register device
                  </button>
                </div>
              </form>
            </>
          )}

          {mode === 'pin' && (
            <>
              <div className="flex flex-col items-center text-center relative">
                <button 
                  onClick={() => { setError(null); setMatchedStaff(null); setMode('employeeId'); }} 
                  className="absolute left-0 top-0 text-slate-400 hover:text-slate-600"
                  style={{ padding: '8px' }}
                >
                  <ArrowRight style={{ width: '20px', height: '20px' }} className="rotate-180" />
                </button>
                <h2 className="font-bold" style={{ marginTop: '8px', fontSize: '22px', color: BRAND.ink }}>
                  Enter PIN
                </h2>
                <p className="text-slate-500" style={{ marginTop: '8px', fontSize: '14px' }}>
                  Enter your 4-digit security PIN.
                </p>
              </div>
              <div style={{ marginTop: '32px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
                <div className="flex justify-center" style={{ gap: '20px', padding: '8px 0' }}>
                  {[...Array(4)].map((_, i) => (
                    <div 
                      key={i} 
                      className={`transition-all duration-200 ${i < pin.length ? 'scale-110 shadow-md' : 'bg-slate-200'}`}
                      style={{ width: '14px', height: '14px', borderRadius: '50%', ...(i < pin.length ? { backgroundColor: BRAND[500] } : {}) }}
                    />
                  ))}
                </div>
                
                {loading && (
                  <p className="text-center font-bold animate-pulse" style={{ fontSize: '13px', color: BRAND[500] }}>
                    Authenticating PIN...
                  </p>
                )}

                <div className="grid grid-cols-3" style={{ gap: '12px' }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                    <button 
                      key={num} 
                      onClick={() => handleNumpadClick(num.toString())} 
                      className="bg-white hover:bg-slate-50 active:scale-95 font-bold transition-all border border-slate-200 shadow-sm"
                      style={{ height: '64px', borderRadius: '12px', fontSize: '22px', color: BRAND.ink }}
                    >
                      {num}
                    </button>
                  ))}
                  <div />
                  <button 
                    onClick={() => handleNumpadClick('0')} 
                    className="bg-white hover:bg-slate-50 active:scale-95 font-bold transition-all border border-slate-200 shadow-sm"
                    style={{ height: '64px', borderRadius: '12px', fontSize: '22px', color: BRAND.ink }}
                  >
                    0
                  </button>
                  <button 
                    onClick={handleNumpadDelete} 
                    className="bg-white hover:bg-slate-50 active:scale-95 flex items-center justify-center transition-all border border-slate-200 shadow-sm"
                    style={{ height: '64px', borderRadius: '12px' }}
                  >
                    <Delete style={{ width: '20px', height: '20px' }} className="text-slate-500" />
                  </button>
                </div>
              </div>
            </>
          )}

          {mode === 'deviceRegistration' && (
            <>
              <div className="flex items-center" style={{ marginTop: '32px', gap: '16px' }}>
                <div className="flex-1 bg-slate-200" style={{ height: '1px' }} />
                <span className="font-medium text-slate-400" style={{ fontSize: '12px' }}>or</span>
                <div className="flex-1 bg-slate-200" style={{ height: '1px' }} />
              </div>

              <div className="text-center" style={{ marginTop: '24px' }}>
                <p className="text-slate-500 font-medium" style={{ fontSize: '13px' }}>Need help registering?</p>
                <button
                  type="button"
                  className="inline-flex items-center font-bold hover:opacity-80 transition-opacity"
                  style={{ marginTop: '4px', gap: '6px', fontSize: '14px', color: BRAND[600] }}
                >
                  <MessageCircle style={{ width: '16px', height: '16px' }} />
                  Contact Support
                  <ArrowRight style={{ width: '14px', height: '14px' }} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
