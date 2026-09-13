import { NextResponse } from "next/server";
import { z } from "zod";
import { createOtpCode, isEmailOtpAllowed, RateLimitedError } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/mailer";

const schema = z.object({ email: z.string().email() });

// Szándékosan EGYSÉGES választ ad függetlenül attól, hogy az email cím
// szerepel-e az OtpAllowedEmail fehérlistán — ld. docs/tervezes.md 5.
// fejezet, email-enumerálás elleni védelem.
const GENERIC_MESSAGE = "Ha ez a cím jogosult a bejelentkezésre, hamarosan érkezik egy kód e-mailben.";

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Érvénytelen email cím." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  try {
    const allowed = await isEmailOtpAllowed(email);
    if (allowed) {
      const code = await createOtpCode(email);
      await sendOtpEmail(email, code);
    }
  } catch (err) {
    // Szándékosan NEM adunk vissza eltérő választ (pl. HTTP 429) rate limit
    // esetén sem — az különböztetné meg az engedélyezett és nem
    // engedélyezett email címeket (enumerálási csatorna). A hiba a
    // szerver logba kerül, a hívó mindig ugyanazt a generikus üzenetet kapja.
    if (!(err instanceof RateLimitedError)) {
      console.error("OTP kérés hiba:", err);
    }
  }

  return NextResponse.json({ message: GENERIC_MESSAGE });
}
