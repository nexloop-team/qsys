// Voucher codes are stored as 8 characters and shown as ABCD-EFGH. Plain helper, safe on the server
// and in the browser (a "use client" file can't hand functions to a server page).
export const showCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
