import { cancelTestAlert, scheduleTestAlert, searchTestRecipients, TestAlertInputError } from "@/lib/alerts/test-alerts";
import { postalAddress } from "@/lib/config";
import { db } from "@/lib/db";
import { emailProvider } from "@/lib/email";
import { currentUser, json, readJson, sameOrigin } from "@/lib/web/request";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user?.isAdmin) return json({ ok: false, error: "Only staff can select recipients." }, 403);
  const query = new URL(req.url).searchParams.get("q") ?? "";
  try {
    return json({ ok: true, recipients: await searchTestRecipients(db(), query) });
  } catch (error) {
    console.error("[test alerts] recipient search failed:", error);
    return json({ ok: false, error: "Could not load recipients." }, 500);
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: "Request origin not allowed." }, 403);
  const user = await currentUser();
  if (!user?.isAdmin) return json({ ok: false, error: "Only staff can schedule test alerts." }, 403);
  const body = await readJson(req);
  try {
    if (body.action === "cancel") {
      if (typeof body.id !== "string") throw new TestAlertInputError("Invalid test alert.");
      if (!(await cancelTestAlert(db(), body.id))) return json({ ok: false, error: "There is nothing left to cancel." }, 409);
      return json({ ok: true });
    }
    if (body.action !== "schedule") throw new TestAlertInputError("Choose an action.");
    const provider = emailProvider();
    if (provider.name === "console" || !provider.configured() || !postalAddress()) {
      return json({ ok: false, error: "A real email service and business postal address must be configured first." }, 503);
    }
    const id = await scheduleTestAlert(db(), user.id, {
      subject: body.subject, body: body.body, scheduledAt: body.scheduledAt,
      recipients: body.recipients, confirm: body.confirm,
    });
    return json({ ok: true, id });
  } catch (error) {
    if (error instanceof TestAlertInputError) return json({ ok: false, error: error.message }, 400);
    console.error("[test alerts] request failed:", error);
    return json({ ok: false, error: "Could not save the test alert. Please try again." }, 500);
  }
}
