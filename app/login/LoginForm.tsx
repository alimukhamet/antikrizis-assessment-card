"use client";

import { FormEvent, useState } from "react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worker: form.get("worker"), password: form.get("password") }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось войти.");
      const requested = new URLSearchParams(window.location.search).get("returnTo") || "/";
      let target = "/";
      try {
        const parsed = new URL(requested, window.location.origin);
        if (parsed.origin === window.location.origin && ["/", "/assessment-review", "/my-results", "/my-earnings"].includes(parsed.pathname)) target = parsed.pathname + parsed.search;
      } catch { /* Invalid return URL falls back to the task chooser. */ }
      window.location.assign(target);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Не удалось войти.");
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        Ваше имя
        <select name="worker" required defaultValue="">
          <option value="" disabled>Выберите имя</option>
          <option value="ali">Ali</option>
          <option value="ramazan">Ramazan</option>
          <option value="nurdaulet">Nurdaulet</option>
          <option value="darkhan">Darkhan</option>
        </select>
      </label>
      <label>
        Пароль
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error ? <p className="login-error" role="alert">{error}</p> : null}
      <button type="submit" disabled={busy}>{busy ? "Входим…" : "Войти"}</button>
    </form>
  );
}
