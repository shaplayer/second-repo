"use client";

import { lazy } from "react";

const ApiKeyForm = lazy(() => import("@/components/admin/ApiKeyForm").then((module) => ({ default: module.ApiKeyForm })));

export default function AdminApiKeysPage() {
  return (
    <section className="card flex flex-col gap-3 p-5 md:p-6">
      <h2 className="m-0 text-xl font-extrabold">Create an API key</h2>
      <ApiKeyForm />
    </section>
  );
}
