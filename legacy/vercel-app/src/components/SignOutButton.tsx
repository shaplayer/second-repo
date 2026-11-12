"use client";

export default function SignOutButton() {
  return (
    <button
      className="btn"
      onClick={async () => {
        await fetch("/api/auth/signout", { method: "POST" });
        window.location.href = "/";
      }}
    >
      Sign out
    </button>
  );
}
