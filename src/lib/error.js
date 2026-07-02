const ERROR_MESSAGES = {
  template: {
    title: 'Error',
    message: 'It seems like you encountered an Error.',
  },
  403: {
    title: '403',
    message: "It seems like you aren't allowed to access this page – Forbidden.",
  },
  404: {
    title: '404',
    message: "It seems like you've found a page that doesn't exist – Not Found.",
  },
  500: {
    title: '500',
    message: 'It seems like there was an error on the server – Internal Server Error.',
  },
  502: {
    title: '502',
    message: 'It seems like there was an error on the server – Bad Gateway.',
  },
  503: {
    title: '503',
    message: 'It seems like there was an error on the server – Service Unavailable.',
  },
  504: {
    title: '504',
    message: 'It seems like there was an error on the server – Gateway Timeout.',
  },
}

export function getErrorMessage(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.template
}