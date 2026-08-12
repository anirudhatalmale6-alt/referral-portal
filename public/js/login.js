"use strict";
const form = document.getElementById("loginForm");
const err = document.getElementById("err");
const btn = document.getElementById("submitBtn");

function showErr(msg) {
  err.textContent = msg;
  err.classList.remove("hide");
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  err.classList.add("hide");
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showErr(data.error || "Could not sign in");
      btn.disabled = false;
      btn.textContent = "Sign in";
      return;
    }
    const params = new URLSearchParams(location.search);
    const next = params.get("next");
    // Only ever follow a path on this site, never an address someone pasted in.
    location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  } catch (_) {
    showErr("Could not reach the server. Check your connection and try again.");
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});
