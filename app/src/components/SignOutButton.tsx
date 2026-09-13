"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton() {
  return (
    <button className="btn btn-sm" onClick={() => signOut({ callbackUrl: "/signin" })}>
      Kijelentkezés
    </button>
  );
}
