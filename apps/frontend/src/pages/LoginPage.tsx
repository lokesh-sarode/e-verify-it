import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { useAuth } from "../context/AuthContext";
import nobounceLogo from '../assets/NoBounce-Logo.png';

export function LoginPage() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (admin) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login(email, password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8] px-4">
      <form onSubmit={handleSubmit} className="app-panel w-full max-w-md p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-brand-100 bg-white p-1 shadow-sm">
            <img src={nobounceLogo} alt="NoBounce Logo" className="h-full w-full rounded-md object-contain" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">No<span style={{ color: '#91080b' }}>Bounce</span></h1>
            <p className="text-sm text-zinc-500">Admin login</p>
          </div>
        </div>

        {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}

        <label className="block text-sm font-medium text-zinc-700" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          required
          className="input mt-2 h-11 w-full"
        />

        <label className="mt-4 block text-sm font-medium text-zinc-700" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          required
          className="input mt-2 h-11 w-full"
        />

        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary mt-6 h-11 w-full"
        >
          {submitting ? "Signing in" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
