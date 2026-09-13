import nodemailer from "nodemailer";

/**
 * SMTP kapcsolati adatok az infra-fázisban dőlnek el (ld. docs/tervezes.md
 * 12. Nyitott kérdések — Google Workspace SMTP relay vs. tranzakciós email
 * API). Amíg SMTP_HOST nincs beállítva, a kódot a szerver logba írjuk ki —
 * ez teszi lehetővé a helyi fejlesztést/tesztelést email-küldő nélkül is,
 * de éles környezetben SMTP_HOST kötelezően beállítandó.
 */
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const transport = getTransport();
  const subject = "Bejelentkezési kód — Billingo/IMA admin";
  const text = `A bejelentkezési kódod: ${code}\n\nA kód 10 percig érvényes. Ha nem te kérted, hagyd figyelmen kívül ezt az e-mailt.`;

  if (!transport) {
    console.warn(
      `[mailer] SMTP_HOST nincs beállítva — OTP kód logba írva (${email}): ${code}`
    );
    return;
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "no-reply@localhost",
    to: email,
    subject,
    text,
  });
}
