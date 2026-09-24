"use client";

export default function SignOutButton() {
  return (
    <button type="button" className="btn" onClick={async () => {
      await fetch("/api/auth", { method: "DELETE" });
      window.location.href = "/";
    }}>ออกจากระบบ</button>
  );
}
