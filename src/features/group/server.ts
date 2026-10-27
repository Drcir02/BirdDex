// Where the group server is. Both values are public by design: the address of the project and its publishable ("anon") key.
// What a phone may do with them is limited by the row-level security rules in supabase/migrations/001_group.sql.
// The secret keys of the project (service_role) and the access token of the account are never in the app.

export const GROUP_SERVER_URL = 'https://lyiiibtdzshoftbagoce.supabase.co'
export const GROUP_SERVER_KEY = 'sb_publishable_mPEfsCWWYCjUKxRXPT5hYA_P4p1otCj'
