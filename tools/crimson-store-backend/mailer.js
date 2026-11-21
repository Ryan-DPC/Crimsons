import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.infomaniak.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || 'noreply@hoopslive.ch',
    pass: process.env.SMTP_PASS || 'R6Q%s*krq242JY&0',
  },
});

export async function sendVerificationEmail(email, code) {
  return transporter.sendMail({
    from: 'Crimsons <noreply@hoopslive.ch>',
    to: email,
    subject: `Votre code de vérification Crimsons : ${code}`,
    text: `Bienvenue sur Crimsons.\n\nVotre code d'activation est : ${code}\n\nCe code est valable 15 minutes.`,
    html: `
      <div style="background-color: #08080a; color: #ffffff; padding: 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; border-radius: 20px; max-width: 500px; margin: 0 auto; border: 1px solid rgba(255, 255, 255, 0.08);">
        <h1 style="color: #ef4444; letter-spacing: 5px; text-transform: uppercase; font-size: 26px; margin: 0 0 10px 0; font-weight: 900;">CRIMSONS</h1>
        <p style="color: #9ca3af; font-size: 14px; margin-bottom: 28px;">Vérification de votre compte</p>
        <div style="background-color: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 20px 30px; display: inline-block; margin-bottom: 28px;">
          <span style="font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #ffffff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${code}</span>
        </div>
        <p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 0;">Ce code expire dans 15 minutes.<br>Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(email, code) {
  return transporter.sendMail({
    from: 'Crimsons <noreply@hoopslive.ch>',
    to: email,
    subject: `Réinitialisation de votre mot de passe Crimsons : ${code}`,
    text: `Bonjour,\n\nVotre code de réinitialisation est : ${code}\n\nCe code est valable 15 minutes.`,
    html: `
      <div style="background-color: #08080a; color: #ffffff; padding: 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; border-radius: 20px; max-width: 500px; margin: 0 auto; border: 1px solid rgba(255, 255, 255, 0.08);">
        <h1 style="color: #ef4444; letter-spacing: 5px; text-transform: uppercase; font-size: 26px; margin: 0 0 10px 0; font-weight: 900;">CRIMSONS</h1>
        <p style="color: #9ca3af; font-size: 14px; margin-bottom: 28px;">Réinitialisation de mot de passe</p>
        <div style="background-color: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 20px 30px; display: inline-block; margin-bottom: 28px;">
          <span style="font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #ffffff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${code}</span>
        </div>
        <p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 0;">Ce code expire dans 15 minutes.<br>Entrez ce code dans l'application pour définir votre nouveau mot de passe.</p>
      </div>
    `,
  });
}
