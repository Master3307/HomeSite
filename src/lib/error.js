const ERROR_MESSAGES = {
  template: {
    titleKey: 'errors.template.title',
    messageKey: 'errors.template.message',
  },
  403: {
    titleKey: 'errors.403.title',
    messageKey: 'errors.403.message',
  },
  404: {
    titleKey: 'errors.404.title',
    messageKey: 'errors.404.message',
  },
  500: {
    titleKey: 'errors.500.title',
    messageKey: 'errors.500.message',
  },
  502: {
    titleKey: 'errors.502.title',
    messageKey: 'errors.502.message',
  },
  503: {
    titleKey: 'errors.503.title',
    messageKey: 'errors.503.message',
  },
  504: {
    titleKey: 'errors.504.title',
    messageKey: 'errors.504.message',
  },
}

export function getErrorMessage(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.template
}