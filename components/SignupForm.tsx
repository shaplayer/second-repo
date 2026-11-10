"use client";
import { AlertForm } from "./AlertForm";

/** Main free-alerts sign-up (email + optional "Also text me"). */
export function SignupForm({ source, size = "lg" }: { source: string; size?: "lg" | "md" }) {
  return size === "md"
    ? <AlertForm source={source} layout="stacked" cta="Join free" />
    : <AlertForm source={source} layout="inline" />;
}
