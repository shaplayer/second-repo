import { ApiKeyForm } from "@/components/admin/ApiKeyForm";
import { requireAdmin } from "../shared";

export default async function AdminApiKeysPage() {
  await requireAdmin("/admin/api-keys");
  return (
    <section className="card flex flex-col gap-3 p-5 md:p-6">
      <h2 className="m-0 text-xl font-extrabold">Create an API key</h2>
      <ApiKeyForm />
    </section>
  );
}
