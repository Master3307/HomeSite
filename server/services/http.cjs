/*
 * Small helpers the web services share.
 *
 *   httpError(status, message, extra?)  an Error the route wrappers answer with
 *                                       `status` (extra fields, e.g. { locked: true },
 *                                       end up on the error for them to pass on)
 */
const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

module.exports = { httpError };
