"use client";

export default function SignOutButton() {
  return (
    <button
      className="btn"
      onClick={async () => {
        await fetch("/api/auth/signout", { method: "POST" });
        window.location.href = new URL("/", process.env.NEXT_PUBLIC_SITE_URL).toString();
      }}
    >
      Sign out
    </button>
  );
}
