export function cleanText(input: string, max: number): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max)
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  const words = local.replace(/[._+-]+/g, ' ').trim()
  if (!words) return 'Interviewer'
  return words.replace(/\b\w/g, (letter) => letter.toUpperCase())
}
