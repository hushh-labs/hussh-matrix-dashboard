import { GoogleMail, GoogleMailOAuth } from './google-mail';
import { FirestoreMailControl, SecretManagerMailCredentials } from './google-mail-store';
import { PlgError } from './engine';

export function configuredGoogleMail() {
  if (process.env.PLG_GOOGLE_MAIL_ENABLED !== 'true') return undefined;
  if (!process.env.PLG_FIRESTORE_PROJECT || !process.env.PLG_FIRESTORE_DATABASE || !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI)
    throw new PlgError(503, 'Google mail is not configured.');
  return new GoogleMail(new FirestoreMailControl(process.env.PLG_FIRESTORE_PROJECT, process.env.PLG_FIRESTORE_DATABASE),
    new SecretManagerMailCredentials(process.env.PLG_GOOGLE_MAIL_CREDENTIAL_SECRET || ''),
    new GoogleMailOAuth({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI }, process.env.PLG_GOOGLE_MAIL_CAMPAIGNS_ENABLED === 'true'));
}
