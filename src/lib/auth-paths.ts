// Where the links Better Auth mails out land. All but the account page are
// reachable without a session, since nobody is signed in while following them.

// The verification page: shown after signing up, and after a link was rejected
export const VERIFY_EMAIL_PATH = '/admin/verify-email'

// What a verification link redirects to. Better Auth uses the same URL for
// success and failure, appending ?error= in the latter case, so the marker is
// what tells the page the address is now confirmed.
export const VERIFY_EMAIL_CALLBACK = `${VERIFY_EMAIL_PATH}?verified=1`

// Better Auth checks the reset token first and appends it as ?token=
export const RESET_PASSWORD_PATH = '/admin/reset-password'

// Where the link of an invitation to a Kita leads. Rendered with and without
// a session: the link itself signs nobody in.
export const INVITATION_PATH = '/admin/invitation'

// The invitation that page shows, by its id
export const INVITATION_ID_PARAM = 'id'

export function invitationPath(id: string) {
  return `${INVITATION_PATH}?${INVITATION_ID_PARAM}=${encodeURIComponent(id)}`
}

// The sign-up page names the invitation it was opened for the same way
export const INVITATION_PARAM = 'invitation'

// The account page, where both links of an address change lead back to. Same
// convention as above: the marker says a link was opened, ?error= that it was
// rejected.
export const EMAIL_CHANGE_MARKER = 'emailChange'
export const EMAIL_CHANGE_CALLBACK = `/admin/account?${EMAIL_CHANGE_MARKER}=1`

// The subscription page of the hosted instance, which its notices and its
// reminder mails link to. Reachable without a Kita: an account whose Kitas
// were deleted has none and still has to get here.
export const SUBSCRIPTION_PATH = '/admin/abo'
