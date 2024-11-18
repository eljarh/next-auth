/**
 * <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16}}>
 *  <p>Official <a href="https://nats.io">NATS KeyValue</a> adapter for Auth.js / NextAuth.js.</p>
 *  <a href="https://docs.upstash.com/redis">
 *   <img style={{display: "block"}} src="https://authjs.dev/img/adapters/upstash-redis.svg" width="60"/>
 *  </a>
 * </div>
 *
 * ## Installation
 *
 * ```bash npm2yarn
 * npm install @auth/nats-kv-adapter
 * ```
 *
 * @module @auth/nats-kv-adapter
 */
import {
  type Adapter,
  type AdapterUser,
  type AdapterAccount,
  type AdapterSession,
  type VerificationToken,
  isDate,
} from "@auth/core/adapters"
import { KV } from "@nats-io/kv"
/** */
/* Usage:

  const kvm = new Kvm(client);
  const authKV = await kvm.create("authKV");

  export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: NatsKVAdapter(authKV),
  providers: [],
})

*/

/** This is the interface of the Upstash Redis adapter options. */
export interface NextKVAdapterOptions {
  /**
   * The base prefix for your keys
   */
  baseKeyPrefix?: string
  /**
   * The prefix for the `account` key
   */
  accountKeyPrefix?: string
  /**
   * The prefix for the `accountByUserId` key
   */
  accountByUserIdPrefix?: string
  /**
   * The prefix for the `emailKey` key
   */
  emailKeyPrefix?: string
  /**
   * The prefix for the `sessionKey` key
   */
  sessionKeyPrefix?: string
  /**
   * The prefix for the `sessionByUserId` key
   */
  sessionByUserIdKeyPrefix?: string
  /**
   * The prefix for the `user` key
   */
  userKeyPrefix?: string
  /**
   * The prefix for the `verificationToken` key
   */
  verificationTokenKeyPrefix?: string
}

export const defaultOptions = {
  baseKeyPrefix: "",
  accountKeyPrefix: "user.account.",
  accountByUserIdPrefix: "user.account.by-user-id.",
  emailKeyPrefix: "user.email.",
  sessionKeyPrefix: "user.session.",
  sessionByUserIdKeyPrefix: "user.session.by-user-id.",
  userKeyPrefix: "user.",
  verificationTokenKeyPrefix: "user.token.",
}

export function hydrateDates(json: object) {
  return Object.entries(json).reduce((acc, [key, val]) => {
    acc[key] = isDate(val) ? new Date(val as string) : val
    return acc
  }, {} as any)
}

//replace symbols that are not allowed in keys
export function natsKey(identifier: string) {
  return identifier.replace("@", "_at_").replace(":", "_colon_") as string
}

export function nats2json(value: any) {
  return JSON.parse(value.toString())
}

