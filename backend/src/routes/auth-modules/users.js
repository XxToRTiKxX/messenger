function createAuthUsers({ query, uuidv4 }) {
  async function getUserById(userId) {
    const result = await query(
      `SELECT id, username, email, avatar,
              is_approved AS "isApproved",
              password_hash AS "passwordHash",
              registration_note AS "registrationNote",
              registration_status AS "registrationStatus",
              approved_at AS "approvedAt"
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  async function getUserByProvider(provider, providerUserId) {
    const result = await query(
      `SELECT u.id, u.username, u.email, u.avatar,
              u.is_approved AS "isApproved",
              u.password_hash AS "passwordHash",
              u.registration_note AS "registrationNote",
              u.registration_status AS "registrationStatus",
              u.approved_at AS "approvedAt"
       FROM auth_identities ai
       JOIN users u ON u.id = ai.user_id
       WHERE ai.provider = $1 AND ai.provider_user_id = $2
       LIMIT 1`,
      [provider, providerUserId]
    );
    return result.rows[0] || null;
  }

  async function getUserByEmail(email) {
    if (!email) return null;
    const result = await query(
      `SELECT id, username, email, avatar,
              is_approved AS "isApproved",
              password_hash AS "passwordHash",
              registration_note AS "registrationNote",
              registration_status AS "registrationStatus",
              approved_at AS "approvedAt"
       FROM users
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [email]
    );
    return result.rows[0] || null;
  }

  async function getUserByUsername(username) {
    if (!username) return null;
    const result = await query(
      `SELECT id, username, email,
              is_approved AS "isApproved",
              password_hash AS "passwordHash",
              registration_status AS "registrationStatus"
       FROM users
       WHERE lower(username) = lower($1)
       LIMIT 1`,
      [username]
    );
    return result.rows[0] || null;
  }

  async function linkIdentity(userId, provider, providerUserId) {
    await query(
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, provider_user_id)
       DO UPDATE SET user_id = EXCLUDED.user_id`,
      [uuidv4(), userId, provider, providerUserId]
    );
  }

  async function createUser({ username, email, avatar }) {
    const userId = uuidv4();
    await query(
      `INSERT INTO users (
         id, username, email, avatar,
         is_approved, registration_status,
         created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, FALSE, 'onboarding', NOW(), NOW())`,
      [userId, username, email || null, avatar || null]
    );
    return getUserById(userId);
  }

  async function updateUserProfile(userId, { username, email, avatar }) {
    await query(
      `UPDATE users
       SET username = COALESCE($2, username),
           email = COALESCE($3, email),
           avatar = COALESCE($4, avatar),
           updated_at = NOW()
       WHERE id = $1`,
      [userId, username || null, email || null, avatar || null]
    );
    return getUserById(userId);
  }

  async function upsertUserFromProvider({
    currentUserId,
    provider,
    providerUserId,
    username,
    email,
    avatar
  }) {
    if (currentUserId) {
      const currentUser = await getUserById(currentUserId);
      if (currentUser) {
        await linkIdentity(currentUser.id, provider, providerUserId);
        return updateUserProfile(currentUser.id, {
          username: currentUser.username || username,
          email: currentUser.email || email,
          avatar: currentUser.avatar || avatar
        });
      }
    }

    const existingByProvider = await getUserByProvider(provider, providerUserId);
    if (existingByProvider) {
      return existingByProvider;
    }

    const existingByEmail = await getUserByEmail(email);
    if (existingByEmail) {
      await linkIdentity(existingByEmail.id, provider, providerUserId);
      return updateUserProfile(existingByEmail.id, {
        username: existingByEmail.username || username,
        email: existingByEmail.email || email,
        avatar: existingByEmail.avatar || avatar
      });
    }

    const createdUser = await createUser({ username, email, avatar });
    await linkIdentity(createdUser.id, provider, providerUserId);
    return createdUser;
  }

  return {
    getUserById,
    getUserByUsername,
    upsertUserFromProvider
  };
}

module.exports = createAuthUsers;
