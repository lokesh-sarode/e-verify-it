import {
  BarChart3,
  CheckCircle2,
  FileUp,
  History,
  LogOut,
  MailCheck,
  ShieldCheck
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { to: "/single-verification", label: "Single", icon: MailCheck },
  { to: "/bulk-upload", label: "Upload", icon: FileUp },
  { to: "/bulk-jobs", label: "Jobs", icon: History }
];

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/single-verification": "Single Verification",
  "/bulk-upload": "Bulk Upload",
  "/bulk-jobs": "Bulk Jobs"
};

export function Layout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const title = pageTitles[location.pathname] ?? "Bulk Job";

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-zinc-200 bg-white lg:block">
        <div className="flex h-16 items-center gap-3 border-b border-zinc-200 px-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="text-base font-semibold text-zinc-950">E-Verify It</div>
            <div className="text-xs text-zinc-500">Admin console</div>
          </div>
        </div>
        <nav className="space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition",
                    isActive
                      ? "bg-teal-50 text-teal-800"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                  ].join(" ")
                }
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/95 px-4 backdrop-blur lg:px-8">
          <div>
            <h1 className="text-lg font-semibold text-zinc-950">{title}</h1>
            <p className="text-xs text-zinc-500">{admin?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 sm:flex">
              <CheckCircle2 size={16} className="text-teal-600" />
              Protected
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Log out"
              className="focus-ring flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <nav className="grid grid-cols-4 border-b border-zinc-200 bg-white lg:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                    isActive ? "text-teal-700" : "text-zinc-500"
                  ].join(" ")
                }
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

