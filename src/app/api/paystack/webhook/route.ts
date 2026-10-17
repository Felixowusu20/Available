import { handleWebhook } from "@/lib/premium/confirm";

// Paystack calls this after a payment. It is not behind sign-in (Paystack has no account), so the signature is the
// only thing that makes it trustworthy: handleWebhook rejects anything not signed with our secret key.
export async function POST(req: Request) {
  const raw = await req.text(); // the exact bytes, because the signature is computed over them
  const result = await handleWebhook(raw, req.headers.get("x-paystack-signature"));
  return Response.json(result.body, { status: result.status });
}
