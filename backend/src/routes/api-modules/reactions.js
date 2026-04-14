function aggregateRowsByMessageId(rows) {
  const byMessageId = new Map();
  rows.forEach((row) => {
    const current = byMessageId.get(row.messageId) || [];
    current.push({ emoji: row.emoji, userIds: row.userIds });
    byMessageId.set(row.messageId, current);
  });
  return byMessageId;
}

function createReactionHelpers(query) {
  async function loadMessageReactionsByIds(messageIds) {
    if (!messageIds.length) return new Map();

    const result = await query(
      `SELECT mr.message_id AS "messageId",
              mr.emoji,
              ARRAY_AGG(mr.user_id::text ORDER BY mr.user_id) AS "userIds"
       FROM message_reactions mr
       WHERE mr.message_id = ANY($1::uuid[])
       GROUP BY mr.message_id, mr.emoji`,
      [messageIds]
    );

    return aggregateRowsByMessageId(result.rows);
  }

  async function loadDirectMessageReactionsByIds(messageIds) {
    if (!messageIds.length) return new Map();

    const result = await query(
      `SELECT dmr.direct_message_id AS "messageId",
              dmr.emoji,
              ARRAY_AGG(dmr.user_id::text ORDER BY dmr.user_id) AS "userIds"
       FROM direct_message_reactions dmr
       WHERE dmr.direct_message_id = ANY($1::uuid[])
       GROUP BY dmr.direct_message_id, dmr.emoji`,
      [messageIds]
    );

    return aggregateRowsByMessageId(result.rows);
  }

  async function enrichMessagesWithReactions(messages, loader) {
    if (!messages.length) return [];
    const reactionsByMessageId = await loader(messages.map((message) => message.id));
    return messages.map((message) => ({
      ...message,
      reactions: reactionsByMessageId.get(message.id) || []
    }));
  }

  return {
    loadMessageReactionsByIds,
    loadDirectMessageReactionsByIds,
    enrichMessagesWithReactions
  };
}

module.exports = createReactionHelpers;
