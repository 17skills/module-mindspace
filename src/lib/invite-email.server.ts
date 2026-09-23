// Versand der Einladungs-E-Mail über die Lovable-Mailinfrastruktur.
import { sendLovableEmail } from "@lovable.dev/email-js";

export type InviteMail = {
  to: string;
  inviterName: string;
  orgName: string;
  scopeTitle: string | null;
  link: string;
};

function html(mail: InviteMail) {
  const target = mail.scopeTitle
    ? `den Scope „${mail.scopeTitle}“ in ${mail.orgName}`
    : `die Organisation „${mail.orgName}“`;
  return `<!doctype html><html lang="de"><body style="margin:0;background:#EDEAE4;font-family:ui-sans-serif,system-ui,sans-serif;color:#1C2321">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;padding:32px">
      <tr><td>
        <p style="margin:0 0 8px;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#598381">scopebuilder</p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">Einladung von ${mail.inviterName}</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Du wurdest eingeladen, ${target} mitzunutzen.</p>
        <p style="margin:0 0 24px"><a href="${mail.link}" style="display:inline-block;background:#1C2321;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-size:15px">Einladung annehmen</a></p>
        <p style="margin:0;font-size:13px;color:#6b6b66">Der Link ist 14 Tage gültig. Falls du damit nichts anfangen kannst, ignoriere diese E-Mail einfach.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function text(mail: InviteMail) {
  const target = mail.scopeTitle
    ? `den Scope "${mail.scopeTitle}" in ${mail.orgName}`
    : `die Organisation "${mail.orgName}"`;
  return `${mail.inviterName} lädt dich ein, ${target} in scopebuilder mitzunutzen.\n\n${mail.link}\n\nDer Link ist 14 Tage gültig.`;
}

/** Versand; gibt false zurück, wenn noch keine Absenderadresse eingerichtet ist. */
export async function sendInviteEmail(mail: InviteMail): Promise<boolean> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  const from = process.env["EMAIL_FROM"];
  if (!apiKey || !from) return false;
  try {
    await sendLovableEmail(
      {
        to: mail.to,
        from,
        subject: mail.scopeTitle
          ? `Einladung zum Scope „${mail.scopeTitle}“`
          : `Einladung zu „${mail.orgName}“ in scopebuilder`,
        html: html(mail),
        text: text(mail),
        purpose: "invite",
      },
      { apiKey },
    );
    return true;
  } catch {
    return false;
  }
}
