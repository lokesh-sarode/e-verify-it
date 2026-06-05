import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { useAuth } from "../context/AuthContext";

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
    <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9] px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-teal-600 text-white">
            <ShieldCheck size={23} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">E-Verify It</h1>
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
          className="focus-ring mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm"
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
          className="focus-ring mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm"
        />

        <button
          type="submit"
          disabled={submitting}
          className="focus-ring mt-6 flex h-11 w-full items-center justify-center rounded-md bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {submitting ? "Signing in" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