export function NatsKVAdapter(
  client: KV,
  options: NextKVAdapterOptions = {}
): Adapter {
  const mergedOptions = {
    ...defaultOptions,
    ...options,
  }

  const { baseKeyPrefix } = mergedOptions
  const accountKeyPrefix = baseKeyPrefix + mergedOptions.accountKeyPrefix
  const accountByUserIdPrefix =
    baseKeyPrefix + mergedOptions.accountByUserIdPrefix
  const emailKeyPrefix = baseKeyPrefix + mergedOptions.emailKeyPrefix
  const sessionKeyPrefix = baseKeyPrefix + mergedOptions.sessionKeyPrefix
  const sessionByUserIdKeyPrefix =
    baseKeyPrefix + mergedOptions.sessionByUserIdKeyPrefix
  const userKeyPrefix = baseKeyPrefix + mergedOptions.userKeyPrefix
  const verificationTokenKeyPrefix =
    baseKeyPrefix + mergedOptions.verificationTokenKeyPrefix

  const setObjectAsJson = async (key: string, obj: any) =>
    await client.put(key, JSON.stringify(obj))

  const setAccount = async (id: string, account: AdapterAccount) => {
    const accountKey = accountKeyPrefix + natsKey(id)
    await setObjectAsJson(accountKey, account)
    await client.put(
      accountByUserIdPrefix + natsKey(account.userId),
      accountKey
    )
    return account
  }

  const getAccount = async (id: string) => {
    const data = await client.get(accountKeyPrefix + natsKey(id))
    if (!data || data.length == 0) return null
    const account = data.json<AdapterAccount>()
    return hydrateDates(account)
  }

  const setSession = async (
    id: string,
    session: AdapterSession
  ): Promise<AdapterSession> => {
    const sessionKey = sessionKeyPrefix + natsKey(id)
    await setObjectAsJson(sessionKey, session)
    await client.put(
      sessionByUserIdKeyPrefix + natsKey(session.userId),
      sessionKey
    )
    return session
  }

  const getSession = async (id: string) => {
    const data = await client.get(sessionKeyPrefix + natsKey(id))
    if (!data || data.length == 0) return null
    const session = data.json<AdapterSession>()
    return hydrateDates(session)
  }

  const setUser = async (
    id: string,
    user: AdapterUser
  ): Promise<AdapterUser> => {
    await setObjectAsJson(userKeyPrefix + natsKey(id), user)
    await client.put(`${emailKeyPrefix}${natsKey(user.email)}`, id)
    return user
  }

  const getUser = async (id: string) => {
    const data = await client.get(userKeyPrefix + natsKey(id))
    if (!data || data.length == 0) return null
    const user = data.json<AdapterUser>()
    return hydrateDates(user)
  }

  return {
    async createUser(user) {
      const id = crypto.randomUUID()
      // TypeScript thinks the emailVerified field is missing
      // but all fields are copied directly from user, so it's there
      return await setUser(id, { ...user, id })
    },
    getUser,
    async getUserByEmail(email) {
      const data = await client.get(emailKeyPrefix + natsKey(email))
      if (!data || data.length == 0) return null
      const userId = data.value.toString()
      return await getUser(userId)
    },
    async getUserByAccount(account) {
      const dbAccount = await getAccount(
        `${account.provider}.${account.providerAccountId}`
      )
      if (!dbAccount) return null
      return await getUser(dbAccount.userId)
    },
    async updateUser(updates) {
      const userId = updates.id as string
      const user = await getUser(userId)
      return await setUser(userId, { ...(user as AdapterUser), ...updates })
    },
    async linkAccount(account) {
      const id = `${account.provider}.${account.providerAccountId}`
      return await setAccount(id, { ...account, id })
    },
    createSession: (session) => setSession(session.sessionToken, session),
    async getSessionAndUser(sessionToken) {
      const session = await getSession(sessionToken)
      if (!session) return null
      const user = await getUser(session.userId)
      if (!user) return null
      return { session, user }
    },
    async updateSession(updates) {
      const session = await getSession(updates.sessionToken)
      if (!session) return null
      return await setSession(updates.sessionToken, { ...session, ...updates })
    },
    async deleteSession(sessionToken) {
      await client.purge(sessionKeyPrefix + sessionToken)
    },
    async createVerificationToken(verificationToken) {
      await setObjectAsJson(
        verificationTokenKeyPrefix +
          natsKey(verificationToken.identifier) +
          "." +
          natsKey(verificationToken.token),
        verificationToken
      )
      return verificationToken
    },
    async useVerificationToken(verificationToken) {
      const tokenKey =
        verificationTokenKeyPrefix +
        natsKey(verificationToken.identifier) +
        "." +
        natsKey(verificationToken.token)

      const data = await client.get(tokenKey)
      if (!data || data.length == 0) return null
      const token = data.json<VerificationToken>()
      await client.purge(tokenKey)
      return hydrateDates(token)
      // return reviveFromJson(token)
    },
    async unlinkAccount(account) {
      const id = `${account.provider}.${account.providerAccountId}`
      const dbAccount = await getAccount(natsKey(id))
      if (!dbAccount) return
      const accountKey = `${accountKeyPrefix}${natsKey(id)}`
      await client.purge(accountKey)
      await client.purge(
        `${(accountByUserIdPrefix + dbAccount.userId) as string}`
      )
    },
    async deleteUser(userId) {
      const user = await getUser(natsKey(userId))
      if (!user) return
      const accountByUserKey = accountByUserIdPrefix + natsKey(userId)
      const accountKey = await client
        .get(accountByUserKey)
        .then((data) => data?.value.toString())
      const sessionByUserIdKey = sessionByUserIdKeyPrefix + natsKey(userId)
      const sessionKey = await client
        .get(sessionByUserIdKey)
        .then((data) => data?.value.toString())
      await client.purge(userKeyPrefix + natsKey(userId))
      await client.purge(`${emailKeyPrefix}${natsKey(user.email)}`)
      await client.purge(accountKey as string)
      await client.purge(accountByUserKey)
      await client.purge(sessionKey as string)
      await client.purge(sessionByUserIdKey)
    },
  }
}
