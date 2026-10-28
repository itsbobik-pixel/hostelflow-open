// Outgoing e-mail through Resend (https://resend.com), from our own domain.
// Env: RESEND_API_KEY (secret), MAIL_FROM (var, e.g. "HostelFlow <noreply@hostelflow.it>").

export const mailEnabled = env => !!env.RESEND_API_KEY;

export async function sendMail(env, { to, subject, text, replyTo }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'HostelFlow <noreply@hostelflow.it>', to: [to], subject, text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) {
    console.error('mail failed', res.status, await res.text().catch(() => ''));
    throw new Error('mail not sent');
  }
}
