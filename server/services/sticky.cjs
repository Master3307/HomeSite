// services/stickyManager.cjs
const stickyMessages = new Map(); // channelId -> { content, messageId }

function setSticky(channelId, content, messageId) {
  stickyMessages.set(channelId, { content, messageId });
}

function getSticky(channelId) {
  return stickyMessages.get(channelId);
}

function removeSticky(channelId) {
  stickyMessages.delete(channelId);
}

module.exports = { setSticky, getSticky, removeSticky };
