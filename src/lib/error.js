export function getErrorMessage(code) {
  const normalizedCode = String(code ?? '').trim()

  switch (normalizedCode) {
    case '403':
    case '404':
    case '500':
    case '502':
    case '503':
    case '504':
      return {
        titleKey: 'templateTitle',
        messageKey: normalizedCode,
      }
    default:
      return {
        titleKey: 'templateTitle',
        messageKey: 'template',
      }
  }
}