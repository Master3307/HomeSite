/** "123 456" -> "123456" (2FA codes). */
export const cleanCode = (value) => String(value ?? '').replace(/\s/g, '')
